# Studio/8 — Free AI Photo & Creative Studio

Eight real AI tools, one app, completely free:

| # | Tool | How it really works |
|---|------|---------------------|
| 01 | **Picture Restoration** | OpenCV pipeline — denoise, local contrast recovery (CLAHE), gentle saturation lift, sharpening. 3 intensity levels. Runs on the server, no API key. |
| 02 | **Background Remover** | `rembg` (U2-Net neural segmentation). Runs on the server, no API key. |
| 03 | **Interior Designer** | Real image-conditioned editing — your actual room photo is sent to Gemini and redesigned in the chosen style. |
| 04 | **Scribble Designer** | Real image-conditioned editing — your actual sketch is turned into finished artwork. |
| 05 | **Image Generator** | Prompt → image via Gemini (or Pollinations.ai as a no-key fallback). |
| 06 | **Avatar Generator** | Real image-conditioned editing — your actual selfie is restyled into the chosen art style. |
| 07 | **AI Writer** | Real LLM rewriting via Gemini + instant local text tools (clean spacing, title case, bullets). |
| 08 | **Audio Transcript** | Live mic transcription (browser Web Speech API) **and** uploaded-file transcription via `faster-whisper` on the server. |

**One free key powers everything that needs AI generation: [Gemini](https://aistudio.google.com/apikey).** Tools 01, 02, 08 (live mic) and the quick-edit part of 07 need **zero API key at all** — they're either pure local CV/ML or run entirely in your browser.

> If no Gemini key is set, the generative tools (03/04/05/06) automatically fall back to Pollinations.ai (free, no key) — but that mode only generates a *new* image guided by text, it can't edit your actual upload. Add the free Gemini key to unlock real image-conditioned editing. The app shows a banner telling you which mode you're in.

---

## Project structure

```
studio8/
├── backend/         FastAPI app (Python)
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile          ← for Hugging Face Spaces
│   └── .env.example
└── frontend/         React + Vite + Tailwind
    ├── src/App.jsx
    └── ...
```

---

## 1. Run it locally

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# open .env and paste a free Gemini key
# get one free, no card, at https://aistudio.google.com/apikey

uvicorn main:app --reload --port 8000
```

Backend now runs at `http://localhost:8000`. Visit it in a browser — you should see
`{"status": "Studio/8 API is running", "gemini_configured": true}`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and talks to `http://localhost:8000` by default. The app
checks the backend on load and shows a banner if it can't reach it, or if no Gemini key is set.

---

## 2. Put it on GitHub

```bash
cd studio8
git init
git add .
git commit -m "Studio/8 — free AI photo & creative tools"
gh repo create studio8 --public --source=. --remote=origin --push
# no GitHub CLI? create an empty repo on github.com instead, then:
# git remote add origin https://github.com/<you>/studio8.git
# git branch -M main
# git push -u origin main
```

---

## 3. Deploy for free

### Backend → Hugging Face Spaces (free CPU, no card needed)

1. Create a free account at [huggingface.co](https://huggingface.co).
2. **New Space** → SDK: **Docker** → name it (e.g. `studio8-api`) → Public.
3. Push the `backend/` folder's contents to the Space's git repo (HF gives you a git URL, same flow as GitHub):
   ```bash
   git clone https://huggingface.co/spaces/<you>/studio8-api
   cp -r backend/* studio8-api/
   cd studio8-api
   git add . && git commit -m "deploy" && git push
   ```
4. In the Space's **Settings → Repository secrets**, add `GEMINI_API_KEY` with your free key.
5. Wait for the build to finish — your API will be live at
   `https://<you>-studio8-api.hf.space`.

Hugging Face's free tier gives generous CPU + RAM, which is why the backend uses CPU-friendly models (`rembg`, `faster-whisper tiny`) instead of heavy GPU models.

### Frontend → Vercel or Netlify (both free)

**Vercel:**
```bash
cd frontend
npm i -g vercel
vercel
```
When asked, set the environment variable:
```
VITE_API_URL = https://<you>-studio8-api.hf.space
```
(Project Settings → Environment Variables, then redeploy.)

**Netlify (alternative):**
- New site from Git → pick the repo → base directory `frontend`
- Build command: `npm run build`, publish directory: `frontend/dist`
- Add env var `VITE_API_URL` the same way, then redeploy.

Once both are live, your site works end-to-end for free, for anyone.

---

## Notes & limits (read before you ship)

- **Free hosting = shared CPU.** Restoration and background removal take a few seconds; first request after idle can be slower (Spaces "sleep" when unused on the free tier and need to wake up).
- **Gemini's free tier** has real rate limits (roughly 5–15 requests/min and a few hundred/day depending on the model — check [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits) for current numbers, these change). If a tool errors under heavy use, you've likely hit them.
- **Model IDs drift.** Both `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL` are environment variables (defaulting to `gemini-2.5-flash` and `gemini-2.5-flash-image`) — if Google renames/deprecates a model, update the Space's secrets without touching code.
- **Pollinations.ai** (the no-key fallback) is a free public service — be a good citizen, don't hammer it with automated bulk requests.
- **Interior/Scribble/Avatar quality** depends on Gemini actually following the edit instruction — if a result still looks off, try a more specific note/description; the model follows detailed instructions better than vague ones.
