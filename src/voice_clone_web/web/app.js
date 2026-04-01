const state = {
  clip: null,
  waveform: null,
  runtimeDefaults: {
    device: "cpu",
    dtype: "float32",
    model: "",
  },
  sourceUrl: null,
  localSourceUrl: null,
  sourceKind: null,
  viewportStartSec: 0,
  viewportEndSec: 10,
  sourceCurrentSec: 0,
  playbackMode: "full",
  playbackStopSec: null,
  autoFollowPlayback: true,
  startSec: 0,
  endSec: 10,
  drag: {
    active: false,
    startX: 0,
    currentX: 0,
    mode: "select",
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
  sourcePlayBtn: document.getElementById("sourcePlayBtn"),
  windowPlayBtn: document.getElementById("windowPlayBtn"),
  playbackStatus: document.getElementById("playbackStatus"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomToWindowBtn: document.getElementById("zoomToWindowBtn"),
  fitAllBtn: document.getElementById("fitAllBtn"),
  viewportScroll: document.getElementById("viewportScroll"),
  viewportStatus: document.getElementById("viewportStatus"),
  sourceVideo: document.getElementById("sourceVideo"),
  sourceAudio: document.getElementById("sourceAudio"),
  asrBtn: document.getElementById("asrBtn"),
  asrProgress: document.getElementById("asrProgress"),
  genProgress: document.getElementById("genProgress"),
  refText: document.getElementById("refText"),
  targetText: document.getElementById("targetText"),
  generateBtn: document.getElementById("generateBtn"),
  generatedAudio: document.getElementById("generatedAudio"),
  audioPlayerUI: document.getElementById("audioPlayerUI"),
  audioPlayBtn: document.getElementById("audioPlayBtn"),
  audioCurrentTime: document.getElementById("audioCurrentTime"),
  audioSeek: document.getElementById("audioSeek"),
  audioDuration: document.getElementById("audioDuration"),
  savedWavLink: document.getElementById("savedWavLink"),
  statusBox: document.getElementById("statusBox"),
  referenceLanguageSelect: document.getElementById("referenceLanguageSelect"),
  outputLanguageSelect: document.getElementById("outputLanguageSelect"),
  validationBox: document.getElementById("validationBox"),
};

function formatAudioTime(sec) {
  if (!isFinite(sec)) return "–:––";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function bindAudioPlayer() {
  const audio = els.generatedAudio;
  els.audioPlayBtn.addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });
  audio.addEventListener("play",  () => els.audioPlayBtn.classList.add("is-active"));
  audio.addEventListener("pause", () => els.audioPlayBtn.classList.remove("is-active"));
  audio.addEventListener("ended", () => els.audioPlayBtn.classList.remove("is-active"));
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    els.audioCurrentTime.textContent = formatAudioTime(audio.currentTime);
    els.audioSeek.value = audio.currentTime / audio.duration;
  });
  audio.addEventListener("loadedmetadata", () => {
    els.audioDuration.textContent = formatAudioTime(audio.duration);
    els.audioSeek.value = 0;
    els.audioCurrentTime.textContent = "0:00";
    els.audioPlayerUI.classList.remove("hidden");
  });
  els.audioSeek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = Number(els.audioSeek.value) * audio.duration;
  });
}

function showProgress(el, label, pct) {
  el.classList.remove("hidden");
  el.querySelector(".progress-label").textContent = label;
  el.querySelector(".progress-fill").style.width = `${Math.max(2, pct)}%`;
  el.querySelector(".progress-pct").textContent = `${pct}%`;
}

function hideProgress(el) {
  el.classList.add("hidden");
}

function setStatus(message, tone = "info") {
  els.statusBox.textContent = message;
  els.statusBox.dataset.tone = tone;
  if (tone === "error") {
    els.validationBox.textContent = message;
    els.validationBox.dataset.state = "needs-attention";
  }
}

