#!/usr/bin/env python3
"""
Transcribe audio files using faster-whisper (local, free, no API calls).

Usage:
    python transcribe_audio.py <audio_file_path> [model_size]

Model sizes: tiny, base (default), small, medium, large-v3
Returns JSON: {"text": "...", "language": "en", "duration": 12.5}
"""
import sys
import json
import os
import tempfile
import subprocess
from faster_whisper import WhisperModel


def convert_to_wav(input_path):
    """Convert any audio to 16kHz mono WAV using ffmpeg."""
    fd, out_path = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', input_path,
             '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
             out_path],
            capture_output=True, check=True, timeout=60
        )
        return out_path
    except Exception:
        if os.path.exists(out_path):
            os.unlink(out_path)
        raise


def transcribe(audio_path, model_size="base"):
    """Transcribe audio using faster-whisper."""
    # Convert to WAV first for reliable format support
    wav_path = None
    try:
        wav_path = convert_to_wav(audio_path)
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(wav_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
        return {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2) if info.duration else 0
        }
    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe_audio.py <audio_file> [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        result = transcribe(audio_path, model_size)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
