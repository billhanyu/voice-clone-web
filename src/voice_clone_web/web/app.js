const state = {
  clip: null,
  waveform: null,
  startSec: 0,
  endSec: 10,
  previewUrl: null,
  drag: {
    active: false,
    startX: 0,
    currentX: 0,
  },
};

const els = {
  clipFileInput: document.getElementById("clipFileInput"),
  clipName: document.getElementById("clipName"),
  loadClipBtn: document.getElementById("loadClipBtn"),
  clipMeta: document.getElementById("clipMeta"),
  waveformCanvas: document.getElementById("waveformCanvas"),
  startNumber: document.getElementById("startNumber"),
  endNumber: document.getElementById("endNumber"),
  startRange: document.getElementById("startRange"),
  endRange: document.getElementById("endRange"),
  windowStatus: document.getElementById("windowStatus"),
  previewBtn: document.getElementById("previewBtn"),
  previewAudio: document.getElementById("previewAudio"),
  asrBtn: document.getElementById("asrBtn"),
  refText: document.getElementById("refText"),
  targetText: document.getElementById("targetText"),
  generateBtn: document.getElementById("generateBtn"),
  generatedAudio: document.getElementById("generatedAudio"),
  savedWavLink: document.getElementById("savedWavLink"),
  statusBox: document.getElementById("statusBox"),
  asrDevice: document.getElementById("asrDevice"),
  genDevice: document.getElementById("genDevice"),
  genDtype: document.getElementById("genDtype"),
  modelName: document.getElementById("modelName"),
  narrowerBtn: document.getElementById("narrowerBtn"),
  widerBtn: document.getElementById("widerBtn"),
};

function setStatus(message) {
  els.statusBox.textContent = message;
}

function setWindowStatus(message) {
  els.windowStatus.textContent = message;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      detail = data.detail || JSON.stringify(data);
    } catch (error) {
    }
    throw new Error(detail);
  }
  return response;
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/upload-clip", { method: "POST", body: formData });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      detail = data.detail || JSON.stringify(data);
    } catch (error) {
    }
    throw new Error(detail);
  }
  return response.json();
}

function formatSeconds(value) {
  return Number(value || 0).toFixed(2);
}

function clampWindow(startSec, endSec) {
  if (!state.clip) return { startSec, endSec };
  const duration = state.clip.duration;
  const start = Math.max(0, Math.min(startSec, duration));
  const end = Math.max(start + 0.1, Math.min(endSec, duration));
  return { startSec: start, endSec: end };
}

function setWindow(startSec, endSec, { render = true } = {}) {
  const next = clampWindow(startSec, endSec);
  state.startSec = Number(next.startSec.toFixed(3));
  state.endSec = Number(next.endSec.toFixed(3));
  els.startNumber.value = state.startSec;
  els.endNumber.value = state.endSec;
  els.startRange.value = state.startSec;
  els.endRange.value = state.endSec;
  if (render) renderWaveform();
}

function updateClipMeta() {
  if (!state.clip) {
    els.clipMeta.textContent = "";
    return;
  }
  els.clipMeta.textContent =
    `Loaded: ${state.clip.source_path}\n` +
    `Cached WAV: ${state.clip.cache_wav_path}\n` +
    `Sample rate: ${state.clip.sample_rate} Hz\n` +
    `Duration: ${formatSeconds(state.clip.duration)} s`;
}

function sizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 1200;
  const height = 280;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function xForTime(time, width) {
  const duration = Math.max(state.waveform?.duration || 1, 0.001);
  return (time / duration) * width;
}

function drawSelection(ctx, width, height, startSec, endSec, fill, stroke) {
  const left = xForTime(startSec, width);
  const right = xForTime(endSec, width);
  ctx.fillStyle = fill;
  ctx.fillRect(left, 0, Math.max(2, right - left), height - 22);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(left, 0, Math.max(2, right - left), height - 22);
}

