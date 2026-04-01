from __future__ import annotations

import argparse
import io
import os
import platform
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from transformers import pipeline


def prepend_to_path(path: Path) -> None:
    os.environ["PATH"] = f"{path}{os.pathsep}{os.environ.get('PATH', '')}"


def iter_binary_search_dirs(binary_name: str) -> list[Path]:
    candidates: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path | None) -> None:
        if path is None:
            return
        candidate = path.expanduser()
        if candidate in seen or not candidate.exists():
            return
        seen.add(candidate)
        candidates.append(candidate)

    env_dir = os.environ.get(f"{binary_name.upper()}_DIR")
    if env_dir:
        add(Path(env_dir))

    system = platform.system()
    home = Path.home()
    if system == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            winget_packages = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
            if winget_packages.exists():
                package_patterns = ("*SoX*", "*FFmpeg*") if binary_name == "sox" else ("*FFmpeg*",)
                for pattern in package_patterns:
                    for package_dir in winget_packages.glob(pattern):
                        add(package_dir)
                        for child in package_dir.rglob("*"):
                            if child.is_dir():
                                add(child)
        for path_var in ("ProgramFiles", "ProgramFiles(x86)"):
            program_files = os.environ.get(path_var)
            if not program_files:
                continue
            root = Path(program_files)
            add(root / "sox")
            add(root / "ffmpeg" / "bin")
    else:
        add(Path("/usr/local/bin"))
        add(Path("/opt/homebrew/bin"))
        add(Path("/opt/local/bin"))
        add(home / ".local" / "bin")

    return candidates


def ensure_binary_on_path(binary_name: str) -> None:
    if shutil.which(binary_name):
        return

    executable = f"{binary_name}.exe" if os.name == "nt" else binary_name
    for directory in iter_binary_search_dirs(binary_name):
        if (directory / executable).exists():
            prepend_to_path(directory)
            return


def require_binary(binary_name: str) -> None:
    ensure_binary_on_path(binary_name)
    if shutil.which(binary_name):
        return

    if os.name == "nt":
        install_hint = (
            f"Install it with `winget install {binary_name}` or point `{binary_name.upper()}_DIR` "
            "at the directory containing the executable."
        )
    elif platform.system() == "Darwin":
        install_hint = (
            f"Install it with `brew install {binary_name}` or point `{binary_name.upper()}_DIR` "
            "at the directory containing the executable."
        )
    else:
        install_hint = (
            f"Install it with your package manager or point `{binary_name.upper()}_DIR` "
            "at the directory containing the executable."
        )
    raise RuntimeError(f"Required binary `{binary_name}` was not found on PATH. {install_hint}")


for required_binary in ("sox", "ffmpeg"):
    ensure_binary_on_path(required_binary)

from qwen_tts import Qwen3TTSModel


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
OUTPUT_DIR = DATA_DIR / "outputs"
UPLOAD_DIR = DATA_DIR / "uploads"
WEB_DIR = PACKAGE_DIR / "web"
DEFAULT_TARGET_TEXT = "今天的实验开始了。我们先测试这段中文声音克隆，听一下相似度和自然度。"
DEFAULT_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
ASR_MODEL = "openai/whisper-small"


@dataclass
class LoadedClip:
    source_path: str
    cache_wav_path: str
    sample_rate: int
    duration: float


@dataclass
class WaveformOverview:
    duration: float
    xs: list[float]
    lows: list[float]
    highs: list[float]


class Runtime:
    def __init__(self) -> None:
        self.tts_models: dict[tuple[str, str, str], Qwen3TTSModel] = {}
        self.asr_pipelines: dict[str, Any] = {}

    def get_tts(self, model_name: str, device: str, dtype_name: str) -> Qwen3TTSModel:
        key = (model_name, device, dtype_name)
        if key in self.tts_models:
            return self.tts_models[key]

        dtype = {
            "float32": torch.float32,
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
        }[dtype_name]
        model = Qwen3TTSModel.from_pretrained(
            model_name,
            device_map=device,
            dtype=dtype,
            attn_implementation="eager",
        )
        self.tts_models[key] = model
        return model

    def get_asr(self, device: str) -> Any:
        if device in self.asr_pipelines:
            return self.asr_pipelines[device]

        if device.startswith("cuda") and torch.cuda.is_available():
            pipe_device: Any = device
            pipe_dtype = torch.float16
        else:
            pipe_device = "cpu"
            pipe_dtype = torch.float32

        asr = pipeline(
            "automatic-speech-recognition",
            model=ASR_MODEL,
            device=pipe_device,
            dtype=pipe_dtype,
        )
        self.asr_pipelines[device] = asr
        return asr


RUNTIME = Runtime()


class ClipRequest(BaseModel):
    source_path: str


