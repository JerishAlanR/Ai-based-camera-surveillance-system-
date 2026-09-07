const SUPABASE_URL = 'https://smgzatxfeccyaqiiwsxh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kOZID4TW1W2Th8tbhhIAzw_cftNTcVC';
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const COCO_TARGETS = new Set(['person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle']);
const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const stage = $('stage');
const stageMessage = $('stageMessage');
const statusText = $('statusText');
const startButton = $('startButton');
const stopButton = $('stopButton');
const resetBoundaryButton = $('resetBoundaryButton');
const modelStatus = $('modelStatus');
const cameraStatus = $('cameraStatus');
const boundaryStatus = $('boundaryStatus');
const peopleCount = $('peopleCount');
const carsCount = $('carsCount');
const reportCount = $('reportCount');
const confidenceRange = $('confidenceRange');
const confidenceValue = $('confidenceValue');
const latestEvent = $('latestEvent');
const eventRows = $('eventRows');
const downloadButton = $('downloadButton');
const refreshReportButton = $('refreshReportButton');
const cloudStatus = $('cloudStatus');
const storageLabel = $('storageLabel');
const cameraBadge = $('cameraBadge');
const boundaryHint = $('boundaryHint');
const plateToggle = $('plateToggle');
const evidenceDialog = $('evidenceDialog');
const entryEvidence = $('entryEvidence');
const exitEvidence = $('exitEvidence');
const evidenceTitle = $('evidenceTitle');
const closeEvidenceButton = $('closeEvidenceButton');
const ctx = overlay.getContext('2d');

let model = null;
let stream = null;
let running = false;
let animationFrame = null;
let detectionBusy = false;
let previousDetections = [];
let nextTrackId = 1;
let events = [];
let boundary = null;
let activeSessions = new Map();
let cloud = null;
let cloudUser = null;
let localDbPromise = null;
let lastAlertAt = 0;

function setStatus(message, kind = '') {
  statusText.textContent = message;
  statusText.className = `status ${kind}`;
}