function renderWaveform() {
  const canvas = els.waveformCanvas;
  const { ctx, width, height } = sizeCanvas(canvas);

  ctx.fillStyle = "#f7fbff";
  ctx.fillRect(0, 0, width, height);

  if (!state.waveform) return;

  drawSelection(ctx, width, height, state.startSec, state.endSec, "rgba(31,111,255,0.18)", "#4b8dff");

  if (state.drag.active) {
    const leftPx = Math.min(state.drag.startX, state.drag.currentX);
    const rightPx = Math.max(state.drag.startX, state.drag.currentX);
    const duration = Math.max(state.waveform.duration, 0.001);
    drawSelection(
      ctx,
      width,
      height,
      (leftPx / width) * duration,
      (rightPx / width) * duration,
      "rgba(255,162,57,0.2)",
      "#ffb24c",
    );
  }

  const baseline = (height - 22) / 2;
  ctx.strokeStyle = "#d4deef";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  ctx.lineTo(width, baseline);
  ctx.stroke();

  ctx.strokeStyle = "#1f56eb";
  ctx.lineWidth = 1.25;
  for (let i = 0; i < state.waveform.xs.length; i += 1) {
    const x = xForTime(state.waveform.xs[i], width);
    const y1 = baseline - state.waveform.highs[i] * ((height - 22) * 0.42);
    const y2 = baseline - state.waveform.lows[i] * ((height - 22) * 0.42);
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
  }

  ctx.strokeStyle = "#91a4bf";
  for (let i = 0; i <= 6; i += 1) {
    const x = (width / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, height - 18);
    ctx.lineTo(x, height - 8);
    ctx.stroke();
  }
}

function windowFromPixels(leftPx, rightPx) {
  const width = els.waveformCanvas.clientWidth || 1;
  const duration = Math.max(state.waveform?.duration || 1, 0.001);
  const left = Math.max(0, Math.min(leftPx, width));
  const right = Math.max(0, Math.min(rightPx, width));
  const delta = Math.abs(right - left);
  if (delta < 4) {
    const currentWidth = Math.max(0.1, state.endSec - state.startSec);
    const centerSec = (left / width) * duration;
    return clampWindow(centerSec - currentWidth / 2, centerSec + currentWidth / 2);
  }
  return clampWindow((Math.min(left, right) / width) * duration, (Math.max(left, right) / width) * duration);
}

async function updatePreview() {
  if (!state.clip) return;
  setStatus("Rendering preview...");
  const response = await postJson("/api/preview", {
    source_path: state.clip.source_path,
    start_sec: state.startSec,
    end_sec: state.endSec,
  });
  const blob = await response.blob();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(blob);
  els.previewAudio.src = state.previewUrl;
  setWindow(
    Number(response.headers.get("X-Start-Sec") || state.startSec),
    Number(response.headers.get("X-End-Sec") || state.endSec),
  );
  setWindowStatus(response.headers.get("X-Status") || "");
  setStatus("Preview updated.");
}

async function loadClipFromSource(sourcePath) {
  setStatus("Loading clip...");
  const response = await postJson("/api/load-clip", { source_path: sourcePath });
  const data = await response.json();
  state.clip = data.clip;
  state.waveform = data.waveform;
  els.clipName.value = state.clip.source_path.split(/[\\/]/).pop();
  els.clipName.dataset.sourcePath = state.clip.source_path;
  updateClipMeta();
  els.startRange.max = state.clip.duration;
  els.endRange.max = state.clip.duration;
  els.startNumber.max = state.clip.duration;
  els.endNumber.max = state.clip.duration;
  setWindow(data.window.start_sec, data.window.end_sec);
  setWindowStatus(data.window.status);
  renderWaveform();
  await updatePreview();
}

async function chooseClip() {
  els.clipFileInput.click();
}

async function handleFileSelection() {
  const file = els.clipFileInput.files?.[0];
  if (!file) return;
  els.clipName.value = file.name;
  setStatus("Uploading clip...");
  const data = await uploadFile(file);
  await loadClipFromSource(data.source_path);
}

async function runAsr() {
  if (!state.clip) return;
  setStatus("Running ASR...");
  const response = await postJson("/api/asr", {
    source_path: state.clip.source_path,
    start_sec: state.startSec,
    end_sec: state.endSec,
    asr_device: els.asrDevice.value,
  });
  const data = await response.json();
  els.refText.value = data.text;
  setStatus(data.status);
}

async function generateAudio() {
  if (!state.clip) return;
  setStatus("Generating cloned audio...");
  const response = await postJson("/api/generate", {
    source_path: state.clip.source_path,
    start_sec: state.startSec,
    end_sec: state.endSec,
    ref_text: els.refText.value,
    target_text: els.targetText.value,
    model_name: els.modelName.value,
    device: els.genDevice.value,
    dtype_name: els.genDtype.value,
  });
  const data = await response.json();
  els.generatedAudio.src = data.output_url;
  els.savedWavLink.href = data.output_url;
  els.savedWavLink.classList.remove("hidden");
  setStatus(data.status);
}

