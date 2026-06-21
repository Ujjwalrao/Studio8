import { useState, useRef, useEffect } from "react";
import {
  Upload, Download, Sparkles, ImageOff, Sofa, PenTool, Wand2,
  UserCircle, FileText, Mic, ArrowRight, ArrowLeft, X,
  Loader2, Square, Copy, RefreshCw, AlertCircle
} from "lucide-react";

/* ---------------------------------- config ---------------------------------- */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function postForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.clone().json();
      if (data.detail) msg = data.detail;
    } catch {
      const text = await res.text().catch(() => "");
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  return res;
}

/* ---------------------------------- data ---------------------------------- */

const TOOLS = [
  { id: "restore",    frame: "01", name: "Picture Restoration", tag: "Repair faded, torn or scratched photos", icon: Sparkles },
  { id: "bgremove",   frame: "02", name: "Background Remover",  tag: "Lift any subject off its background",   icon: ImageOff },
  { id: "interior",   frame: "03", name: "Interior Designer",   tag: "Reimagine a room in a new style",        icon: Sofa },
  { id: "scribble",   frame: "04", name: "Scribble Designer",   tag: "Turn a rough sketch into artwork",       icon: PenTool },
  { id: "generate",   frame: "05", name: "Image Generator",     tag: "Prompt to picture",                      icon: Wand2 },
  { id: "avatar",     frame: "06", name: "Avatar Generator",    tag: "Stylised portraits from a selfie",       icon: UserCircle },
  { id: "writer",     frame: "07", name: "AI Writer",           tag: "Real AI rewriting, in your browser",     icon: FileText },
  { id: "transcript", frame: "08", name: "Audio Transcript",    tag: "Live or uploaded speech to text",        icon: Mic },
];

const GEN_CONFIG = {
  interior: { needsUpload: true,  uploadLabel: "Drop a photo of your room",    styles: ["Minimal", "Scandinavian", "Industrial", "Bohemian", "Japandi"],        promptLabel: "Anything specific? (optional)", endpoint: "/api/interior", note: "Edits your actual room photo into the new style." },
  scribble: { needsUpload: true,  uploadLabel: "Drop your sketch or scribble", styles: ["Line art", "Watercolor", "3D render", "Anime", "Oil paint"],            promptLabel: "Describe what it should become",  endpoint: "/api/scribble", note: "Turns your actual sketch into finished artwork." },
  generate: { needsUpload: false, uploadLabel: "",                             styles: ["Photoreal", "Illustration", "3D", "Anime", "Cinematic"],                promptLabel: "Describe the image you want",     endpoint: "/api/generate", note: "" },
  avatar:   { needsUpload: true,  uploadLabel: "Drop a clear selfie",          styles: ["Anime", "3D Pixar-style", "Pixel art", "Oil portrait", "Cyberpunk"],    promptLabel: "Any extra direction? (optional)", endpoint: "/api/avatar",   note: "Restyles your actual selfie into the chosen art style." },
};
const GEN_FALLBACK_NOTE = "Running in fallback mode (no Gemini key set) — this generates a new image guided by text only, not your actual upload. Add GEMINI_API_KEY on the server for real image editing.";

const toolBtnStyle = { background: "var(--ink2)", color: "var(--paper)", border: "1px solid rgba(243,236,220,0.15)" };

/* ------------------------------- image math (restore preview only) -------------------------------- */

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg p-3 font-mono shake" style={{ background: "rgba(179,80,59,0.12)", border: "1px solid rgba(179,80,59,0.35)", color: "#E2A393", fontSize: "12px" }}>
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function StatusBanner({ status }) {
  if (!status.checked) return null;
  if (!status.reachable) {
    return (
      <div className="flex items-start gap-2 rounded-lg p-3 mb-6 font-mono fade-in" style={{ background: "rgba(179,80,59,0.1)", border: "1px solid rgba(179,80,59,0.3)", color: "#E2A393", fontSize: "12px" }}>
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>Can't reach the backend right now. Make sure it's running and that VITE_API_URL points to it ({API_BASE}).</span>
      </div>
    );
  }
  if (!status.geminiConfigured) {
    return (
      <div className="flex items-start gap-2 rounded-lg p-3 mb-6 font-mono fade-in" style={{ background: "rgba(232,148,58,0.1)", border: "1px solid rgba(232,148,58,0.3)", color: "var(--amber)", fontSize: "12px" }}>
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>No Gemini key configured on the server yet — Writer and the generative tools are running in basic fallback mode. Add a free GEMINI_API_KEY for real, image-grounded results.</span>
      </div>
    );
  }
  return null;
}