function setWindowStatus(message) {
  els.windowStatus.textContent = message;
}

function selectedReferenceLanguage() {
  return els.referenceLanguageSelect.value || "zh";
}

function selectedOutputLanguage() {
  return els.outputLanguageSelect.value || "zh";
}

function clipLoaded() {
  return Boolean(state.clip && state.waveform);
}

function hasWindowSelection() {
  return clipLoaded() && Number.isFinite(state.startSec) && Number.isFinite(state.endSec) && state.endSec - state.startSec >= 0.1;
}

function validationMessage() {
  if (!clipLoaded()) {
    return "Load a clip to enable ASR and generation.";
  }
  if (!hasWindowSelection()) {
    return "Create a reference window on the timeline before running ASR or generation.";
  }
  const refText = els.refText.value.trim();
  const targetText = els.targetText.value.trim();
  if (!refText && !targetText) {
    return "Add reference text and target text to generate audio.";
  }
  if (!refText) {
    return "Reference text is empty. Run ASR or type the spoken reference line.";
  }
  if (!targetText) {
    return "Target text is empty. Add the line you want the clone to speak.";
  }
  return "Ready to generate.";
}

function updateActionAvailability() {
  const readyForAsr = clipLoaded() && hasWindowSelection();
  const readyForGenerate = readyForAsr && Boolean(els.refText.value.trim()) && Boolean(els.targetText.value.trim());
  els.asrBtn.disabled = !readyForAsr;
  els.generateBtn.disabled = !readyForGenerate;
  els.windowPlayBtn.disabled = !readyForAsr;
  els.sourcePlayBtn.disabled = !clipLoaded();
  els.zoomInBtn.disabled = !clipLoaded();
  els.zoomOutBtn.disabled = !clipLoaded();
  els.zoomToWindowBtn.disabled = !readyForAsr;
  els.fitAllBtn.disabled = !clipLoaded();
  els.validationBox.textContent = validationMessage();
  els.validationBox.dataset.state = readyForGenerate ? "ready" : "needs-attention";
}

function requireClip(actionLabel) {
  if (clipLoaded()) return true;
  setStatus(`${actionLabel} needs a source clip first. Choose a clip to continue.`, "error");
  return false;
}

function requireWindow(actionLabel) {
  if (!requireClip(actionLabel)) return false;
  if (hasWindowSelection()) return true;
  setStatus(`${actionLabel} needs a reference window. Drag on the timeline to select one.`, "error");
  return false;
}

function requireTextValue(value, actionLabel, missingMessage) {
  if (value.trim()) return true;
  setStatus(`${actionLabel} ${missingMessage}`, "error");
  return false;
}

function activeSourcePlayer() {
  if (state.sourceKind === "video") return els.sourceVideo;
  if (state.sourceKind === "audio") return els.sourceAudio;
  return null;
}

function updateViewportStatus() {
  if (!state.clip) {
    els.viewportStatus.textContent = "Full timeline";
    els.viewportScroll.value = 0;
    return;
  }
  const width = Math.max(0, state.viewportEndSec - state.viewportStartSec);
  els.viewportStatus.textContent =
    `${formatSeconds(state.viewportStartSec)}s-${formatSeconds(state.viewportEndSec)}s ` +
    `view (${formatSeconds(width)}s wide)`;
  const duration = Math.max(state.clip.duration, width);
  const maxOffset = Math.max(duration - width, 0.001);
  const offset = Math.max(0, Math.min(state.viewportStartSec, maxOffset));
  const ratio = maxOffset <= 0.001 ? 0 : offset / maxOffset;
  els.viewportScroll.value = Math.round(ratio * 1000);
  els.viewportScroll.disabled = width >= duration;
}

