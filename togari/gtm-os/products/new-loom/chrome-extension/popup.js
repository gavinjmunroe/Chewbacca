// ── New Loom Popup Controller ─────────────────────────────────────────────────

const API_BASE = 'http://localhost:4200';

// ── State ─────────────────────────────────────────────────────────────────────

const appState = {
  currentStep: 'record',
  isRecording: false,
  isPaused: false,
  recordingId: null,
  cameraEnabled: false,
  selectedMicId: null,
  selectedVoiceId: null,
  selectedVoiceName: null,
  transcript: null,
  transformedScript: null,
  synthesizedAudio: null,
  timerInterval: null,
  recordingStartTime: null,
};

// ── DOM References ────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Steps
  steps: $$('.step'),
  stepContents: $$('.step-content'),
  // Record
  btnRecord: $('#btn-record'),
  btnStop: $('#btn-stop'),
  btnPause: $('#btn-pause'),
  timerDisplay: $('#timer-display'),
  optScreen: $('#opt-screen'),
  optCamera: $('#opt-camera'),
  micSelect: $('#mic-select'),
  // Process
  btnTranscribe: $('#btn-transcribe'),
  uploadProgress: $('#upload-progress'),
  transcriptResult: $('#transcript-result'),
  transcriptText: $('#transcript-text'),
  transcriptWords: $('#transcript-words'),
  transcriptDuration: $('#transcript-duration'),
  // Transform
  btnTransform: $('#btn-transform'),
  transformStructure: $('#transform-structure'),
  transformResult: $('#transform-result'),
  transformText: $('#transform-text'),
  transformScore: $('#transform-score'),
  transformStructureUsed: $('#transform-structure-used'),
  transformChanges: $('#transform-changes'),
  transformationsList: $('#transformations-list'),
  // Generate
  voiceGrid: $('#voice-grid'),
  btnSynthesize: $('#btn-synthesize'),
  synthResult: $('#synth-result'),
  synthAudio: $('#synth-audio'),
  synthVoice: $('#synth-voice'),
  synthDuration: $('#synth-duration'),
  // Share
  shareLink: $('#share-link'),
  btnCopyLink: $('#btn-copy-link'),
  btnDownloadVideo: $('#btn-download-video'),
  btnDownloadAudio: $('#btn-download-audio'),
  btnDownloadScript: $('#btn-download-script'),
  shareOriginalWords: $('#share-original-words'),
  shareTransformedWords: $('#share-transformed-words'),
  shareScore: $('#share-score'),
  // Header
  btnHistory: $('#btn-history'),
};

// ── Initialization ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initStepNavigation();
  initRecordControls();
  initProcessControls();
  initTransformControls();
  initGenerateControls();
  initShareControls();
  loadMicrophones();
  syncBackgroundState();
});

// ── Step Navigation ───────────────────────────────────────────────────────────

function initStepNavigation() {
  els.steps.forEach((stepEl) => {
    stepEl.addEventListener('click', () => {
      const step = stepEl.dataset.step;
      navigateToStep(step);
    });
  });
}

function navigateToStep(step) {
  appState.currentStep = step;

  // Update step indicators
  const stepOrder = ['record', 'process', 'transform', 'generate', 'share'];
  const targetIndex = stepOrder.indexOf(step);

  els.steps.forEach((stepEl, i) => {
    stepEl.classList.remove('active', 'completed');
    if (i < targetIndex) {
      stepEl.classList.add('completed');
    } else if (i === targetIndex) {
      stepEl.classList.add('active');
    }
  });

  // Show correct panel
  els.stepContents.forEach((panel) => {
    panel.classList.remove('active');
  });
  const targetPanel = $(`#panel-${step}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
}

// ── Record Controls ───────────────────────────────────────────────────────────

function initRecordControls() {
  els.btnRecord.addEventListener('click', startRecording);
  els.btnStop.addEventListener('click', stopRecording);
  els.btnPause.addEventListener('click', togglePause);

  els.optCamera.addEventListener('click', () => {
    appState.cameraEnabled = !appState.cameraEnabled;
    els.optCamera.classList.toggle('selected', appState.cameraEnabled);
  });

  els.micSelect.addEventListener('change', (e) => {
    appState.selectedMicId = e.target.value || null;
  });
}

async function loadMicrophones() {
  try {
    // Request permission first
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');

    els.micSelect.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default Microphone';
    els.micSelect.appendChild(defaultOpt);

    mics.forEach((mic) => {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`;
      els.micSelect.appendChild(opt);
    });
  } catch (err) {
    els.micSelect.innerHTML = '<option value="">Microphone access required</option>';
  }
}

