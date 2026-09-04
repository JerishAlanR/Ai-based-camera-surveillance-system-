const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const stage = document.getElementById('stage');
const stageMessage = document.getElementById('stageMessage');
const statusText = document.getElementById('statusText');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resetBoundaryButton = document.getElementById('resetBoundaryButton');
const modelStatus = document.getElementById('modelStatus');
const cameraStatus = document.getElementById('cameraStatus');
const boundaryStatus = document.getElementById('boundaryStatus');
const peopleCount = document.getElementById('peopleCount');
const carsCount = document.getElementById('carsCount');
const objectCount = document.getElementById('objectCount');
const confidenceRange = document.getElementById('confidenceRange');
const confidenceValue = document.getElementById('confidenceValue');
const latestEvent = document.getElementById('latestEvent');
const eventRows = document.getElementById('eventRows');
const downloadButton = document.getElementById('downloadButton');

const ctx = overlay.getContext('2d');
const COCO_TARGETS = new Set(['person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle']);

let model = null;
let stream = null;
let running = false;
let animationFrame = null;
let previousDetections = [];
let nextTrackId = 1;
let events = [];
let lastAlertAt = 0;
let boundary = null;

function setStatus(message, kind = '') {
  statusText.textContent = message;
  statusText.className = `status ${kind}`;
}

function updateCanvasSize() {
  if (!video.videoWidth || !video.videoHeight) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

function defaultBoundary() {
  return {
    start: { x: overlay.width * 0.5, y: overlay.height * 0.12 },
    end: { x: overlay.width * 0.5, y: overlay.height * 0.88 }
  };
}

function resetBoundary() {
  if (!overlay.width || !overlay.height) return;
  boundary = defaultBoundary();
  boundaryStatus.textContent = 'Configured';
  drawBoundary();
}

function resizeBoundaryToCanvas() {
  if (!boundary || !overlay.width || !overlay.height) return;
  boundary = defaultBoundary();
}

function drawBoundary() {
  if (!boundary) return;
  ctx.save();
  ctx.strokeStyle = '#ffb000';
  ctx.lineWidth = Math.max(3, overlay.width / 320);
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(boundary.start.x, boundary.start.y);
  ctx.lineTo(boundary.end.x, boundary.end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb000';
  ctx.font = `bold ${Math.max(16, overlay.width / 55)}px system-ui`;
  ctx.fillText('BOUNDARY', boundary.start.x + 12, boundary.start.y - 12);
  ctx.restore();
}

function pointFromEvent(event) {
  const rect = overlay.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (overlay.width / rect.width),
    y: (event.clientY - rect.top) * (overlay.height / rect.height)
  };
}

overlay.addEventListener('click', (event) => {
  const point = pointFromEvent(event);
  if (!boundary || boundaryStatus.textContent === 'Configured') {
    boundary = { start: point, end: { ...point } };
    boundaryStatus.textContent = 'Choose endpoint';
  } else {
    boundary.end = point;
    boundaryStatus.textContent = 'Configured';
  }
  drawBoundary();
});

function sideOfLine(point) {
  if (!boundary) return 0;
  const { start, end } = boundary;
  const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  if (cross > 0.5) return 1;
  if (cross < -0.5) return -1;
  return 0;
}

function bottomCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}

function assignTracks(detections) {
  const usedPrevious = new Set();
  return detections.map((detection) => {
    let bestIndex = -1;
    let bestScore = 0;
    previousDetections.forEach((previous, index) => {
      if (usedPrevious.has(index) || previous.class !== detection.class) return;
      const score = iou(previous, detection);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.15) {
      usedPrevious.add(bestIndex);
      return { ...detection, trackId: previousDetections[bestIndex].trackId };
    }
    return { ...detection, trackId: nextTrackId++ };
  });
}

function detectCrossings(tracked) {
  const newEvents = [];
  tracked.forEach((object) => {
    const currentSide = sideOfLine(bottomCenter(object));
    const previous = previousDetections.find((item) => item.trackId === object.trackId);
    const previousSide = previous ? sideOfLine(bottomCenter(previous)) : 0;
    if (currentSide !== 0 && previousSide !== 0 && currentSide !== previousSide) {
      const event = {
        time: new Date().toLocaleString(),
        type: object.class,
        id: object.trackId,
        direction: `${previousSide} to ${currentSide}`
      };
      newEvents.push(event);
    }
  });
  return newEvents;
}

function drawDetection(object) {
  const color = object.class === 'person' ? '#62d84e' : '#5fb3ff';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, overlay.width / 480);
  ctx.strokeRect(object.x, object.y, object.width, object.height);
  const label = `ID ${object.trackId} | ${object.class} ${Math.round(object.score * 100)}%`;
  ctx.font = `bold ${Math.max(14, overlay.width / 70)}px system-ui`;
  const labelWidth = ctx.measureText(label).width + 12;
  ctx.fillStyle = color;
  ctx.fillRect(object.x, Math.max(0, object.y - 27), labelWidth, 27);
  ctx.fillStyle = '#071017';
  ctx.fillText(label, object.x + 6, Math.max(19, object.y - 8));
}