function clampViewport(startSec, endSec) {
  if (!state.clip) return { startSec, endSec };
  const duration = Math.max(state.clip.duration, 0.1);
  const minWidth = Math.min(duration, 1.5);
  let start = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  let end = Math.min(duration, Number.isFinite(endSec) ? endSec : duration);
  if (end - start < minWidth) {
    const center = (start + end) / 2 || 0;
    start = Math.max(0, center - minWidth / 2);
    end = Math.min(duration, start + minWidth);
    start = Math.max(0, end - minWidth);
  }
  return {
    startSec: Number(start.toFixed(3)),
    endSec: Number(end.toFixed(3)),
  };
}

function setViewport(startSec, endSec, { render = true } = {}) {
  const next = clampViewport(startSec, endSec);
  state.viewportStartSec = next.startSec;
  state.viewportEndSec = next.endSec;
  updateViewportStatus();
  if (render) renderWaveform();
}

function fitViewportToClip({ render = true } = {}) {
  if (!state.clip) return;
  setViewport(0, state.clip.duration, { render });
}

function ensureTimeVisible(timeSec) {
  if (!state.clip) return;
  if (!state.autoFollowPlayback) return;
  if (timeSec >= state.viewportStartSec && timeSec <= state.viewportEndSec) return;
  const width = Math.max(1.5, state.viewportEndSec - state.viewportStartSec);
  setViewport(timeSec - width / 2, timeSec + width / 2);
}

function resetSourcePlayers() {
  [els.sourceVideo, els.sourceAudio].forEach((media) => {
    media.pause();
    media.removeAttribute("src");
    media.classList.add("hidden");
    media.load();
  });
}

function setSourceMedia(sourcePath) {
  resetSourcePlayers();
  if (state.localSourceUrl && state.localSourceUrl !== sourcePath) {
    URL.revokeObjectURL(state.localSourceUrl);
    state.localSourceUrl = null;
  }
  state.sourceUrl = sourcePath;
  state.sourceCurrentSec = 0;
  state.sourceKind = null;
  if (!sourcePath) return;

  const lowerPath = sourcePath.toLowerCase();
  const isVideo = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"].some((ext) => lowerPath.endsWith(ext));
  const player = isVideo ? els.sourceVideo : els.sourceAudio;
  state.sourceKind = isVideo ? "video" : "audio";
  player.src = sourcePath;
  player.classList.remove("hidden");
  player.load();
  els.playbackStatus.textContent = "Source ready.";
  els.sourcePlayBtn.classList.remove("is-active");
  els.windowPlayBtn.classList.remove("is-active");
  updateActionAvailability();
}