class WindowRequest(BaseModel):
    source_path: str
    start_sec: float
    end_sec: float


class AsrRequest(WindowRequest):
    asr_device: str = "cpu"


class GenerateRequest(WindowRequest):
    ref_text: str
    target_text: str
    model_name: str = DEFAULT_MODEL
    device: str = "cpu"
    dtype_name: str = "float32"


def normalize_text(text: str) -> str:
    return " ".join((text or "").strip().split())


def auto_device() -> str:
    if os.name == "nt":
        return "cpu"
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def pick_dtype(device: str) -> str:
    return "float16" if device.startswith("cuda") else "float32"


def cache_path_for_source(src: Path) -> Path:
    stem = src.stem.replace(" ", "_")
    return CACHE_DIR / f"{stem}-24k.wav"


def run_ffmpeg_extract(src: Path, dst: Path) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        str(dst),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def load_or_prepare_clip(source_path: str) -> LoadedClip:
    src = Path(source_path).expanduser().resolve()
    if not src.exists():
        raise FileNotFoundError(f"Clip not found: {src}")

    cache_wav = cache_path_for_source(src)
    if not cache_wav.exists() or cache_wav.stat().st_mtime < src.stat().st_mtime:
        run_ffmpeg_extract(src, cache_wav)

    info = sf.info(str(cache_wav))
    return LoadedClip(
        source_path=str(src),
        cache_wav_path=str(cache_wav),
        sample_rate=int(info.samplerate),
        duration=float(info.duration),
    )


def build_waveform_overview(cache_wav_path: str, num_bins: int = 1800) -> WaveformOverview:
    wav, sr = sf.read(cache_wav_path, dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)

    total = len(wav)
    if total == 0:
        return WaveformOverview(duration=0.0, xs=[0.0], lows=[0.0], highs=[0.0])

    duration = total / sr
    num_bins = max(64, min(num_bins, total))
    edges = np.linspace(0, total, num_bins + 1, dtype=np.int64)
    xs: list[float] = []
    lows: list[float] = []
    highs: list[float] = []
    for idx in range(num_bins):
        start = int(edges[idx])
        end = int(edges[idx + 1])
        if end <= start:
            end = min(total, start + 1)
        seg = wav[start:end]
        xs.append(start / sr)
        lows.append(float(seg.min(initial=0.0)))
        highs.append(float(seg.max(initial=0.0)))
    return WaveformOverview(duration=duration, xs=xs, lows=lows, highs=highs)


def clamp_window(duration: float, start_sec: float, end_sec: float) -> tuple[float, float]:
    start = max(0.0, min(float(start_sec), duration))
    end = max(start + 0.1, min(float(end_sec), duration))
    if end - start > duration:
        start = 0.0
        end = duration
    return round(start, 3), round(end, 3)


