// ── New Loom Background Service Worker ────────────────────────────────────────

const API_BASE = 'http://localhost:4200';

// ── State Management ──────────────────────────────────────────────────────────

const state = {
  isRecording: false,
  isPaused: false,
  recordingTabId: null,
  streamId: null,
  startTime: null,
  currentRecordingId: null,
};

// ── Message Handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'GET_STATE':
      sendResponse({ ...state });
      return false;

    case 'START_RECORDING':
      handleStartRecording(message, sender)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'STOP_RECORDING':
      handleStopRecording()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'PAUSE_RECORDING':
      state.isPaused = true;
      notifyContentScript('PAUSE');
      sendResponse({ paused: true });
      return false;

    case 'RESUME_RECORDING':
      state.isPaused = false;
      notifyContentScript('RESUME');
      sendResponse({ paused: false });
      return false;

    case 'UPLOAD_RECORDING':
      handleUpload(message.blob, message.title)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'TRANSCRIBE':
      handleTranscribe(message.recordingId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'TRANSFORM':
      handleTransform(message.recordingId, message.targetStructure)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'SYNTHESIZE':
      handleSynthesize(message.recordingId, message.voiceId, message.voiceName)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GET_RECORDING':
      handleGetRecording(message.recordingId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'LIST_RECORDINGS':
      handleListRecordings()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    default:
      sendResponse({ error: `Unknown action: ${message.action}` });
      return false;
  }
});

// ── Recording Handlers ────────────────────────────────────────────────────────

async function handleStartRecording(message, sender) {
  if (state.isRecording) {
    return { error: 'Already recording' };
  }

  const tab = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tab[0];
  if (!activeTab?.id) {
    return { error: 'No active tab found' };
  }

  // Request tab capture
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(id);
      }
    });
  });

  state.isRecording = true;
  state.isPaused = false;
  state.recordingTabId = activeTab.id;
  state.streamId = streamId;
  state.startTime = Date.now();

  // Tell content script to start recording with the stream ID
  chrome.tabs.sendMessage(activeTab.id, {
    action: 'START_CAPTURE',
    streamId,
    cameraEnabled: message.cameraEnabled || false,
    audioDeviceId: message.audioDeviceId || null,
  });

  return { started: true, streamId };
}

async function handleStopRecording() {
  if (!state.isRecording || !state.recordingTabId) {
    return { error: 'Not currently recording' };
  }

  // Tell content script to stop and send back the blob
  chrome.tabs.sendMessage(state.recordingTabId, { action: 'STOP_CAPTURE' });

  const duration = Date.now() - (state.startTime || Date.now());

  state.isRecording = false;
  state.isPaused = false;
  state.streamId = null;
  state.startTime = null;

  return { stopped: true, durationMs: duration };
}

// ── API Handlers ──────────────────────────────────────────────────────────────

async function handleUpload(blobData, title) {
  const formData = new FormData();

  if (blobData instanceof Blob) {
    formData.append('video', blobData, 'recording.webm');
  } else {
    // blobData is a base64 string
    const byteString = atob(blobData.split(',')[1] || blobData);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: 'video/webm' });
    formData.append('video', blob, 'recording.webm');
  }

  if (title) {
    formData.append('title', title);
  }

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Upload failed');
  }

  const result = await response.json();
  state.currentRecordingId = result.recordingId;
  return result;
}

async function handleTranscribe(recordingId) {
  const response = await fetch(`${API_BASE}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Transcription failed');
  }

  return response.json();
}

async function handleTransform(recordingId, targetStructure = 'auto') {
  const response = await fetch(`${API_BASE}/api/transform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, targetStructure }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Transform failed');
  }

  return response.json();
}

async function handleSynthesize(recordingId, voiceId, voiceName) {
  const response = await fetch(`${API_BASE}/api/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, voiceId, voiceName }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Synthesis failed');
  }

  return response.json();
}

async function handleGetRecording(recordingId) {
  const response = await fetch(`${API_BASE}/api/recordings/${recordingId}`);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to get recording');
  }
  return response.json();
}

async function handleListRecordings() {
  const response = await fetch(`${API_BASE}/api/recordings`);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to list recordings');
  }
  return response.json();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function notifyContentScript(action) {
  if (state.recordingTabId) {
    chrome.tabs.sendMessage(state.recordingTabId, { action });
  }
}

// Badge management
function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Update badge when recording state changes
setInterval(() => {
  if (state.isRecording) {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    updateBadge(`${mins}:${secs.toString().padStart(2, '0')}`, state.isPaused ? '#f59e0b' : '#ef4444');
  }
}, 1000);