async function pollJob(jobId, onUpdate) {
  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch job ${jobId}`);
    }
    const job = await response.json();
    onUpdate(job);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || job.message || "Job failed");
    await new Promise((resolve) => window.setTimeout(resolve, 600));
  }
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
  const height = 150;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function xForTime(time, width) {
  const visibleDuration = Math.max(state.viewportEndSec - state.viewportStartSec, 0.001);
  return ((time - state.viewportStartSec) / visibleDuration) * width;
}

function timeForX(x, width) {
  const visibleDuration = Math.max(state.viewportEndSec - state.viewportStartSec, 0.001);
  return state.viewportStartSec + (x / width) * visibleDuration;
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
      timeForX(leftPx, width),
      timeForX(rightPx, width),
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
    const t = state.waveform.xs[i];
    if (t < state.viewportStartSec || t > state.viewportEndSec) continue;
    const x = xForTime(t, width);
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
    const tickTime = state.viewportStartSec + ((state.viewportEndSec - state.viewportStartSec) / 6) * i;
    ctx.fillStyle = "#5f7189";
    ctx.font = "12px Segoe UI";
    ctx.textAlign = i === 6 ? "right" : i === 0 ? "left" : "center";
    ctx.fillText(formatSeconds(tickTime), x, height - 2);
  }

  if (state.sourceCurrentSec >= state.viewportStartSec && state.sourceCurrentSec <= state.viewportEndSec) {
    const playheadX = xForTime(state.sourceCurrentSec, width);
    ctx.strokeStyle = "#ff6b57";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height - 22);
    ctx.stroke();
  }
}

function seekSourceMedia(timeSec, { autoPlay = false } = {}) {
  const media = activeSourcePlayer();
  if (!media || !state.clip) return;
  const clamped = Math.max(0, Math.min(timeSec, state.clip.duration));
  state.autoFollowPlayback = true;
  media.currentTime = clamped;
  state.sourceCurrentSec = clamped;
  ensureTimeVisible(clamped);
  els.playbackStatus.textContent = `At ${formatSeconds(clamped)}s of ${formatSeconds(state.clip.duration)}s`;
  renderWaveform();
  if (autoPlay) {
    media.play().catch((error) => setStatus(error.message));
  }
}

function startWindowPlayback() {
  const media = activeSourcePlayer();
  if (!media || !state.clip) return;
  state.playbackMode = "window";
  state.playbackStopSec = state.endSec;
  state.autoFollowPlayback = true;
  els.windowPlayBtn.classList.add("is-active");
  seekSourceMedia(state.startSec, { autoPlay: true });
}

function startFullPlayback() {
  state.playbackMode = "full";
  state.playbackStopSec = null;
  state.autoFollowPlayback = true;
  els.windowPlayBtn.classList.remove("is-active");
  const media = activeSourcePlayer();
  if (!media) return;
  if (media.paused) {
    media.play().catch((error) => setStatus(error.message));
  }
}

function resumePlayback() {
  const media = activeSourcePlayer();
  if (!media) return;
  state.autoFollowPlayback = true;
  if (state.playbackMode === "window") {
    state.playbackStopSec = state.endSec;
    els.windowPlayBtn.classList.add("is-active");
    if (media.currentTime < state.startSec || media.currentTime >= state.endSec) {
      media.currentTime = state.startSec;
      state.sourceCurrentSec = state.startSec;
    }
  }
  media.play().catch((error) => setStatus(error.message));
}

function applyWindowChange(startSec, endSec, { seekToStart = true, render = true } = {}) {
  setWindow(startSec, endSec, { render });
  state.playbackMode = "window";
  state.playbackStopSec = state.endSec;
  els.windowPlayBtn.classList.add("is-active");
  const media = activeSourcePlayer();
  const playheadInWindow = state.sourceCurrentSec >= state.startSec && state.sourceCurrentSec < state.endSec;
  if (seekToStart && !(media && !media.paused && playheadInWindow)) {
    seekSourceMedia(state.startSec);
  } else if (render) {
    renderWaveform();
  }
  refreshStatusOnly();
}

function windowFromPixels(leftPx, rightPx) {
  const width = els.waveformCanvas.clientWidth || 1;
  const left = Math.max(0, Math.min(leftPx, width));
  const right = Math.max(0, Math.min(rightPx, width));
  const delta = Math.abs(right - left);
  if (delta < 4) {
    const currentWidth = Math.max(0.1, state.endSec - state.startSec);
    const centerSec = timeForX(left, width);
    return clampWindow(centerSec - currentWidth / 2, centerSec + currentWidth / 2);
  }
  return clampWindow(timeForX(Math.min(left, right), width), timeForX(Math.max(left, right), width));
}

async function loadClipFromSource(sourcePath, sourceMediaUrl = null) {
  setStatus("Loading clip...");
  const response = await postJson("/api/load-clip", { source_path: sourcePath });
  const data = await response.json();
  state.clip = data.clip;
  state.waveform = data.waveform;
  els.clipName.textContent = state.clip.source_path.split(/[\\/]/).pop();
  els.clipName.dataset.sourcePath = state.clip.source_path;
  setSourceMedia(sourceMediaUrl || data.source_url);
  fitViewportToClip({ render: false });
  updateClipMeta();
  els.startRange.max = state.clip.duration;
  els.endRange.max = state.clip.duration;
  els.startNumber.max = state.clip.duration;
  els.endNumber.max = state.clip.duration;
  setWindow(data.window.start_sec, data.window.end_sec);
  setWindowStatus(data.window.status);
  renderWaveform();
  seekSourceMedia(data.window.start_sec);
  updateActionAvailability();
  setStatus("Clip loaded. Drag the timeline to refine the reference window.");
}

async function chooseClip() {
  els.clipFileInput.click();
}

async function handleFileSelection() {
  const file = els.clipFileInput.files?.[0];
  if (!file) return;
  els.clipName.textContent = file.name;
  setStatus("Uploading clip...");
  if (state.localSourceUrl) {
    URL.revokeObjectURL(state.localSourceUrl);
  }
  state.localSourceUrl = URL.createObjectURL(file);
  const data = await uploadFile(file);
  await loadClipFromSource(data.source_path, state.localSourceUrl);
}

async function runAsr() {
  if (!requireWindow("Auto ASR")) return;
  const previousRefText = els.refText.value;
  els.asrBtn.disabled = true;
  showProgress(els.asrProgress, "Running ASR…", 0);
  try {
    const response = await postJson("/api/asr", {
      source_path: state.clip.source_path,
      start_sec: state.startSec,
      end_sec: state.endSec,
      asr_device: state.runtimeDefaults.device,
      reference_language: selectedReferenceLanguage(),
    });
    const job = await response.json();
    const data = await pollJob(job.job_id, (nextJob) => {
      showProgress(els.asrProgress, nextJob.message || "Running ASR…", nextJob.progress);
    });
    els.refText.value = data.text;
    setStatus(data.status);
  } catch (error) {
    els.refText.value = previousRefText;
    throw error;
  } finally {
    hideProgress(els.asrProgress);
    updateActionAvailability();
  }
}

async function generateAudio() {
  if (!requireWindow("Generate")) return;
  if (!requireTextValue(els.refText.value, "Generate", "needs reference text first.")) return;
  if (!requireTextValue(els.targetText.value, "Generate", "needs target text first.")) return;
  els.generateBtn.disabled = true;
  showProgress(els.genProgress, "Starting…", 0);
  try {
    const response = await postJson("/api/generate", {
      source_path: state.clip.source_path,
      start_sec: state.startSec,
      end_sec: state.endSec,
      ref_text: els.refText.value,
      target_text: els.targetText.value,
      model_name: state.runtimeDefaults.model,
      device: state.runtimeDefaults.device,
      dtype_name: state.runtimeDefaults.dtype,
      reference_language: selectedReferenceLanguage(),
      output_language: selectedOutputLanguage(),
    });
    const job = await response.json();
    const data = await pollJob(job.job_id, (nextJob) => {
      showProgress(els.genProgress, nextJob.message || "Generating…", nextJob.progress);
    });
    els.generatedAudio.src = data.output_url;
    els.generatedAudio.load();
    els.savedWavLink.href = data.output_url;
    els.savedWavLink.classList.remove("hidden");
    setStatus(data.status);
  } finally {
    hideProgress(els.genProgress);
    updateActionAvailability();
  }
}

function refreshStatusOnly() {
  if (!state.clip) return;
  setWindowStatus(
    `Previewing ${formatSeconds(state.startSec)}s to ${formatSeconds(state.endSec)}s ` +
    `(${formatSeconds(state.endSec - state.startSec)}s window of ${formatSeconds(state.clip.duration)}s clip)`
  );
  updateActionAvailability();
}

function applyNumericInputs() {
  applyWindowChange(Number(els.startNumber.value), Number(els.endNumber.value));
}

function nudgeWindow(delta) {
  applyWindowChange(state.startSec + delta, state.endSec + delta);
}

function resizeWindow(factor) {
  const center = (state.startSec + state.endSec) / 2;
  const half = Math.max(0.05, ((state.endSec - state.startSec) * factor) / 2);
  applyWindowChange(center - half, center + half);
}

function zoomViewport(factor) {
  if (!requireClip("Zoom")) return;
  const currentWidth = Math.max(1.5, state.viewportEndSec - state.viewportStartSec);
  const center = (state.startSec + state.endSec) / 2;
  const nextWidth = Math.min(state.clip.duration, Math.max(1.5, currentWidth * factor));
  setViewport(center - nextWidth / 2, center + nextWidth / 2);
}

function zoomViewportToWindow() {
  if (!requireWindow("Zoom to selection")) return;
  const padding = Math.max(0.5, (state.endSec - state.startSec) * 0.35);
  setViewport(state.startSec - padding, state.endSec + padding);
}

function zoomAroundTime(anchorSec, factor) {
  if (!clipLoaded()) return;
  const currentWidth = Math.max(1.5, state.viewportEndSec - state.viewportStartSec);
  const nextWidth = Math.min(state.clip.duration, Math.max(1.5, currentWidth * factor));
  const ratio = currentWidth <= 0 ? 0.5 : (anchorSec - state.viewportStartSec) / currentWidth;
  const nextStart = anchorSec - nextWidth * ratio;
  setViewport(nextStart, nextStart + nextWidth);
}

function panViewportByPixels(deltaPixels) {
  if (!clipLoaded()) return;
  state.autoFollowPlayback = false;
  const widthPx = Math.max(els.waveformCanvas.clientWidth || 1, 1);
  const visibleDuration = Math.max(state.viewportEndSec - state.viewportStartSec, 1.5);
  const secondsPerPixel = visibleDuration / widthPx;
  const deltaSec = deltaPixels * secondsPerPixel;
  setViewport(state.viewportStartSec + deltaSec, state.viewportEndSec + deltaSec);
}

function canPanViewport(direction) {
  if (!clipLoaded()) return false;
  if (direction < 0) {
    return state.viewportStartSec > 0.001;
  }
  if (direction > 0) {
    return state.viewportEndSec < state.clip.duration - 0.001;
  }
  return false;
}

function canvasX(event) {
  const rect = els.waveformCanvas.getBoundingClientRect();
  return Math.max(0, Math.min(event.clientX - rect.left, rect.width));
}

function edgeDragMode(x) {
  if (!state.clip) return "select";
  const width = els.waveformCanvas.clientWidth || 1;
  const startX = xForTime(state.startSec, width);
  const endX = xForTime(state.endSec, width);
  const edgeThreshold = 8;
  if (Math.abs(x - startX) <= edgeThreshold) return "adjust-start";
  if (Math.abs(x - endX) <= edgeThreshold) return "adjust-end";
  return "select";
}

function updateWaveformCursor(x) {
  const mode = edgeDragMode(x);
  els.waveformCanvas.style.cursor = mode === "select" ? "crosshair" : "ew-resize";
}

function bindWaveformDrag() {
  els.waveformCanvas.addEventListener("pointerdown", (event) => {
    if (!state.waveform) {
      setStatus("Load a clip first, then drag on the timeline to create a reference window.", "error");
      return;
    }
    state.drag.active = true;
    state.drag.startX = canvasX(event);
    state.drag.currentX = state.drag.startX;
    state.drag.mode = edgeDragMode(state.drag.startX);
    els.waveformCanvas.setPointerCapture(event.pointerId);
    renderWaveform();
  });

  els.waveformCanvas.addEventListener("pointermove", (event) => {
    const x = canvasX(event);
    if (!state.drag.active) {
      updateWaveformCursor(x);
      return;
    }
    state.drag.currentX = x;
    renderWaveform();
  });

  els.waveformCanvas.addEventListener("pointerup", async (event) => {
    if (!state.drag.active) return;
    state.drag.currentX = canvasX(event);
    const next = windowFromPixels(state.drag.startX, state.drag.currentX);
    const isClick = Math.abs(state.drag.currentX - state.drag.startX) < 4;
    const dragMode = state.drag.mode;
    state.drag.active = false;
    els.waveformCanvas.releasePointerCapture(event.pointerId);
    if (isClick) {
      const width = els.waveformCanvas.clientWidth || 1;
      seekSourceMedia(timeForX(state.drag.currentX, width));
      return;
    }
    if (dragMode === "adjust-start") {
      applyWindowChange(timeForX(state.drag.currentX, els.waveformCanvas.clientWidth || 1), state.endSec);
      return;
    }
    if (dragMode === "adjust-end") {
      applyWindowChange(state.startSec, timeForX(state.drag.currentX, els.waveformCanvas.clientWidth || 1));
      return;
    }
    applyWindowChange(next.startSec, next.endSec);
  });

  els.waveformCanvas.addEventListener("pointercancel", () => {
    state.drag.active = false;
    renderWaveform();
  });

  els.waveformCanvas.addEventListener("wheel", (event) => {
    if (!state.clip) return;
    const mostlyHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const wantsPan = mostlyHorizontal || event.shiftKey;
    if (wantsPan) {
      event.preventDefault();
      const delta = mostlyHorizontal ? event.deltaX : event.deltaY;
      if (canPanViewport(Math.sign(delta))) {
        panViewportByPixels(delta);
      }
      return;
    }
    event.preventDefault();
    const width = els.waveformCanvas.clientWidth || 1;
    const anchorSec = timeForX(canvasX(event), width);
    const factor = Math.exp(event.deltaY * 0.003);
    zoomAroundTime(anchorSec, factor);
  }, { passive: false });
}

function bindSourcePlayback() {
  [els.sourceVideo, els.sourceAudio].forEach((media) => {
    media.addEventListener("timeupdate", () => {
      state.sourceCurrentSec = media.currentTime || 0;
      if (state.playbackMode === "window" && state.playbackStopSec !== null && state.sourceCurrentSec >= state.playbackStopSec) {
        state.playbackMode = "full";
        state.playbackStopSec = null;
        media.currentTime = state.startSec;
        state.sourceCurrentSec = state.startSec;
        media.pause();
        els.playbackStatus.textContent = "";
        renderWaveform();
        return;
      }
      ensureTimeVisible(state.sourceCurrentSec);
      els.playbackStatus.textContent = `At ${formatSeconds(state.sourceCurrentSec)}s of ${formatSeconds(state.clip?.duration || 0)}s`;
      renderWaveform();
    });
    media.addEventListener("play", () => {
      els.sourcePlayBtn.classList.add("is-active");
      if (state.playbackMode === "window") {
        els.windowPlayBtn.classList.add("is-active");
      }
    });
    media.addEventListener("pause", () => {
      els.sourcePlayBtn.classList.remove("is-active");
      if (state.playbackMode === "window") {
        els.windowPlayBtn.classList.add("is-active");
      } else {
        els.windowPlayBtn.classList.remove("is-active");
      }
    });
    media.addEventListener("seeked", () => {
      state.sourceCurrentSec = media.currentTime || 0;
      renderWaveform();
    });
  });
}

async function boot() {
  const defaults = await fetch("/api/defaults").then((response) => response.json());
  els.referenceLanguageSelect.innerHTML = "";
  els.outputLanguageSelect.innerHTML = "";
  defaults.language_options.forEach((option) => {
    const referenceOption = document.createElement("option");
    referenceOption.value = option.value;
    referenceOption.textContent = option.label;
    els.referenceLanguageSelect.appendChild(referenceOption);

    const outputOption = document.createElement("option");
    outputOption.value = option.value;
    outputOption.textContent = option.label;
    outputOption.dataset.defaultTargetText = option.default_target_text;
    els.outputLanguageSelect.appendChild(outputOption);
  });
  els.referenceLanguageSelect.value = defaults.default_reference_language;
  els.outputLanguageSelect.value = defaults.default_output_language;
  els.targetText.value = defaults.default_target_text;
  state.runtimeDefaults.model = defaults.default_model;
  state.runtimeDefaults.device = defaults.default_device;
  state.runtimeDefaults.dtype = defaults.default_dtype;
  updateActionAvailability();

  bindWaveformDrag();
  bindSourcePlayback();
  bindAudioPlayer();
  window.addEventListener("resize", renderWaveform);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    if (isTypingTarget) return;
    event.preventDefault();
    const media = activeSourcePlayer();
    if (!media) return;
    if (media.paused) {
      resumePlayback();
      return;
    }
    media.pause();
  });

  els.loadClipBtn.addEventListener("click", () => chooseClip().catch((error) => setStatus(error.message)));
  els.clipFileInput.addEventListener("change", () => handleFileSelection().catch((error) => setStatus(error.message)));
  els.asrBtn.addEventListener("click", () => runAsr().catch((error) => setStatus(error.message)));
  els.generateBtn.addEventListener("click", () => generateAudio().catch((error) => setStatus(error.message)));
  els.sourcePlayBtn.addEventListener("click", () => {
    const media = activeSourcePlayer();
    if (!media) {
      requireClip("Playback");
      return;
    }
    if (media.paused) {
      resumePlayback();
      return;
    }
    media.pause();
  });
  els.windowPlayBtn.addEventListener("click", () => {
    if (!requireWindow("Window playback")) return;
    const media = activeSourcePlayer();
    if (!media) return;
    const isActiveWindowPlayback = state.playbackMode === "window" && !media.paused;
    if (isActiveWindowPlayback) {
      state.playbackMode = "full";
      state.playbackStopSec = null;
      media.pause();
      return;
    }
    startWindowPlayback();
  });
  els.zoomInBtn.addEventListener("click", () => zoomViewport(0.35));
  els.zoomOutBtn.addEventListener("click", () => zoomViewport(2.85));
  els.zoomToWindowBtn.addEventListener("click", () => zoomViewportToWindow());
  els.fitAllBtn.addEventListener("click", () => fitViewportToClip());
  els.viewportScroll.addEventListener("input", () => {
    if (!clipLoaded()) return;
    state.autoFollowPlayback = false;
    const width = Math.max(1.5, state.viewportEndSec - state.viewportStartSec);
    const maxOffset = Math.max(state.clip.duration - width, 0);
    const ratio = Number(els.viewportScroll.value) / 1000;
    const start = maxOffset * ratio;
    setViewport(start, start + width);
  });
  els.outputLanguageSelect.addEventListener("change", () => {
    const option = els.outputLanguageSelect.selectedOptions[0];
    if (!option) return;
    const previousValue = els.targetText.value.trim();
    const knownDefaults = defaults.language_options.map((entry) => entry.default_target_text.trim());
    if (!previousValue || knownDefaults.includes(previousValue)) {
      els.targetText.value = option.dataset.defaultTargetText || "";
    }
    updateActionAvailability();
  });
  els.refText.addEventListener("input", updateActionAvailability);
  els.targetText.addEventListener("input", updateActionAvailability);

  [els.startNumber, els.endNumber].forEach((input) => {
    input.addEventListener("change", applyNumericInputs);
    input.addEventListener("blur", applyNumericInputs);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    });
  });

  els.startRange.addEventListener("input", () => {
    applyWindowChange(Number(els.startRange.value), state.endSec);
  });
  els.endRange.addEventListener("input", () => {
    applyWindowChange(state.startSec, Number(els.endRange.value));
  });

  document.querySelectorAll("[data-nudge]").forEach((button) => {
    button.addEventListener("click", () => {
      nudgeWindow(Number(button.dataset.nudge));
    });
  });
}

boot().catch((error) => setStatus(error.message));