function startRecording() {
  chrome.runtime.sendMessage({
    action: 'START_RECORDING',
    cameraEnabled: appState.cameraEnabled,
    audioDeviceId: appState.selectedMicId,
  }, (response) => {
    if (response?.error) {
      showError('Record', response.error);
      return;
    }

    appState.isRecording = true;
    appState.recordingStartTime = Date.now();

    els.btnRecord.style.display = 'none';
    els.btnStop.style.display = 'flex';
    els.btnPause.style.display = 'flex';
    els.timerDisplay.style.display = 'block';

    startTimer();
  });
}

function stopRecording() {
  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (response) => {
    if (response?.error) {
      showError('Stop', response.error);
      return;
    }

    appState.isRecording = false;
    appState.isPaused = false;

    els.btnRecord.style.display = 'flex';
    els.btnStop.style.display = 'none';
    els.btnPause.style.display = 'none';

    stopTimer();

    // Auto-advance to Process step after a short delay for upload
    showUploading();
  });
}

function togglePause() {
  if (appState.isPaused) {
    chrome.runtime.sendMessage({ action: 'RESUME_RECORDING' });
    appState.isPaused = false;
    els.btnPause.innerHTML = '&#9208; Pause';
  } else {
    chrome.runtime.sendMessage({ action: 'PAUSE_RECORDING' });
    appState.isPaused = true;
    els.btnPause.innerHTML = '&#9654; Resume';
  }
}