function render(tracked, newEvents) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawBoundary();
  tracked.forEach(drawDetection);

  if (newEvents.length) {
    ctx.fillStyle = '#ff4d4f';
    ctx.font = `bold ${Math.max(18, overlay.width / 45)}px system-ui`;
    newEvents.forEach((event, index) => {
      ctx.fillText(`BOUNDARY CROSSED: ${event.type} ID ${event.id}`, 18, 36 + index * 32);
    });
  }
}

function showEvents() {
  if (!events.length) {
    eventRows.innerHTML = '<tr><td colspan="4" class="empty">No events yet.</td></tr>';
    downloadButton.disabled = true;
    return;
  }
  downloadButton.disabled = false;
  eventRows.innerHTML = events.slice(-30).reverse().map((event) => `
    <tr><td>${escapeHtml(event.time)}</td><td>${escapeHtml(event.type)}</td><td>${event.id}</td><td>${escapeHtml(event.direction)}</td></tr>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function notifyCrossings(newEvents) {
  if (!newEvents.length) return;
  events.push(...newEvents);
  const event = newEvents[newEvents.length - 1];
  latestEvent.textContent = `${event.time} — ${event.type} ID ${event.id} crossed (${event.direction})`;
  showEvents();

  const now = Date.now();
  if (now - lastAlertAt > 1000) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Boundary crossed', { body: `${event.type} ID ${event.id}` });
    }
    lastAlertAt = now;
  }
}

async function processFrame() {
  if (!running || !model) return;
  const predictions = await model.detect(video);
  const confidence = Number(confidenceRange.value) / 100;
  const detections = predictions
    .filter((prediction) => COCO_TARGETS.has(prediction.class) && prediction.score >= confidence)
    .map((prediction) => ({
      class: prediction.class,
      score: prediction.score,
      x: prediction.bbox[0],
      y: prediction.bbox[1],
      width: prediction.bbox[2],
      height: prediction.bbox[3]
    }));

  const tracked = assignTracks(detections);
  const newEvents = detectCrossings(tracked);
  previousDetections = tracked;
  notifyCrossings(newEvents);
  render(tracked, newEvents);

  const people = tracked.filter((object) => object.class === 'person').length;
  const cars = tracked.filter((object) => ['car', 'truck', 'bus'].includes(object.class)).length;
  peopleCount.textContent = people;
  carsCount.textContent = cars;
  objectCount.textContent = tracked.length;
  animationFrame = requestAnimationFrame(processFrame);
}

async function loadModel() {
  if (model) return model;
  modelStatus.textContent = 'Loading...';
  setStatus('Loading browser AI model...', 'loading');
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  modelStatus.textContent = 'Ready';
  return model;
}

async function startCamera() {
  try {
    await loadModel();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    updateCanvasSize();
    resizeBoundaryToCanvas();
    resetBoundary();
    running = true;
    cameraStatus.textContent = 'Connected';
    setStatus('Running locally in your browser.', 'running');
    stageMessage.hidden = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    processFrame();
  } catch (error) {
    console.error(error);
    modelStatus.textContent = model ? 'Ready' : 'Unavailable';
    cameraStatus.textContent = 'Unavailable';
    setStatus(`Could not start camera: ${error.message}`, 'error');
    stageMessage.hidden = false;
    stageMessage.textContent = 'Camera permission or browser access is required.';
  }
}

function stopCamera() {
  running = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  cameraStatus.textContent = 'Stopped';
  startButton.disabled = false;
  stopButton.disabled = true;
  stageMessage.hidden = false;
  stageMessage.textContent = 'Camera stopped.';
  setStatus('Camera stopped.', '');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  previousDetections = [];
}

function downloadCsv() {
  const rows = [['datetime', 'object_type', 'tracking_id', 'crossing_direction'], ...events.map((event) => [event.time, event.type, event.id, event.direction])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'boundary_events.csv';
  link.click();
  URL.revokeObjectURL(url);
}

startButton.addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  startCamera();
});
stopButton.addEventListener('click', stopCamera);
resetBoundaryButton.addEventListener('click', resetBoundary);
confidenceRange.addEventListener('input', () => {
  confidenceValue.textContent = `${confidenceRange.value}%`;
});
downloadButton.addEventListener('click', downloadCsv);
video.addEventListener('loadedmetadata', updateCanvasSize);
window.addEventListener('resize', updateCanvasSize);
showEvents();