def read_window_audio(cache_wav_path: str, start_sec: float, end_sec: float) -> tuple[np.ndarray, int]:
    info = sf.info(cache_wav_path)
    sr = int(info.samplerate)
    start, end = clamp_window(float(info.duration), start_sec, end_sec)

    start_frame = int(start * sr)
    end_frame = int(end * sr)
    frames = max(1, end_frame - start_frame)
    wav, _ = sf.read(cache_wav_path, start=start_frame, frames=frames, dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    return wav, sr


def window_status(clip: LoadedClip, start_sec: float, end_sec: float) -> str:
    width = max(0.0, end_sec - start_sec)
    return f"Previewing {start_sec:.2f}s to {end_sec:.2f}s ({width:.2f}s window of {clip.duration:.2f}s clip)"


def audio_bytes(wav: np.ndarray, sr: int) -> io.BytesIO:
    buffer = io.BytesIO()
    sf.write(buffer, wav, sr, format="WAV")
    buffer.seek(0)
    return buffer


def save_window_to_temp(cache_wav_path: str, start_sec: float, end_sec: float) -> str:
    wav, sr = read_window_audio(cache_wav_path, start_sec, end_sec)
    handle = tempfile.NamedTemporaryFile(prefix="voice-clone-window-", suffix=".wav", delete=False)
    handle.close()
    sf.write(handle.name, wav, sr)
    return handle.name


def create_app() -> FastAPI:
    for required_binary in ("sox", "ffmpeg"):
        require_binary(required_binary)

    app = FastAPI(title="Qwen Voice Clone Lab")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")
    app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/api/defaults")
    def defaults() -> JSONResponse:
        device = auto_device()
        return JSONResponse(
            {
                "default_clip": "",
                "default_target_text": DEFAULT_TARGET_TEXT,
                "default_model": DEFAULT_MODEL,
                "default_device": device,
                "default_dtype": pick_dtype(device),
            }
        )

    @app.post("/api/load-clip")
    def load_clip(request: ClipRequest) -> JSONResponse:
        try:
            clip = load_or_prepare_clip(request.source_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.strip() or exc.stdout.strip() or str(exc)
            raise HTTPException(status_code=500, detail=f"ffmpeg extraction failed: {stderr}") from exc

        overview = build_waveform_overview(clip.cache_wav_path)
        end_sec = min(10.0, clip.duration)
        return JSONResponse(
            {
                "clip": asdict(clip),
                "waveform": asdict(overview),
                "window": {
                    "start_sec": 0.0,
                    "end_sec": round(end_sec, 3),
                    "status": window_status(clip, 0.0, end_sec),
                },
            }
        )

    @app.post("/api/upload-clip")
    async def upload_clip(file: UploadFile = File(...)) -> JSONResponse:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file selected.")

        safe_name = Path(file.filename).name
        destination = UPLOAD_DIR / safe_name
        stem = destination.stem
        suffix = destination.suffix
        counter = 1
        while destination.exists():
            destination = UPLOAD_DIR / f"{stem}-{counter}{suffix}"
            counter += 1

        with destination.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
        await file.close()
        return JSONResponse({"source_path": str(destination), "filename": destination.name})

    @app.post("/api/asr")
    def transcribe_window(request: AsrRequest) -> JSONResponse:
        try:
            clip = load_or_prepare_clip(request.source_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        start_sec, end_sec = clamp_window(clip.duration, request.start_sec, request.end_sec)
        tmp_wav = save_window_to_temp(clip.cache_wav_path, start_sec, end_sec)
        try:
            asr = RUNTIME.get_asr(request.asr_device)
            result = asr(
                tmp_wav,
                chunk_length_s=25,
                batch_size=8,
                return_timestamps=True,
                generate_kwargs={"language": "zh"},
            )
        finally:
            Path(tmp_wav).unlink(missing_ok=True)

        return JSONResponse(
            {
                "text": normalize_text(result.get("text", "")),
                "status": f"ASR complete for {start_sec:.2f}s to {end_sec:.2f}s",
                "start_sec": start_sec,
                "end_sec": end_sec,
            }
        )

    @app.post("/api/preview")
    def preview_window(request: WindowRequest) -> StreamingResponse:
        try:
            clip = load_or_prepare_clip(request.source_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        start_sec, end_sec = clamp_window(clip.duration, request.start_sec, request.end_sec)
        wav, sr = read_window_audio(clip.cache_wav_path, start_sec, end_sec)
        headers = {
            "X-Start-Sec": str(start_sec),
            "X-End-Sec": str(end_sec),
            "X-Status": window_status(clip, start_sec, end_sec),
        }
        return StreamingResponse(audio_bytes(wav, sr), media_type="audio/wav", headers=headers)

    @app.post("/api/generate")
    def generate_audio(request: GenerateRequest) -> JSONResponse:
        try:
            clip = load_or_prepare_clip(request.source_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        ref_text = normalize_text(request.ref_text)
        target_text = normalize_text(request.target_text)
        if not ref_text:
            raise HTTPException(status_code=400, detail="Reference text is required.")
        if not target_text:
            raise HTTPException(status_code=400, detail="Target text is required.")

        start_sec, end_sec = clamp_window(clip.duration, request.start_sec, request.end_sec)
        tmp_wav = save_window_to_temp(clip.cache_wav_path, start_sec, end_sec)
        try:
            model = RUNTIME.get_tts(request.model_name, request.device, request.dtype_name)
            wavs, sr = model.generate_voice_clone(
                text=target_text,
                language="Chinese",
                ref_audio=tmp_wav,
                ref_text=ref_text,
                x_vector_only_mode=False,
                max_new_tokens=2048,
                do_sample=True,
                top_k=30,
                top_p=0.95,
                temperature=0.8,
                repetition_penalty=1.05,
                subtalker_dosample=True,
                subtalker_top_k=30,
                subtalker_top_p=0.95,
                subtalker_temperature=0.8,
            )
        finally:
            Path(tmp_wav).unlink(missing_ok=True)

        output_name = f"voice-clone-lab-{torch.randint(0, 10_000_000, ()).item():07d}.wav"
        output_path = OUTPUT_DIR / output_name
        sf.write(output_path, wavs[0], sr)
        return JSONResponse(
            {
                "output_name": output_name,
                "output_url": f"/outputs/{output_name}",
                "status": f"Generated from {start_sec:.2f}s to {end_sec:.2f}s using `{request.device}` / `{request.dtype_name}`",
                "start_sec": start_sec,
                "end_sec": end_sec,
            }
        )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the Qwen3-TTS voice clone web app.")
    parser.add_argument("--ip", default="127.0.0.1", help="Bind IP.")
    parser.add_argument("--port", type=int, default=7861, help="Bind port.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(), host=args.ip, port=args.port, log_level="info")