function updateCloudBadge(label, kind = '') {
  cloudStatus.textContent = '';
  const dot = document.createElement('i');
  cloudStatus.append(dot, document.createTextNode(label));
  cloudStatus.className = `connection-pill ${kind}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function openLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('boundary-watch-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return localDbPromise;
}

async function localPut(event) {
  try {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').put(event);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) { console.warn('Local report backup failed', error); }
}

async function localGetAll() {
  try {
    const db = await openLocalDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const req = tx.objectStore('events').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (error) { return []; }
}

async function localDelete(id) {
  try {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) { console.warn('Local report deletion failed', error); }
}

async function initCloud() {
  try {
    cloud = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    let { data: { session } } = await cloud.auth.getSession();
    if (!session) {
      const response = await cloud.auth.signInAnonymously();
      if (response.error) throw response.error;
      session = response.data.session;
    }
    cloudUser = session?.user || null;
    updateCloudBadge('Cloud reports connected', 'ready');
    storageLabel.textContent = 'Supabase + local backup';
    await loadReports();
  } catch (error) {
    console.warn('Cloud reports unavailable; using local backup', error);
    updateCloudBadge('Local backup only', 'offline');
    storageLabel.textContent = 'Local device backup';
    await loadReports();
  }
}

function updateCanvasSize() {
  if (!video.videoWidth || !video.videoHeight) return;
  const oldWidth = overlay.width;
  const oldHeight = overlay.height;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  if (boundary && oldWidth && oldHeight) {
    const sx = overlay.width / oldWidth;
    const sy = overlay.height / oldHeight;
    boundary = boundary.map((point) => ({ x: point.x * sx, y: point.y * sy }));
  }
}

function defaultBoundary() {
  return [
    { x: overlay.width * .16, y: overlay.height * .18 },
    { x: overlay.width * .84, y: overlay.height * .18 },
    { x: overlay.width * .84, y: overlay.height * .84 },
    { x: overlay.width * .16, y: overlay.height * .84 }
  ];
}

function resetBoundary() {
  if (!overlay.width || !overlay.height) return;
  boundary = defaultBoundary();
  boundaryStatus.textContent = 'Configured';
  boundaryHint.textContent = 'Area ready. Detection sessions will be recorded automatically.';
  drawBoundary();
}

function drawBoundary() {
  if (!boundary || boundary.length < 3) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(boundary[0].x, boundary[0].y);
  boundary.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(93, 224, 193, .12)';
  ctx.fill();
  ctx.strokeStyle = '#5de0c1';
  ctx.lineWidth = Math.max(4, overlay.width / 320);
  ctx.setLineDash([14, 9]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `bold ${Math.max(16, overlay.width / 58)}px system-ui`;
  ctx.fillStyle = '#5de0c1';
  ctx.fillText('MONITORED AREA', boundary[0].x + 12, Math.max(24, boundary[0].y - 14));
  boundary.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(9, overlay.width / 110), 0, Math.PI * 2);
    ctx.fillStyle = '#07131b';
    ctx.fill();
    ctx.strokeStyle = '#5de0c1';
    ctx.stroke();
    ctx.fillStyle = '#f2f7f5';
    ctx.font = `bold ${Math.max(12, overlay.width / 90)}px system-ui`;
    ctx.fillText(String(index + 1), point.x - 4, point.y + 4);
  });
  ctx.restore();
}

function pointFromEvent(event) {
  const rect = overlay.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (overlay.width / rect.width), y: (event.clientY - rect.top) * (overlay.height / rect.height) };
}

overlay.addEventListener('pointerdown', (event) => {
  if (!running || !overlay.width) return;
  const point = pointFromEvent(event);
  if (!boundary || boundaryStatus.textContent === 'Configured') {
    boundary = [point];
    boundaryStatus.textContent = 'Point 2 of 4';
    boundaryHint.textContent = 'Tap three more corners to close the monitored area.';
  } else if (boundary.length < 4) {
    boundary.push(point);
    boundaryStatus.textContent = boundary.length < 4 ? `Point ${boundary.length + 1} of 4` : 'Configured';
    if (boundary.length === 4) boundaryHint.textContent = 'Area ready. Detection sessions will be recorded automatically.';
  }
  drawBoundary();
});

function pointInArea(point) {
  if (!boundary || boundary.length < 3) return false;
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i]; const b = boundary[j];
    const intersect = ((a.y > point.y) !== (b.y > point.y)) && (point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

function areaCenter(point) {
  return { x: point.x, y: point.y };
}

function bottomCenter(box) { return { x: box.x + box.width / 2, y: box.y + box.height }; }

function iou(a, b) {
  const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width); const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}

function assignTracks(detections) {
  const usedPrevious = new Set();
  return detections.map((detection) => {
    let bestIndex = -1; let bestScore = 0;
    previousDetections.forEach((previous, index) => {
      if (usedPrevious.has(index) || previous.class !== detection.class) return;
      const score = iou(previous, detection);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex >= 0 && bestScore >= .15) {
      usedPrevious.add(bestIndex);
      return { ...detection, trackId: previousDetections[bestIndex].trackId };
    }
    return { ...detection, trackId: nextTrackId++ };
  });
}

function captureFrame() {
  if (!video.videoWidth || !video.videoHeight) return null;
  const frame = document.createElement('canvas');
  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  frame.width = Math.round(video.videoWidth * scale); frame.height = Math.round(video.videoHeight * scale);
  frame.getContext('2d').drawImage(video, 0, 0, frame.width, frame.height);
  return frame.toDataURL('image/jpeg', .72);
}

function newSession(object) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), trackId: object.trackId, objectType: object.class, confidence: object.score,
    enteredAt: now, exitedAt: null, dwellSeconds: null, direction: 'entered area',
    entrySnapshotData: captureFrame(), exitSnapshotData: null, plateText: null, plateConfidence: null,
    expiresAt: new Date(Date.now() + RETENTION_MS).toISOString(), status: 'inside'
  };
}

function detectAreaSessions(tracked) {
  const seenInside = new Set();
  const completed = [];
  tracked.forEach((object) => {
    const inside = pointInArea(areaCenter(bottomCenter(object)));
    if (inside) {
      seenInside.add(object.trackId);
      if (!activeSessions.has(object.trackId)) {
        const session = newSession(object);
        activeSessions.set(object.trackId, session);
        latestEvent.textContent = `${formatDate(session.enteredAt)} — ${session.objectType} entered the monitored area`;
        if (VEHICLES.has(object.class) && plateToggle.checked) runPlateOcr(session);
      }
    }
  });
  for (const [trackId, session] of activeSessions) {
    if (!seenInside.has(trackId)) {
      session.exitedAt = new Date().toISOString();
      session.dwellSeconds = Math.max(0, Math.round((new Date(session.exitedAt) - new Date(session.enteredAt)) / 1000));
      session.exitSnapshotData = captureFrame();
      session.status = 'complete';
      activeSessions.delete(trackId);
      completed.push(session);
    }
  }
  return completed;
}

async function runPlateOcr(session) {
  if (!window.Tesseract || !session.entrySnapshotData) return;
  try {
    const result = await Tesseract.recognize(session.entrySnapshotData, 'eng', { logger: () => {} });
    const text = (result.data.text || '').toUpperCase().replace(/[^A-Z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 4) {
      session.plateText = text;
      session.plateConfidence = Math.round((result.data.confidence || 0) / 100 * 10000) / 10000;
      await persistEvent(session);
      showEvents();
    }
  } catch (error) { console.warn('Plate OCR unavailable', error); }
}

function drawDetection(object, inside) {
  const color = object.class === 'person' ? '#5de0c1' : '#7bbcff';
  ctx.strokeStyle = inside ? color : 'rgba(158,184,185,.8)';
  ctx.lineWidth = Math.max(2, overlay.width / 480);
  ctx.strokeRect(object.x, object.y, object.width, object.height);
  const label = `ID ${object.trackId} · ${object.class} ${Math.round(object.score * 100)}%`;
  ctx.font = `bold ${Math.max(14, overlay.width / 70)}px system-ui`;
  const labelWidth = ctx.measureText(label).width + 12;
  ctx.fillStyle = color;
  ctx.fillRect(object.x, Math.max(0, object.y - 27), labelWidth, 27);
  ctx.fillStyle = '#07131b';
  ctx.fillText(label, object.x + 6, Math.max(19, object.y - 8));
}

function render(tracked) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawBoundary();
  tracked.forEach((object) => drawDetection(object, pointInArea(bottomCenter(object))));
}

function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function formatDwell(seconds) {
  if (seconds === null || seconds === undefined) return 'In area';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function dbToEvent(row) {
  return {
    id: row.id, trackId: row.tracking_id, objectType: row.object_type, confidence: Number(row.confidence || 0),
    enteredAt: row.entered_at, exitedAt: row.exited_at, dwellSeconds: row.dwell_seconds, direction: row.direction,
    entrySnapshotData: row.entry_snapshot_data, exitSnapshotData: row.exit_snapshot_data,
    plateText: row.plate_text, plateConfidence: row.plate_confidence, expiresAt: row.expires_at, status: 'complete'
  };
}

function eventToDb(event) {
  return {
    id: event.id, owner_id: cloudUser?.id, captured_at: event.enteredAt, entered_at: event.enteredAt, exited_at: event.exitedAt,
    object_type: VEHICLES.has(event.objectType) ? event.objectType : event.objectType, tracking_id: event.trackId, direction: event.direction,
    dwell_seconds: event.dwellSeconds, confidence: event.confidence, plate_text: event.plateText, plate_confidence: event.plateConfidence,
    entry_snapshot_data: event.entrySnapshotData, exit_snapshot_data: event.exitSnapshotData, expires_at: event.expiresAt,
    metadata: { source: 'browser', app: 'boundary-watch-v1' }
  };
}

async function persistEvent(event) {
  events = [...events.filter((item) => item.id !== event.id), event];
  await localPut(event);
  if (cloud && cloudUser) {
    const { error } = await cloud.from('boundary_events').upsert(eventToDb(event), { onConflict: 'id' });
    if (error) console.warn('Cloud report save failed', error);
  }
  showEvents();
}

async function loadReports() {
  const cutoff = Date.now() - RETENTION_MS;
  const local = (await localGetAll()).filter((event) => new Date(event.expiresAt || 0).getTime() > cutoff);
  for (const old of (await localGetAll()).filter((event) => !local.some((item) => item.id === event.id))) await localDelete(old.id);
  let cloudEvents = [];
  if (cloud && cloudUser) {
    const response = await cloud.from('boundary_events').select('*').gt('expires_at', new Date().toISOString()).order('entered_at', { ascending: false }).limit(100);
    if (!response.error) cloudEvents = response.data.map(dbToEvent);
  }
  const merged = new Map([...local, ...cloudEvents].map((event) => [event.id, event]));
  events = [...merged.values()].sort((a, b) => new Date(b.enteredAt) - new Date(a.enteredAt));
  showEvents();
}

function showEvents() {
  reportCount.textContent = events.length;
  downloadButton.disabled = !events.length;
  if (!events.length) {
    eventRows.innerHTML = '<tr><td colspan="6" class="empty">No reports yet. Completed area sessions will appear here.</td></tr>';
    return;
  }
  eventRows.innerHTML = events.slice(0, 40).map((event) => `
    <tr>
      <td><strong>${escapeHtml(event.objectType)}</strong><br><span class="muted-cell">ID ${escapeHtml(event.trackId)}</span></td>
      <td>${escapeHtml(formatDate(event.enteredAt))}</td>
      <td>${escapeHtml(formatDate(event.exitedAt))}</td>
      <td>${escapeHtml(formatDwell(event.dwellSeconds))}</td>
      <td>${event.plateText ? `${escapeHtml(event.plateText)}<br><span class="muted-cell">OCR ${Math.round((event.plateConfidence || 0) * 100)}%</span>` : '<span class="muted-cell">Not read</span>'}</td>
      <td><button class="view-evidence" data-event-id="${escapeHtml(event.id)}">View frames</button></td>
    </tr>`).join('');
}

async function handleCompleted(completed) {
  for (const event of completed) {
    await persistEvent(event);
    latestEvent.textContent = `${formatDate(event.exitedAt)} — ${event.objectType} was in the area for ${formatDwell(event.dwellSeconds)}`;
    const now = Date.now();
    if (now - lastAlertAt > 1000) {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Area session complete', { body: `${event.objectType}: ${formatDwell(event.dwellSeconds)}` });
      lastAlertAt = now;
    }
  }
}

async function processFrame() {
  if (!running || !model || detectionBusy) return;
  detectionBusy = true;
  try {
    const predictions = await model.detect(video);
    const confidence = Number(confidenceRange.value) / 100;
    const detections = predictions.filter((prediction) => COCO_TARGETS.has(prediction.class) && prediction.score >= confidence).map((prediction) => ({
      class: prediction.class, score: prediction.score, x: prediction.bbox[0], y: prediction.bbox[1], width: prediction.bbox[2], height: prediction.bbox[3]
    }));
    const tracked = assignTracks(detections);
    const completed = detectAreaSessions(tracked);
    previousDetections = tracked;
    await handleCompleted(completed);
    render(tracked);
    peopleCount.textContent = tracked.filter((object) => object.class === 'person').length;
    carsCount.textContent = tracked.filter((object) => VEHICLES.has(object.class)).length;
    animationFrame = requestAnimationFrame(processFrame);
  } catch (error) {
    console.error(error);
    setStatus('Detection paused; retrying…', 'error');
    animationFrame = requestAnimationFrame(processFrame);
  } finally { detectionBusy = false; }
}

async function loadModel() {
  if (model) return model;
  modelStatus.textContent = 'Loading…';
  setStatus('Loading browser AI model…', 'loading');
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  modelStatus.textContent = 'Ready';
  return model;
}

async function startCamera() {
  try {
    await loadModel();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    updateCanvasSize();
    resetBoundary();
    running = true;
    cameraStatus.textContent = 'Connected'; cameraBadge.textContent = 'LIVE';
    setStatus('Monitoring locally in your browser.', 'running');
    stageMessage.hidden = true; startButton.disabled = true; stopButton.disabled = false;
    processFrame();
  } catch (error) {
    console.error(error); modelStatus.textContent = model ? 'Ready' : 'Unavailable'; cameraStatus.textContent = 'Unavailable'; cameraBadge.textContent = 'BLOCKED';
    setStatus(`Camera could not start: ${error.message}`, 'error'); stageMessage.hidden = false; stageMessage.innerHTML = '<span class="empty-camera-icon">!</span><strong>Camera access is needed</strong><small>Allow camera access in your browser, then try again.</small>';
  }
}

async function stopCamera() {
  running = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null; video.srcObject = null;
  for (const session of activeSessions.values()) {
    session.exitedAt = new Date().toISOString(); session.dwellSeconds = Math.max(0, Math.round((new Date(session.exitedAt) - new Date(session.enteredAt)) / 1000)); session.exitSnapshotData = captureFrame(); session.status = 'complete'; await persistEvent(session);
  }
  activeSessions.clear(); previousDetections = [];
  cameraStatus.textContent = 'Stopped'; cameraBadge.textContent = 'STANDBY'; startButton.disabled = false; stopButton.disabled = true;
  stageMessage.hidden = false; stageMessage.innerHTML = '<span class="empty-camera-icon">⌁</span><strong>Camera preview will appear here</strong><small>Allow camera access to begin monitoring.</small>';
  setStatus('Camera stopped.', ''); ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function downloadCsv() {
  const rows = [['object_type', 'entered_at', 'exited_at', 'dwell_seconds', 'plate_text', 'plate_confidence', 'retention_expires'], ...events.map((event) => [event.objectType, event.enteredAt, event.exitedAt || '', event.dwellSeconds ?? '', event.plateText || '', event.plateConfidence ?? '', event.expiresAt])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = 'boundary-analysis-reports.csv'; link.click(); URL.revokeObjectURL(link.href);
}

function showEvidence(event) {
  if (!event) return;
  evidenceTitle.textContent = `${event.objectType} · ${formatDate(event.enteredAt)}`;
  entryEvidence.src = event.entrySnapshotData || ''; exitEvidence.src = event.exitSnapshotData || event.entrySnapshotData || '';
  if (typeof evidenceDialog.showModal === 'function') evidenceDialog.showModal();
}

eventRows.addEventListener('click', (event) => { const button = event.target.closest('.view-evidence'); if (button) showEvidence(events.find((item) => item.id === button.dataset.eventId)); });
closeEvidenceButton.addEventListener('click', () => evidenceDialog.close());
evidenceDialog.addEventListener('click', (event) => { if (event.target === evidenceDialog) evidenceDialog.close(); });
startButton.addEventListener('click', async () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); await startCamera(); });
stopButton.addEventListener('click', stopCamera);
resetBoundaryButton.addEventListener('click', resetBoundary);
refreshReportButton.addEventListener('click', loadReports);
confidenceRange.addEventListener('input', () => { confidenceValue.textContent = `${confidenceRange.value}%`; });
downloadButton.addEventListener('click', downloadCsv);
video.addEventListener('loadedmetadata', updateCanvasSize);
window.addEventListener('resize', updateCanvasSize);

showEvents();
initCloud();
