# Studio/8 backend — built for Hugging Face Spaces (Docker SDK), free CPU tier.
FROM python:3.10-slim

WORKDIR /app

# System libs needed by opencv + audio handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download model weights at build time so the first real request isn't slow
RUN python -c "from rembg import new_session; new_session('u2net')"
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"

COPY . .

# Hugging Face Spaces (Docker SDK) expects the app on port 7860
EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