/* ------------------------------ small pieces -------------------------------- */

function UploadDropzone({ onFile, label = "Drop an image or click to browse" }) {
  const inputRef = useRef(null);
  const [isDrag, setIsDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
      onDragLeave={() => setIsDrag(false)}
      onDrop={(e) => { e.preventDefault(); setIsDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => inputRef.current.click()}
      className="cursor-pointer rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-8 transition-colors"
      style={{ borderColor: isDrag ? "var(--amber)" : "rgba(243,236,220,0.18)", background: isDrag ? "rgba(232,148,58,0.06)" : "transparent", minHeight: "220px" }}
    >
      <Upload size={26} style={{ color: "var(--amber)" }} className="mb-3" />
      <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>{label}</p>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); }} />
    </div>
  );
}

function BeforeAfter({ before, after }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative w-full rounded-lg overflow-hidden select-none" style={{ aspectRatio: "4/3", background: "#000" }}>
      <img src={before} className="absolute inset-0 w-full h-full object-contain" alt="before" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={after} className="absolute inset-0 w-full h-full object-contain" alt="after" />
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, width: "2px", background: "var(--amber)" }} />
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" />
      <div className="absolute bottom-2 left-2 font-mono px-2 py-0.5 rounded" style={{ fontSize: "10px", background: "rgba(18,15,13,0.7)", color: "var(--ash)" }}>BEFORE</div>
      <div className="absolute bottom-2 right-2 font-mono px-2 py-0.5 rounded" style={{ fontSize: "10px", background: "rgba(18,15,13,0.7)", color: "var(--amber)" }}>AFTER</div>
    </div>
  );
}

function downloadBlobUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
}

/* --------------------------------- panels ------------------------------------ */

