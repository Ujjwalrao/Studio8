import base64
import io
import os
import tempfile
import urllib.parse
from typing import Optional

import cv2
import numpy as np
import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image
from rembg import remove

app = FastAPI(title="Studio/8 API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------- #
# Gemini config — ONE free key (https://aistudio.google.com/apikey) powers
# real text rewriting AND real image-conditioned generation/editing.
# Pollinations.ai (no key) is used as a graceful fallback if no key is set.
# --------------------------------------------------------------------------- #

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_TEXT_MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash")
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{}"

MAX_IMAGE_DIM = 1600  # safety cap so free CPU hosting doesn't choke on huge uploads


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def read_image(file_bytes: bytes) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read the uploaded file as an image.")
    img.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM))
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def encode_png(img_bgr: np.ndarray) -> bytes:
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def prep_image_for_gemini(raw_bytes: bytes, max_dim: int = 1024) -> bytes:
    """Resize + recompress an upload so the base64 payload sent to Gemini stays small and fast."""
    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(400, "Could not read the uploaded file as an image.")
    img.thumbnail((max_dim, max_dim))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def pollinate(prompt: str, width: int = 896, height: int = 640) -> bytes:
    encoded = urllib.parse.quote(prompt)
    url = POLLINATIONS_URL.format(encoded)
    params = {"width": width, "height": height, "nologo": "true"}
    try:
        res = requests.get(url, params=params, timeout=90)
    except requests.RequestException:
        raise HTTPException(502, "Image generation service is unreachable right now. Try again in a moment.")
    if res.status_code != 200 or not res.content:
        raise HTTPException(502, "Image generation service did not return an image. Try again.")
    return res.content


def gemini_text(prompt: str, system: Optional[str] = None) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(
            500,
            "AI writing isn't configured yet — add a free GEMINI_API_KEY on the server "
            "(get one free, no card, at https://aistudio.google.com/apikey).",
        )
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}
    try:
        res = requests.post(
            f"{GEMINI_BASE}/{GEMINI_TEXT_MODEL}:generateContent",
            headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
            json=body,
            timeout=30,
        )
    except requests.RequestException:
        raise HTTPException(502, "Could not reach the AI writing service. Try again.")
    if res.status_code != 200:
        raise HTTPException(502, f"AI writing service error: {res.text[:200]}")
    data = res.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        raise HTTPException(502, "AI writing service returned an unexpected response.")


def gemini_image_call(prompt: str, image_b64: Optional[str] = None) -> bytes:
    """Calls Gemini's image model. Raises RuntimeError on any failure (caller decides whether to fall back)."""
    if not GEMINI_API_KEY:
        raise RuntimeError("no gemini key configured")

    parts = []
    if image_b64 is not None:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": image_b64}})
    parts.append({"text": prompt})

    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }
    res = requests.post(
        f"{GEMINI_BASE}/{GEMINI_IMAGE_MODEL}:generateContent",
        headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
        json=body,
        timeout=90,
    )
    if res.status_code != 200:
        print(f"[gemini_image] error: {res.text[:300]}")
        raise RuntimeError(f"gemini image error: {res.status_code}")
    data = res.json()
    try:
        out_parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError):
        raise RuntimeError("gemini image: no candidates")
    for part in out_parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    raise RuntimeError("gemini image: no image in response")


def generate_image_with_fallback(prompt: str, raw_image_bytes: Optional[bytes] = None, size=(896, 640)) -> bytes:
    """Real Gemini generation/editing when a key is configured (your actual upload shapes the result).
    Falls back to Pollinations (text-only, no key) only for genuine service failures — a bad/corrupt
    upload still raises a clear 400 instead of silently being ignored."""
    image_b64 = None
    if raw_image_bytes is not None:
        small = prep_image_for_gemini(raw_image_bytes)  # raises HTTPException(400) directly if the file is bad
        image_b64 = base64.b64encode(small).decode()
    try:
        return gemini_image_call(prompt, image_b64)
    except Exception as e:
        print(f"[generate_image_with_fallback] falling back to Pollinations: {e}")
        return pollinate(prompt, *size)


# --------------------------------------------------------------------------- #
# 1. Picture restoration — real OpenCV pipeline, tuned to be safe by default:
#    denoise, gentle local-contrast recovery (CLAHE), gentle saturation lift,
#    mild unsharp-mask sharpening. No global colour-balance step (that was the
#    cause of odd colour casts on non-neutral photos like portraits).
# --------------------------------------------------------------------------- #

RESTORE_LEVELS = {
    "light":    {"denoise": 3, "clahe": 1.2, "sat": 1.05, "sharpen": 0.25},
    "standard": {"denoise": 5, "clahe": 1.8, "sat": 1.10, "sharpen": 0.40},
    "strong":   {"denoise": 8, "clahe": 2.4, "sat": 1.16, "sharpen": 0.55},
}


