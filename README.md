# Voice Clone Web

Standalone FastAPI + HTML/JS web UI for experimenting with voice cloning on top of `Qwen3-TTS`.

This repo intentionally does not include sample source clips, generated audio, cache files, or uploads.

## Features

- Upload a source audio/video clip from the browser
- Inspect a visible waveform
- Drag to select the reference window
- Preview the selected reference audio
- Run Chinese ASR with manual override
- Generate new cloned Chinese audio

## Requirements

- Python 3.11+
- `ffmpeg` available on `PATH`
- Enough disk space for uploaded media and extracted 24 kHz WAV cache files

## Install

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e .
```

## Run

```powershell
.\.venv\Scripts\voice-clone-web
```

Then open `http://127.0.0.1:7861`.

## Notes

- By default this app stays on CPU because that was the more reliable path in this Windows setup.
- Uploaded clips, extracted cache WAVs, and generated outputs are written under `data/` and ignored by git.
- `Qwen3-TTS` is consumed as a dependency instead of vendoring or modifying its repo here.