function RestorePanel() {
  const [file, setFile] = useState(null);
  const [beforeUrl, setBeforeUrl] = useState(null);
  const [afterUrl, setAfterUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [strength, setStrength] = useState("standard");

  function handleFile(f) {
    setFile(f);
    setAfterUrl(null);
    setError(null);
    setBeforeUrl(URL.createObjectURL(f));
  }

  async function enhance() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("strength", strength);
      const res = await postForm("/api/restore", fd);
      const blob = await res.blob();
      setAfterUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || "Couldn't reach the server. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!beforeUrl ? (
        <UploadDropzone onFile={handleFile} label="Drop an old or faded photo" />
      ) : (
        <>
          {afterUrl ? (
            <div className="fade-in" key={afterUrl}>
              <BeforeAfter before={beforeUrl} after={afterUrl} />
            </div>
          ) : (
            <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "4/3", background: "#000" }}>
              <img src={beforeUrl} className="w-full h-full object-contain" alt="uploaded" />
            </div>
          )}
          <div>
            <p className="font-mono mb-2" style={{ color: "var(--ash)", fontSize: "12px" }}>Intensity</p>
            <div className="flex gap-2">
              {["light", "standard", "strong"].map((s) => (
                <button key={s} onClick={() => setStrength(s)} className="px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors" style={{ background: strength === s ? "var(--amber)" : "var(--ink2)", color: strength === s ? "var(--ink)" : "var(--ash)", border: "1px solid rgba(243,236,220,0.12)" }}>{s}</button>
              ))}
            </div>
          </div>
          <ErrorBanner message={error} />
          <div className="flex flex-wrap gap-3">
            <button onClick={enhance} disabled={busy} className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 ${busy ? "opacity-50 cursor-not-allowed" : ""}`} style={{ background: "var(--amber)", color: "var(--ink)" }}>
              {busy ? (<><Loader2 size={16} className="animate-spin" /> Restoring…</>) : (<><Sparkles size={16} /> Restore photo</>)}
            </button>
            {afterUrl && (
              <button onClick={() => downloadBlobUrl(afterUrl, "restored-photo.png")} className="px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2" style={toolBtnStyle}>
                <Download size={16} /> Download
              </button>
            )}
            <button onClick={() => { setFile(null); setBeforeUrl(null); setAfterUrl(null); setError(null); }} className="px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2" style={{ color: "var(--ash)" }}>
              <RefreshCw size={16} /> Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BgRemovePanel() {
  const [file, setFile] = useState(null);
  const [beforeUrl, setBeforeUrl] = useState(null);
  const [afterUrl, setAfterUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function handleFile(f) {
    setFile(f);
    setAfterUrl(null);
    setError(null);
    setBeforeUrl(URL.createObjectURL(f));
  }

  async function process() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm("/api/bg-remove", fd);
      const blob = await res.blob();
      setAfterUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || "Couldn't reach the server. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!beforeUrl ? (
        <UploadDropzone onFile={handleFile} label="Drop any photo" />
      ) : (
        <>
          <div className="rounded-lg overflow-hidden checkerboard fade-in" style={{ aspectRatio: "4/3" }} key={afterUrl || beforeUrl}>
            <img src={afterUrl || beforeUrl} className="w-full h-full object-contain" alt="result" />
          </div>
          <ErrorBanner message={error} />
          <div className="flex flex-wrap gap-3">
            <button onClick={process} disabled={busy} className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 ${busy ? "opacity-50 cursor-not-allowed" : ""}`} style={{ background: "var(--amber)", color: "var(--ink)" }}>
              {busy ? (<><Loader2 size={16} className="animate-spin" /> Removing…</>) : (<><ImageOff size={16} /> Remove background</>)}
            </button>
            {afterUrl && (
              <button onClick={() => downloadBlobUrl(afterUrl, "no-background.png")} className="px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2" style={toolBtnStyle}>
                <Download size={16} /> Download PNG
              </button>
            )}
            <button onClick={() => { setFile(null); setBeforeUrl(null); setAfterUrl(null); setError(null); }} className="px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2" style={{ color: "var(--ash)" }}>
              <RefreshCw size={16} /> Start over
            </button>
          </div>
          <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>Powered by a real neural segmentation model (U2-Net) running on the server.</p>
        </>
      )}
    </div>
  );
}

function WriterPanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readMins = Math.max(1, Math.round(words / 200));

  function titleCase() { setText((t) => t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())); }
  function cleanSpacing() { setText((t) => t.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim()); }
  function bulletify() { setText((t) => t.split(/(?<=[.!?])\s+/).filter(Boolean).map((s) => `• ${s.trim()}`).join("\n")); }

  async function aiRewrite(mode) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("text", text);
      fd.append("mode", mode);
      const res = await postForm("/api/write", fd);
      const data = await res.json();
      setText(data.result);
    } catch (e) {
      setError(e.message || "AI rewrite failed. Check the backend's GEMINI_API_KEY.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Paste or write your text here…" className="w-full rounded-lg p-4 text-sm leading-relaxed" style={{ background: "var(--ink2)", border: "1px solid rgba(243,236,220,0.12)", color: "var(--paper)" }} />
      <div className="flex flex-wrap gap-2 font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>
        <span>{words} words</span><span>·</span><span>{readMins} min read</span>
      </div>
      <ErrorBanner message={error} />

      <div>
        <p className="font-mono mb-2" style={{ color: "var(--ash)", fontSize: "12px" }}>AI rewrite (real LLM, runs on server)</p>
        <div className="flex flex-wrap gap-3">
          {["improve", "formal", "casual", "shorten", "expand"].map((mode) => (
            <button key={mode} onClick={() => aiRewrite(mode)} disabled={busy} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize flex items-center gap-1.5 ${busy ? "opacity-50 cursor-not-allowed" : ""}`} style={{ background: "var(--amber)", color: "var(--ink)" }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} {mode}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="font-mono mb-2" style={{ color: "var(--ash)", fontSize: "12px" }}>Quick edit (instant, runs in your browser)</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={cleanSpacing} className="px-4 py-2 rounded-lg text-sm font-medium" style={toolBtnStyle}>Clean spacing</button>
          <button onClick={titleCase} className="px-4 py-2 rounded-lg text-sm font-medium" style={toolBtnStyle}>Title Case</button>
          <button onClick={bulletify} className="px-4 py-2 rounded-lg text-sm font-medium" style={toolBtnStyle}>Bullet-ify</button>
          <button onClick={() => navigator.clipboard.writeText(text)} className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5" style={toolBtnStyle}><Copy size={14} /> Copy</button>
        </div>
      </div>
    </div>
  );
}

function TranscriptPanel() {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const recognitionRef = useRef(null);

  const [audioFile, setAudioFile] = useState(null);
  const [fileTranscript, setFileTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        finalText += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += " ";
      }
      setLiveTranscript(finalText);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
  }, []);

  function toggleRecording() {
    if (!recognitionRef.current) return;
    if (recording) { recognitionRef.current.stop(); setRecording(false); }
    else { recognitionRef.current.start(); setRecording(true); }
  }

  async function handleAudioFile(f) {
    setAudioFile(f);
    setFileTranscript("");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await postForm("/api/transcript", fd);
      const data = await res.json();
      setFileTranscript(data.text);
    } catch (e) {
      setError(e.message || "Transcription failed. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>Live, in your browser</p>
        {supported ? (
          <>
            <button onClick={toggleRecording} className="px-6 py-3 rounded-lg font-semibold text-sm flex items-center gap-2" style={{ background: recording ? "#B3503B" : "var(--amber)", color: recording ? "#fff" : "var(--ink)" }}>
              {recording ? (<><Square size={16} /> Stop recording</>) : (<><Mic size={16} /> Start recording</>)}
            </button>
            <textarea value={liveTranscript} onChange={(e) => setLiveTranscript(e.target.value)} rows={6} placeholder="Your live transcript will appear here as you speak…" className="w-full rounded-lg p-4 text-sm leading-relaxed" style={{ background: "var(--ink2)", border: "1px solid rgba(243,236,220,0.12)", color: "var(--paper)" }} />
            <div className="flex gap-3">
              <button onClick={() => navigator.clipboard.writeText(liveTranscript)} className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5" style={toolBtnStyle}><Copy size={14} /> Copy</button>
            </div>
          </>
        ) : (
          <p className="font-mono text-sm" style={{ color: "var(--ash)" }}>Live transcription needs a browser with speech recognition support — try Chrome.</p>
        )}
      </div>

      <div className="space-y-4" style={{ borderTop: "1px solid rgba(243,236,220,0.08)", paddingTop: "2rem" }}>
        <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>Or upload a recording (real server-side AI — Whisper)</p>
        <div
          onClick={() => fileInputRef.current.click()}
          className="cursor-pointer rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-6"
          style={{ borderColor: "rgba(243,236,220,0.18)" }}
        >
          <Upload size={22} style={{ color: "var(--amber)" }} className="mb-2" />
          <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>{audioFile ? audioFile.name : "Drop an audio file (mp3, wav, m4a)"}</p>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) handleAudioFile(f); }} />
        </div>
        <ErrorBanner message={error} />
        {busy && <p className="font-mono flex items-center gap-2" style={{ color: "var(--ash)", fontSize: "12px" }}><Loader2 size={14} className="animate-spin" /> Transcribing…</p>}
        {fileTranscript && (
          <>
            <textarea value={fileTranscript} onChange={(e) => setFileTranscript(e.target.value)} rows={6} className="w-full rounded-lg p-4 text-sm leading-relaxed" style={{ background: "var(--ink2)", border: "1px solid rgba(243,236,220,0.12)", color: "var(--paper)" }} />
            <div className="flex gap-3">
              <button onClick={() => navigator.clipboard.writeText(fileTranscript)} className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5" style={toolBtnStyle}><Copy size={14} /> Copy</button>
              <button onClick={() => downloadBlobUrl(URL.createObjectURL(new Blob([fileTranscript], { type: "text/plain" })), "transcript.txt")} className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5" style={toolBtnStyle}><Download size={14} /> Download .txt</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GeneratePanel({ tool, geminiConfigured }) {
  const cfg = GEN_CONFIG[tool.id];
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [styleChoice, setStyleChoice] = useState(cfg.styles[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function handleFile(f) {
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      if (tool.id === "generate") {
        fd.append("prompt", prompt);
        fd.append("style", styleChoice);
      } else if (tool.id === "interior") {
        fd.append("style", styleChoice);
        fd.append("notes", prompt);
        fd.append("file", file);
      } else if (tool.id === "scribble") {
        fd.append("style", styleChoice);
        fd.append("description", prompt);
        fd.append("file", file);
      } else if (tool.id === "avatar") {
        fd.append("style", styleChoice);
        fd.append("notes", prompt);
        fd.append("file", file);
      }
      const res = await postForm(cfg.endpoint, fd);
      const blob = await res.blob();
      setResult(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || "Generation failed. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = cfg.needsUpload ? !!file : prompt.trim().length > 0;

  return (
    <div className="space-y-4">
      {cfg.note && <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>{geminiConfigured ? cfg.note : GEN_FALLBACK_NOTE}</p>}
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-5">
          {cfg.needsUpload && (
            previewUrl ? (
              <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: "4/3" }}>
                <img src={previewUrl} className="w-full h-full object-cover" alt="uploaded" />
                <button onClick={() => { setFile(null); setPreviewUrl(null); }} className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(18,15,13,0.7)" }}><X size={14} color="#F3ECDC" /></button>
              </div>
            ) : (
              <UploadDropzone onFile={handleFile} label={cfg.uploadLabel} />
            )
          )}
          <div>
            <label className="font-mono block mb-2" style={{ color: "var(--ash)", fontSize: "12px" }}>{cfg.promptLabel}</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Type here…" className="w-full rounded-lg p-3 text-sm" style={{ background: "var(--ink2)", border: "1px solid rgba(243,236,220,0.12)", color: "var(--paper)" }} />
          </div>
          <div>
            <label className="font-mono block mb-2" style={{ color: "var(--ash)", fontSize: "12px" }}>Style</label>
            <div className="flex flex-wrap gap-2">
              {cfg.styles.map((s) => (
                <button key={s} onClick={() => setStyleChoice(s)} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors" style={{ background: styleChoice === s ? "var(--amber)" : "var(--ink2)", color: styleChoice === s ? "var(--ink)" : "var(--ash)", border: "1px solid rgba(243,236,220,0.12)" }}>{s}</button>
              ))}
            </div>
          </div>
          <ErrorBanner message={error} />
          <button onClick={generate} disabled={!canGenerate || busy} className={`w-full py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 ${(!canGenerate || busy) ? "opacity-40 cursor-not-allowed" : ""}`} style={{ background: "var(--amber)", color: "var(--ink)" }}>
            {busy ? (<><Loader2 size={16} className="animate-spin" /> Generating…</>) : (<>Generate <ArrowRight size={16} /></>)}
          </button>
          {!canGenerate && !busy && (
            <p className="font-mono" style={{ color: "var(--ash)", fontSize: "11px" }}>
              {cfg.needsUpload ? "Upload a photo to enable Generate." : "Add a prompt to enable Generate."}
            </p>
          )}
        </div>
        <div className="rounded-lg flex items-center justify-center relative overflow-hidden" style={{ background: "var(--ink2)", minHeight: "320px", border: "1px solid rgba(243,236,220,0.08)" }}>
          {busy ? (
            <div className="flex flex-col items-center gap-2 pulse-glow">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--amber)" }} />
              <p className="font-mono" style={{ color: "var(--ash)", fontSize: "11px" }}>Generating your {tool.name.toLowerCase()}…</p>
            </div>
          ) : result ? (
            <div className="fade-in w-full h-full" key={result}>
              <img src={result} className="w-full h-full object-cover" alt="generated result" />
              <button onClick={() => downloadBlobUrl(result, `${tool.id}-result.png`)} className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5" style={{ background: "var(--amber)", color: "var(--ink)" }}>
                <Download size={14} /> Download
              </button>
            </div>
          ) : (
            <p className="font-mono text-center px-8" style={{ color: "var(--ash)", fontSize: "12px" }}>Your {tool.name.toLowerCase()} result will appear here</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- dashboard ----------------------------------- */

function Dashboard({ tool, onSelect, onBack, backendStatus }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row gap-8">
      <aside className="md:w-64 w-full flex-shrink-0 space-y-1">
        <button onClick={onBack} className="flex items-center gap-2 font-mono mb-6" style={{ color: "var(--ash)", fontSize: "12px" }}><ArrowLeft size={14} /> Overview</button>
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors sidebar-item" style={{ background: t.id === tool.id ? "var(--ink2)" : "transparent" }}>
            <span className="font-mono" style={{ color: "var(--amber)", fontSize: "10px" }}>{t.frame}</span>
            <t.icon size={16} style={{ color: t.id === tool.id ? "var(--paper)" : "var(--ash)" }} />
            <span className="text-sm" style={{ color: t.id === tool.id ? "var(--paper)" : "var(--ash)" }}>{t.name}</span>
          </button>
        ))}
      </aside>
      <main className="flex-1 min-w-0 fade-in" key={tool.id}>
        <StatusBanner status={backendStatus} />
        <span className="font-mono block mb-1" style={{ color: "var(--amber)", fontSize: "12px" }}>FRAME {tool.frame}</span>
        <h1 className="font-display text-3xl mb-2" style={{ color: "var(--paper)" }}>{tool.name}</h1>
        <p className="text-sm mb-8" style={{ color: "var(--ash)" }}>{tool.tag}</p>

        {tool.id === "restore" && <RestorePanel />}
        {tool.id === "bgremove" && <BgRemovePanel />}
        {tool.id === "writer" && <WriterPanel />}
        {tool.id === "transcript" && <TranscriptPanel />}
        {(tool.id === "interior" || tool.id === "scribble" || tool.id === "generate" || tool.id === "avatar") && <GeneratePanel tool={tool} geminiConfigured={backendStatus.geminiConfigured} />}
      </main>
    </div>
  );
}

/* ---------------------------------- home -------------------------------------- */

function NavBar({ onLogo, onOpen }) {
  return (
    <header className="relative max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
      <button onClick={onLogo} className="flex items-center gap-2">
        <span className="font-display text-xl" style={{ color: "var(--paper)" }}>STUDIO<span style={{ color: "var(--amber)" }}>/8</span></span>
      </button>
      <nav className="hidden md:flex items-center gap-8 font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>
        <span>8 TOOLS</span>
        <span>NO PAYWALL</span>
        <span>REAL AI</span>
      </nav>
      <button onClick={onOpen} className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5" style={{ background: "var(--amber)", color: "var(--ink)" }}>
        Open studio <ArrowRight size={14} />
      </button>
    </header>
  );
}

function Hero({ onOpen }) {
  return (
    <section className="relative max-w-7xl mx-auto px-6 pt-10 pb-24 grid md:grid-cols-2 gap-12 items-center">
      <div className="animate-fadeup">
        <p className="font-mono tracking-widest mb-5" style={{ color: "var(--amber)", fontSize: "12px" }}>AN AI DARKROOM · FREE, ALWAYS</p>
        <h1 className="font-display text-5xl md:text-6xl mb-6" style={{ color: "var(--paper)", lineHeight: 1.05 }}>
          Every tool a photo studio needs, <span style={{ fontStyle: "italic", color: "var(--amber)" }}>none of the price tag.</span>
        </h1>
        <p className="text-base leading-relaxed mb-8 max-w-md" style={{ color: "var(--ash)" }}>
          Restore old prints, lift backgrounds, redesign rooms, sketch into art, and write — eight real AI tools on one roll of film.
        </p>
        <div className="flex flex-wrap gap-4">
          <button onClick={onOpen} className="px-6 py-3 rounded-full font-semibold text-sm flex items-center gap-2" style={{ background: "var(--amber)", color: "var(--ink)" }}>
            Start restoring <ArrowRight size={16} />
          </button>
          <a href="#tools" className="px-6 py-3 rounded-full font-semibold text-sm flex items-center gap-2" style={{ border: "1px solid rgba(243,236,220,0.25)", color: "var(--paper)" }}>
            See all 8 tools
          </a>
        </div>
      </div>
      <div className="relative hidden md:block" style={{ height: "420px" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 70% 40%, rgba(232,148,58,0.18), transparent 60%)" }}></div>
        {TOOLS.slice(0, 4).map((t, i) => (
          <div key={t.id} className="filmcard absolute rounded-lg p-5" style={{ width: "230px", top: `${i * 70}px`, right: `${i * 30}px`, transform: `rotate(${(i - 1.5) * 3}deg)`, zIndex: 10 - i }}>
            <t.icon size={20} style={{ color: "var(--amber)" }} className="mb-3" />
            <p className="font-mono mb-1" style={{ color: "var(--ash)", fontSize: "10px" }}>FRAME {t.frame}</p>
            <p className="text-sm font-semibold" style={{ color: "var(--paper)" }}>{t.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ToolGrid({ onSelect }) {
  return (
    <section id="tools" className="max-w-7xl mx-auto px-6 pb-24">
      <div className="flex items-end justify-between mb-8">
        <h2 className="font-display text-3xl" style={{ color: "var(--paper)" }}>The contact sheet</h2>
        <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>8 FRAMES · 1 ROLL</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)} className="filmcard rounded-lg p-5 text-left transition-transform hover:-translate-y-1">
            <span className="font-mono block mb-4" style={{ color: "var(--amber)", fontSize: "10px" }}>{t.frame}</span>
            <t.icon size={22} style={{ color: "var(--paper)" }} className="mb-3" />
            <p className="font-semibold text-sm mb-1" style={{ color: "var(--paper)" }}>{t.name}</p>
            <p className="text-xs" style={{ color: "var(--ash)" }}>{t.tag}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Upload", desc: "Drop a photo, sketch, or hit record." },
    { n: "02", title: "Process", desc: "Pick a tool, choose a style if needed, and run it — real models, running on the server." },
    { n: "03", title: "Download", desc: "Get your result instantly. No account, no watermark, no cost." },
  ];
  return (
    <section className="max-w-7xl mx-auto px-6 pb-24">
      <h2 className="font-display text-3xl mb-10" style={{ color: "var(--paper)" }}>How a roll gets developed</h2>
      <div className="grid md:grid-cols-3 gap-8">
        {steps.map((s) => (
          <div key={s.n}>
            <p className="font-mono mb-3" style={{ color: "var(--amber)", fontSize: "12px" }}>{s.n}</p>
            <p className="font-display text-xl mb-2" style={{ color: "var(--paper)" }}>{s.title}</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--ash)" }}>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4" style={{ borderTop: "1px solid rgba(243,236,220,0.08)" }}>
      <span className="font-display text-lg" style={{ color: "var(--paper)" }}>STUDIO<span style={{ color: "var(--amber)" }}>/8</span></span>
      <p className="font-mono" style={{ color: "var(--ash)", fontSize: "12px" }}>Free for everyone, forever — built one frame at a time.</p>
    </footer>
  );
}

function Home({ onSelect }) {
  return (
    <>
      <Hero onOpen={() => onSelect("restore")} />
      <ToolGrid onSelect={onSelect} />
      <HowItWorks />
      <Footer />
    </>
  );
}

/* ----------------------------------- app --------------------------------------- */

export default function App() {
  const [view, setView] = useState("home");
  const [backendStatus, setBackendStatus] = useState({ checked: false, reachable: false, geminiConfigured: false });
  const activeTool = TOOLS.find((t) => t.id === view);

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => setBackendStatus({ checked: true, reachable: true, geminiConfigured: !!data.gemini_configured }))
      .catch(() => setBackendStatus({ checked: true, reachable: false, geminiConfigured: false }));
  }, []);

  return (
    <div className="studio8">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        .studio8 {
          --ink: #120F0D;
          --ink2: #1C1713;
          --ink3: #251F19;
          --paper: #F3ECDC;
          --amber: #E8943A;
          --teal: #3C6B64;
          --ash: #9C9286;
          font-family: 'Inter', sans-serif;
          background: var(--ink);
          color: var(--paper);
          position: relative;
          min-height: 100vh;
          overflow-x: hidden;
        }
        .studio8::before {
          content: '';
          position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          opacity: 0.05;
          pointer-events: none;
          z-index: 0;
        }
        .studio8 > * { position: relative; z-index: 1; }
        .studio8 .font-display { font-family: 'Fraunces', serif; }
        .studio8 .font-mono { font-family: 'JetBrains Mono', monospace; }
        .studio8 button { font-family: inherit; cursor: pointer; }

        .studio8 .filmcard {
          background: var(--ink2);
          border: 1px solid rgba(243,236,220,0.08);
          position: relative;
        }
        .studio8 .filmcard::before, .studio8 .filmcard::after {
          content: '';
          position: absolute; left: 0; right: 0; height: 10px;
          background-image: radial-gradient(circle, var(--ink) 3px, transparent 3px);
          background-size: 16px 10px;
          background-repeat: repeat-x;
        }
        .studio8 .filmcard::before { top: 0; }
        .studio8 .filmcard::after { bottom: 0; }

        .studio8 .checkerboard {
          background-image:
            linear-gradient(45deg, #2a2520 25%, transparent 25%),
            linear-gradient(-45deg, #2a2520 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #2a2520 75%),
            linear-gradient(-45deg, transparent 75%, #2a2520 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          background-color: #1c1814;
        }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .studio8 .animate-fadeup { animation: fadeUp 0.7s ease both; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .studio8 .fade-in { animation: fadeIn 0.4s ease both; }

        @keyframes shake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }
        .studio8 .shake { animation: shake 0.4s ease; }

        @keyframes pulseGlow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .studio8 .pulse-glow { animation: pulseGlow 1.4s ease-in-out infinite; }

        .studio8 input[type="range"] { accent-color: var(--amber); }

        .studio8 button {
          transition: transform 0.12s ease, opacity 0.15s ease, background-color 0.15s ease, border-color 0.2s ease;
        }
        .studio8 button:active:not(:disabled) { transform: scale(0.96); }

        .studio8 .filmcard {
          transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
        }
        .studio8 .filmcard:hover {
          border-color: rgba(232,148,58,0.35);
          box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        }

        .studio8 .sidebar-item:hover { background: var(--ink2); }

        .studio8 img { transition: opacity 0.3s ease; }

        .studio8 button:focus-visible,
        .studio8 a:focus-visible,
        .studio8 input:focus-visible,
        .studio8 textarea:focus-visible {
          outline: 2px solid var(--amber);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .studio8 * { animation: none !important; transition: none !important; }
        }
      `}</style>

      <NavBar onLogo={() => setView("home")} onOpen={() => setView("restore")} />
      <div className="fade-in" key={view === "home" ? "home" : "dashboard"}>
        {view === "home" ? (
          <Home onSelect={setView} />
        ) : (
          <Dashboard tool={activeTool} onSelect={setView} onBack={() => setView("home")} backendStatus={backendStatus} />
        )}
      </div>
    </div>
  );
}