@app.post("/api/restore")
async def restore_photo(file: UploadFile = File(...), strength: str = Form("standard")):
    raw = await file.read()
    img = read_image(raw)
    cfg = RESTORE_LEVELS.get(strength, RESTORE_LEVELS["standard"])

    img = cv2.fastNlMeansDenoisingColored(img, None, cfg["denoise"], cfg["denoise"], 7, 21)

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=cfg["clahe"], tileGridSize=(8, 8))
    l = clahe.apply(l)
    img = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * cfg["sat"], 0, 255)
    img = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    blurred = cv2.GaussianBlur(img, (0, 0), 2)
    amt = cfg["sharpen"]
    img = cv2.addWeighted(img, 1 + amt, blurred, -amt, 0)

    return StreamingResponse(io.BytesIO(encode_png(img)), media_type="image/png")


# --------------------------------------------------------------------------- #
# 2. Background remover — real neural segmentation via rembg (U2-Net)
# --------------------------------------------------------------------------- #

@app.post("/api/bg-remove")
async def bg_remove(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        out = remove(raw)
    except Exception as e:
        print(f"[bg-remove] error: {e}")
        raise HTTPException(400, "Could not process this image. Try a different file.")
    return StreamingResponse(io.BytesIO(out), media_type="image/png")


# --------------------------------------------------------------------------- #
# 3. Audio transcript (file upload) — real local speech-to-text via faster-whisper
# --------------------------------------------------------------------------- #

_whisper_model = None


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
    return _whisper_model


@app.post("/api/transcript")
async def transcript(file: UploadFile = File(...)):
    raw = await file.read()
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        model = get_whisper()
        segments, info = model.transcribe(tmp_path)
        text = " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        print(f"[transcript] error: {e}")
        raise HTTPException(400, "Could not transcribe this file. Try a WAV or MP3 file.")
    finally:
        os.unlink(tmp_path)
    return {"text": text, "language": getattr(info, "language", "unknown")}


# --------------------------------------------------------------------------- #
# 4. AI Writer — real LLM rewriting via Gemini's free API
# --------------------------------------------------------------------------- #

WRITE_INSTRUCTIONS = {
    "improve": "Improve the clarity, grammar and flow of the user's text. Keep the original meaning, tone and length similar. Return only the rewritten text, nothing else — no preamble, no quotes.",
    "formal": "Rewrite the user's text in a formal, professional tone. Return only the rewritten text, nothing else.",
    "casual": "Rewrite the user's text in a casual, friendly, conversational tone. Return only the rewritten text, nothing else.",
    "shorten": "Shorten the user's text to roughly half its length while keeping the key points. Return only the rewritten text, nothing else.",
    "expand": "Expand the user's text with more detail, examples and explanation. Return only the rewritten text, nothing else.",
}


@app.post("/api/write")
async def write(text: str = Form(...), mode: str = Form("improve")):
    instruction = WRITE_INSTRUCTIONS.get(mode, WRITE_INSTRUCTIONS["improve"])
    result = gemini_text(text, system=instruction)
    return {"result": result}


# --------------------------------------------------------------------------- #
# 5-8. Generative image tools — real image generation AND real image-conditioned
#      editing via Gemini 2.5 Flash Image when GEMINI_API_KEY is set (your actual
#      photo/sketch/selfie is sent to the model and genuinely shapes the result).
#      Falls back to Pollinations.ai (prompt-only, no key) if no key is configured.
# --------------------------------------------------------------------------- #

@app.post("/api/generate")
async def generate(prompt: str = Form(...), style: str = Form("Photoreal")):
    full_prompt = f"{prompt}, {style} style, highly detailed, high quality"
    img_bytes = generate_image_with_fallback(full_prompt)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")


@app.post("/api/interior")
async def interior(style: str = Form(...), notes: str = Form(""), file: UploadFile = File(...)):
    raw = await file.read()
    prompt = (
        f"Redesign this exact room in {style} interior design style. Keep the same room layout, "
        f"walls, windows and camera angle, but change furniture, decor, colours and lighting to match "
        f"the {style} style. {notes}. Professional architectural photography, realistic, high detail."
    )
    img_bytes = generate_image_with_fallback(prompt, raw_image_bytes=raw)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")


@app.post("/api/scribble")
async def scribble(style: str = Form(...), description: str = Form(...), file: UploadFile = File(...)):
    raw = await file.read()
    prompt = (
        f"Turn this rough sketch into a finished {style} artwork. Follow the composition and shapes "
        f"of the sketch closely. {description}. Detailed, polished, high quality."
    )
    img_bytes = generate_image_with_fallback(prompt, raw_image_bytes=raw)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")


@app.post("/api/avatar")
async def avatar(style: str = Form(...), notes: str = Form(""), file: UploadFile = File(...)):
    raw = await file.read()
    prompt = (
        f"Turn this selfie into a {style} stylised avatar portrait. Keep the same hair, expression, "
        f"framing and clothing, but render it as {style} art. {notes}. Centered portrait, high quality, "
        f"plain background."
    )
    img_bytes = generate_image_with_fallback(prompt, raw_image_bytes=raw)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")


@app.get("/")
async def root():
    return {"status": "Studio/8 API is running", "gemini_configured": bool(GEMINI_API_KEY)}
