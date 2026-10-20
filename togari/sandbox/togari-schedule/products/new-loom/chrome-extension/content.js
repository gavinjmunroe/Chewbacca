// ── New Loom Content Script ───────────────────────────────────────────────────
// Handles actual screen/camera/audio capture on the page

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let cameraStream = null;
let combinedStream = null;
let cameraPreviewEl = null;
let overlayEl = null;
let timerEl = null;
let timerInterval = null;
let startTime = null;

// ── Message Listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'START_CAPTURE':
      startCapture(message.streamId, message.cameraEnabled, message.audioDeviceId)
        .then(() => sendResponse({ started: true }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'STOP_CAPTURE':
      stopCapture();
      sendResponse({ stopped: true });
      return false;

    case 'PAUSE':
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        updateOverlayState('paused');
      }
      sendResponse({ paused: true });
      return false;

    case 'RESUME':
      if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        updateOverlayState('recording');
      }
      sendResponse({ resumed: true });
      return false;

    default:
      return false;
  }
});

// ── Capture Functions ─────────────────────────────────────────────────────────

async function startCapture(streamId, cameraEnabled, audioDeviceId) {
  recordedChunks = [];

  // Get screen stream using the tab capture stream ID
  try {
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });
  } catch (err) {
    // Fallback: try getDisplayMedia
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1920, height: 1080, frameRate: 30 },
      audio: true,
    });
  }

  // Get microphone audio
  const audioConstraints = audioDeviceId
    ? { deviceId: { exact: audioDeviceId } }
    : true;

  let micStream = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
  } catch (err) {
    console.warn('New Loom: Could not access microphone:', err.message);
  }

  // Get camera if enabled
  if (cameraEnabled) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: 30 },
        audio: false,
      });
      showCameraPreview(cameraStream);
    } catch (err) {
      console.warn('New Loom: Could not access camera:', err.message);
    }
  }

  // Combine streams
  const tracks = [];

  // Video from screen
  const videoTracks = screenStream.getVideoTracks();
  if (videoTracks.length > 0) {
    tracks.push(videoTracks[0]);
  }

  // Audio: mix tab audio + mic audio
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  const tabAudioTracks = screenStream.getAudioTracks();
  if (tabAudioTracks.length > 0) {
    const tabSource = audioContext.createMediaStreamSource(
      new MediaStream([tabAudioTracks[0]])
    );
    tabSource.connect(destination);
  }

  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
  }

  if (destination.stream.getAudioTracks().length > 0) {
    tracks.push(destination.stream.getAudioTracks()[0]);
  }

  combinedStream = new MediaStream(tracks);

  // Create MediaRecorder
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2500000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: mimeType });
    recordedChunks = [];

    // Convert blob to base64 and send to background
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({
        action: 'UPLOAD_RECORDING',
        blob: reader.result,
        title: `Recording ${new Date().toLocaleString()}`,
      });
    };
    reader.readAsDataURL(blob);

    cleanup();
  };

  mediaRecorder.start(1000); // Collect data every second
  startTime = Date.now();
  showRecordingOverlay();
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanup() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (combinedStream) {
    combinedStream.getTracks().forEach(t => t.stop());
    combinedStream = null;
  }
  removeCameraPreview();
  removeRecordingOverlay();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  startTime = null;
}

// ── UI Overlay ────────────────────────────────────────────────────────────────

function showRecordingOverlay() {
  removeRecordingOverlay();

  overlayEl = document.createElement('div');
  overlayEl.id = 'new-loom-overlay';
  overlayEl.innerHTML = `
    <div class="new-loom-recording-bar">
      <div class="new-loom-dot"></div>
      <span class="new-loom-timer">0:00</span>
      <button class="new-loom-btn new-loom-pause-btn" title="Pause">⏸</button>
      <button class="new-loom-btn new-loom-stop-btn" title="Stop">⏹</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  // Timer
  timerEl = overlayEl.querySelector('.new-loom-timer');
  timerInterval = setInterval(() => {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (timerEl) {
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  }, 1000);

  // Pause/Resume button
  const pauseBtn = overlayEl.querySelector('.new-loom-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (mediaRecorder?.state === 'recording') {
        chrome.runtime.sendMessage({ action: 'PAUSE_RECORDING' });
        pauseBtn.textContent = '▶';
        pauseBtn.title = 'Resume';
      } else if (mediaRecorder?.state === 'paused') {
        chrome.runtime.sendMessage({ action: 'RESUME_RECORDING' });
        pauseBtn.textContent = '⏸';
        pauseBtn.title = 'Pause';
      }
    });
  }

  // Stop button
  const stopBtn = overlayEl.querySelector('.new-loom-stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
    });
  }
}

function removeRecordingOverlay() {
  const existing = document.getElementById('new-loom-overlay');
  if (existing) existing.remove();
  overlayEl = null;
  timerEl = null;
}

function updateOverlayState(state) {
  const dot = document.querySelector('.new-loom-dot');
  if (!dot) return;
  if (state === 'paused') {
    dot.style.backgroundColor = '#f59e0b';
    dot.style.animationPlayState = 'paused';
  } else {
    dot.style.backgroundColor = '#ef4444';
    dot.style.animationPlayState = 'running';
  }
}

// ── Camera Preview ────────────────────────────────────────────────────────────

function showCameraPreview(stream) {
  removeCameraPreview();

  cameraPreviewEl = document.createElement('div');
  cameraPreviewEl.id = 'new-loom-camera-preview';

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  cameraPreviewEl.appendChild(video);
  document.body.appendChild(cameraPreviewEl);

  // Make draggable
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  cameraPreviewEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - cameraPreviewEl.getBoundingClientRect().left;
    offsetY = e.clientY - cameraPreviewEl.getBoundingClientRect().top;
    cameraPreviewEl.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !cameraPreviewEl) return;
    cameraPreviewEl.style.left = `${e.clientX - offsetX}px`;
    cameraPreviewEl.style.top = `${e.clientY - offsetY}px`;
    cameraPreviewEl.style.right = 'auto';
    cameraPreviewEl.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    if (cameraPreviewEl) cameraPreviewEl.style.cursor = 'grab';
  });
}

function removeCameraPreview() {
  const existing = document.getElementById('new-loom-camera-preview');
  if (existing) existing.remove();
  cameraPreviewEl = null;
}