function startTimer() {
  if (appState.timerInterval) clearInterval(appState.timerInterval);
  appState.timerInterval = setInterval(() => {
    if (!appState.recordingStartTime) return;
    const elapsed = Math.floor((Date.now() - appState.recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    els.timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

function showUploading() {
  navigateToStep('process');
  els.uploadProgress.style.display = 'block';
  const fill = els.uploadProgress.querySelector('.progress-fill');

  // Simulate upload progress
  let progress = 0;
  const uploadInterval = setInterval(() => {
    progress += Math.random() * 15;
    if (progress >= 95) {
      clearInterval(uploadInterval);
      progress = 95;
    }
    fill.style.width = `${progress}%`;
  }, 300);

  // Listen for upload completion from background
  const checkUpload = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, (state) => {
      if (state?.currentRecordingId) {
        clearInterval(checkUpload);
        clearInterval(uploadInterval);
        fill.style.width = '100%';

        appState.recordingId = state.currentRecordingId;
        els.btnTranscribe.disabled = false;

        setTimeout(() => {
          els.uploadProgress.style.display = 'none';
        }, 500);
      }
    });
  }, 1000);
}

// ── Process Controls ──────────────────────────────────────────────────────────

function initProcessControls() {
  els.btnTranscribe.addEventListener('click', transcribe);
}

async function transcribe() {
  if (!appState.recordingId) return;

  els.btnTranscribe.disabled = true;
  els.btnTranscribe.innerHTML = '<span class="spinner"></span> Transcribing...';

  chrome.runtime.sendMessage({
    action: 'TRANSCRIBE',
    recordingId: appState.recordingId,
  }, (response) => {
    if (response?.error) {
      showError('Transcribe', response.error);
      els.btnTranscribe.disabled = false;
      els.btnTranscribe.textContent = 'Transcribe Audio';
      return;
    }

    appState.transcript = response;

    // Show results
    els.transcriptResult.style.display = 'block';
    els.transcriptText.textContent = response.fullText;
    els.transcriptWords.textContent = response.wordCount;

    const durationSec = Math.floor(response.durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    els.transcriptDuration.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    els.btnTranscribe.innerHTML = '&#10003; Transcribed';
    els.btnTranscribe.classList.add('success');

    // Enable transform
    els.btnTransform.disabled = false;

    // Auto-advance after 1 second
    setTimeout(() => navigateToStep('transform'), 1000);
  });
}

// ── Transform Controls ────────────────────────────────────────────────────────

function initTransformControls() {
  els.btnTransform.addEventListener('click', transform);
}

async function transform() {
  if (!appState.recordingId) return;

  const targetStructure = els.transformStructure.value;

  els.btnTransform.disabled = true;
  els.btnTransform.innerHTML = '<span class="spinner"></span> Transforming...';

  chrome.runtime.sendMessage({
    action: 'TRANSFORM',
    recordingId: appState.recordingId,
    targetStructure,
  }, (response) => {
    if (response?.error) {
      showError('Transform', response.error);
      els.btnTransform.disabled = false;
      els.btnTransform.textContent = 'Transform with BMA Modules';
      return;
    }

    appState.transformedScript = response;

    // Show results
    els.transformResult.style.display = 'block';
    els.transformText.textContent = response.transformedText;
    els.transformScore.textContent = response.improvementScore;
    els.transformStructureUsed.textContent = response.structureUsed.replace(/_/g, ' ');
    els.transformChanges.textContent = response.transformationsApplied.length;

    // Show transformation details
    if (response.transformationsApplied.length > 0) {
      els.transformationsList.style.display = 'block';
      els.transformationsList.innerHTML = response.transformationsApplied
        .slice(0, 10) // Show first 10
        .map(t => `
          <div class="transformation-item">
            <div class="type">${t.moduleType.replace(/_/g, ' ')}</div>
            <div class="original">${escapeHtml(t.originalSnippet)}</div>
            <div class="transformed">${escapeHtml(t.transformedSnippet)}</div>
          </div>
        `).join('');
    }

    els.btnTransform.innerHTML = '&#10003; Transformed';
    els.btnTransform.classList.add('success');

    // Enable synthesize
    els.btnSynthesize.disabled = false;

    setTimeout(() => navigateToStep('generate'), 1000);
  });
}

// ── Generate Controls ─────────────────────────────────────────────────────────

function initGenerateControls() {
  // Voice selection
  const voiceCards = $$('.voice-card');
  voiceCards.forEach((card) => {
    card.addEventListener('click', () => {
      voiceCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.selectedVoiceId = card.dataset.voiceId;
      appState.selectedVoiceName = card.dataset.voiceName;

      if (appState.transformedScript) {
        els.btnSynthesize.disabled = false;
      }
    });
  });

  els.btnSynthesize.addEventListener('click', synthesize);

  // Try loading voices from API
  loadVoicesFromAPI();
}

async function loadVoicesFromAPI() {
  try {
    const response = await fetch(`${API_BASE}/api/voices`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.voices || data.voices.length === 0) return;

    els.voiceGrid.innerHTML = '';
    data.voices.slice(0, 8).forEach((voice) => {
      const card = document.createElement('div');
      card.className = 'voice-card';
      card.dataset.voiceId = voice.voiceId;
      card.dataset.voiceName = voice.name;
      card.innerHTML = `
        <div class="voice-name">${escapeHtml(voice.name)}</div>
        <div class="voice-category">${escapeHtml(voice.category)}</div>
      `;
      card.addEventListener('click', () => {
        $$('.voice-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        appState.selectedVoiceId = voice.voiceId;
        appState.selectedVoiceName = voice.name;
        if (appState.transformedScript) {
          els.btnSynthesize.disabled = false;
        }
      });
      els.voiceGrid.appendChild(card);
    });
  } catch (err) {
    // Silently fall back to hardcoded voices
  }
}

async function synthesize() {
  if (!appState.recordingId || !appState.selectedVoiceId) return;

  els.btnSynthesize.disabled = true;
  els.btnSynthesize.innerHTML = '<span class="spinner"></span> Generating...';

  chrome.runtime.sendMessage({
    action: 'SYNTHESIZE',
    recordingId: appState.recordingId,
    voiceId: appState.selectedVoiceId,
    voiceName: appState.selectedVoiceName,
  }, (response) => {
    if (response?.error) {
      showError('Synthesize', response.error);
      els.btnSynthesize.disabled = false;
      els.btnSynthesize.textContent = 'Generate Audio';
      return;
    }

    appState.synthesizedAudio = response;

    // Show results
    els.synthResult.style.display = 'block';
    els.synthAudio.src = `${API_BASE}${response.audioUrl}`;
    els.synthVoice.textContent = response.voiceName;

    const durationSec = Math.floor(response.durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    els.synthDuration.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    els.btnSynthesize.innerHTML = '&#10003; Generated';
    els.btnSynthesize.classList.add('success');

    setTimeout(() => navigateToStep('share'), 1000);
    populateSharePanel();
  });
}

// ── Share Controls ────────────────────────────────────────────────────────────

function initShareControls() {
  els.btnCopyLink.addEventListener('click', () => {
    const link = els.shareLink.value;
    if (link) {
      navigator.clipboard.writeText(link).then(() => {
        els.btnCopyLink.textContent = 'Copied!';
        setTimeout(() => {
          els.btnCopyLink.textContent = 'Copy';
        }, 2000);
      });
    }
  });

  els.btnDownloadVideo.addEventListener('click', () => {
    if (appState.recordingId) {
      downloadFile(`${API_BASE}/api/recordings/${appState.recordingId}`, 'recording.webm');
    }
  });

  els.btnDownloadAudio.addEventListener('click', () => {
    if (appState.synthesizedAudio?.audioUrl) {
      downloadFile(`${API_BASE}${appState.synthesizedAudio.audioUrl}`, 'transformed-audio.mp3');
    }
  });

  els.btnDownloadScript.addEventListener('click', () => {
    if (appState.transformedScript?.transformedText) {
      const blob = new Blob([appState.transformedScript.transformedText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      downloadFile(url, 'transformed-script.txt');
      URL.revokeObjectURL(url);
    }
  });
}

function populateSharePanel() {
  // Share link
  if (appState.recordingId) {
    els.shareLink.value = `${API_BASE}/api/recordings/${appState.recordingId}`;
  }

  // Stats
  if (appState.transformedScript) {
    els.shareOriginalWords.textContent = appState.transformedScript.wordCountOriginal;
    els.shareTransformedWords.textContent = appState.transformedScript.wordCountTransformed;
    els.shareScore.textContent = appState.transformedScript.improvementScore;
  }
}

// ── Background State Sync ─────────────────────────────────────────────────────

function syncBackgroundState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (state) => {
    if (!state) return;

    if (state.isRecording) {
      appState.isRecording = true;
      appState.recordingStartTime = state.startTime;
      els.btnRecord.style.display = 'none';
      els.btnStop.style.display = 'flex';
      els.btnPause.style.display = 'flex';
      els.timerDisplay.style.display = 'block';
      startTimer();
    }

    if (state.currentRecordingId) {
      appState.recordingId = state.currentRecordingId;
      els.btnTranscribe.disabled = false;
    }
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function showError(context, message) {
  console.error(`[New Loom] ${context}:`, message);
  // Could add a toast notification here
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function formatMs(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
}