function refreshStatusOnly() {
  if (!state.clip) return;
  setWindowStatus(
    `Previewing ${formatSeconds(state.startSec)}s to ${formatSeconds(state.endSec)}s ` +
    `(${formatSeconds(state.endSec - state.startSec)}s window of ${formatSeconds(state.clip.duration)}s clip)`
  );
}

function applyNumericInputs() {
  setWindow(Number(els.startNumber.value), Number(els.endNumber.value));
  refreshStatusOnly();
}

function nudgeWindow(delta) {
  setWindow(state.startSec + delta, state.endSec + delta);
  refreshStatusOnly();
}

function resizeWindow(factor) {
  const center = (state.startSec + state.endSec) / 2;
  const half = Math.max(0.05, ((state.endSec - state.startSec) * factor) / 2);
  setWindow(center - half, center + half);
  refreshStatusOnly();
}

function canvasX(event) {
  const rect = els.waveformCanvas.getBoundingClientRect();
  return Math.max(0, Math.min(event.clientX - rect.left, rect.width));
}

function bindWaveformDrag() {
  els.waveformCanvas.addEventListener("pointerdown", (event) => {
    if (!state.waveform) return;
    state.drag.active = true;
    state.drag.startX = canvasX(event);
    state.drag.currentX = state.drag.startX;
    els.waveformCanvas.setPointerCapture(event.pointerId);
    renderWaveform();
  });

  els.waveformCanvas.addEventListener("pointermove", (event) => {
    if (!state.drag.active) return;
    state.drag.currentX = canvasX(event);
    renderWaveform();
  });

  els.waveformCanvas.addEventListener("pointerup", async (event) => {
    if (!state.drag.active) return;
    state.drag.currentX = canvasX(event);
    const next = windowFromPixels(state.drag.startX, state.drag.currentX);
    state.drag.active = false;
    setWindow(next.startSec, next.endSec);
    renderWaveform();
    await updatePreview();
  });

  els.waveformCanvas.addEventListener("pointercancel", () => {
    state.drag.active = false;
    renderWaveform();
  });
}

async function boot() {
  const defaults = await fetch("/api/defaults").then((response) => response.json());
  els.targetText.value = defaults.default_target_text;
  els.modelName.value = defaults.default_model;
  els.asrDevice.value = defaults.default_device;
  els.genDevice.value = defaults.default_device;
  els.genDtype.value = defaults.default_dtype;

  bindWaveformDrag();
  window.addEventListener("resize", renderWaveform);

  els.loadClipBtn.addEventListener("click", () => chooseClip().catch((error) => setStatus(error.message)));
  els.clipFileInput.addEventListener("change", () => handleFileSelection().catch((error) => setStatus(error.message)));
  els.previewBtn.addEventListener("click", () => updatePreview().catch((error) => setStatus(error.message)));
  els.asrBtn.addEventListener("click", () => runAsr().catch((error) => setStatus(error.message)));
  els.generateBtn.addEventListener("click", () => generateAudio().catch((error) => setStatus(error.message)));

  els.startNumber.addEventListener("change", applyNumericInputs);
  els.endNumber.addEventListener("change", applyNumericInputs);
  els.startRange.addEventListener("input", () => {
    setWindow(Number(els.startRange.value), state.endSec);
    refreshStatusOnly();
  });
  els.endRange.addEventListener("input", () => {
    setWindow(state.startSec, Number(els.endRange.value));
    refreshStatusOnly();
  });
  els.startRange.addEventListener("change", () => updatePreview().catch((error) => setStatus(error.message)));
  els.endRange.addEventListener("change", () => updatePreview().catch((error) => setStatus(error.message)));

  document.querySelectorAll("[data-nudge]").forEach((button) => {
    button.addEventListener("click", () => {
      nudgeWindow(Number(button.dataset.nudge));
      updatePreview().catch((error) => setStatus(error.message));
    });
  });

  els.narrowerBtn.addEventListener("click", () => {
    resizeWindow(0.8);
    updatePreview().catch((error) => setStatus(error.message));
  });

  els.widerBtn.addEventListener("click", () => {
    resizeWindow(1.25);
    updatePreview().catch((error) => setStatus(error.message));
  });
}

boot().catch((error) => setStatus(error.message));
