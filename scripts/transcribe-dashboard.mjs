#!/usr/bin/env node
/**
 * Live progress dashboard for AssemblyAI transcription.
 * Reads artifacts/transcripts-aai/ and meetings-data.json to show progress.
 *
 * Usage: node scripts/transcribe-dashboard.mjs [--port 3456]
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AAI_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
const AUDIO_DIR = resolve(ROOT, 'artifacts/audio');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3456;

function getData() {
  const meetingsRaw = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
  const meetings = (meetingsRaw.meetings || meetingsRaw).filter(m => m.youtube);

  const completed = [];
  const pending = [];
  let totalWords = 0;
  let totalUtterances = 0;
  let totalAudioSec = 0;
  let totalCompletedSec = 0;
  let errors = [];
  let avgConfidence = 0;
  let confCount = 0;

  for (const mtg of meetings) {
    const cachePath = resolve(AAI_DIR, `${mtg.youtube}.json`);
    if (existsSync(cachePath)) {
      try {
        const t = JSON.parse(readFileSync(cachePath, 'utf-8'));
        const speakers = new Set(t.utterances?.map(u => u.speaker) || []);
        const dur = t.audio_duration || 0;
        const words = t.words?.length || 0;
        const utts = t.utterances?.length || 0;
        const conf = t.confidence || 0;

        if (t.status === 'error') {
          errors.push({ date: mtg.date, error: t.error, videoId: mtg.youtube });
          pending.push(mtg);
          continue;
        }

        totalWords += words;
        totalUtterances += utts;
        totalCompletedSec += dur;
        if (conf > 0) { avgConfidence += conf; confCount++; }

        const stat = statSync(cachePath);
        completed.push({
          date: mtg.date,
          name: mtg.name?.slice(0, 60) || '',
          duration: mtg.duration || '?',
          durationSeconds: mtg.durationSeconds || 0,
          videoId: mtg.youtube,
          words,
          utterances: utts,
          speakers: speakers.size,
          confidence: conf,
          audioDuration: dur,
          completedAt: stat.mtime.toISOString(),
          fileSizeKB: Math.round(stat.size / 1024),
        });
      } catch (e) {
        errors.push({ date: mtg.date, error: e.message, videoId: mtg.youtube });
        pending.push(mtg);
      }
    } else {
      pending.push(mtg);
    }
  }

  // Check audio cache
  let audioFiles = 0;
  let audioSizeBytes = 0;
  if (existsSync(AUDIO_DIR)) {
    const files = readdirSync(AUDIO_DIR);
    audioFiles = files.length;
    for (const f of files) {
      try { audioSizeBytes += statSync(resolve(AUDIO_DIR, f)).size; } catch {}
    }
  }

  totalAudioSec = meetings.reduce((s, m) => s + (m.durationSeconds || 0), 0);
  completed.sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  // ETA calculation
  let etaMinutes = null;
  if (completed.length >= 2) {
    const times = completed.map(c => new Date(c.completedAt).getTime()).sort((a,b) => a-b);
    const firstTime = times[0];
    const lastTime = times[times.length - 1];
    const elapsed = (lastTime - firstTime) / 1000;
    const completedAudioSec = completed.reduce((s, c) => s + c.durationSeconds, 0);
    if (completedAudioSec > 0 && elapsed > 0) {
      const pendingAudioSec = pending.reduce((s, m) => s + (m.durationSeconds || 0), 0);
      const rate = elapsed / completedAudioSec;
      etaMinutes = Math.round((pendingAudioSec * rate) / 60);
    }
  }

  return {
    total: meetings.length,
    completedCount: completed.length,
    pendingCount: pending.length,
    completed,
    pending: pending.map(m => ({
      date: m.date,
      name: m.name?.slice(0, 60) || '',
      duration: m.duration || '?',
      durationSeconds: m.durationSeconds || 0,
      videoId: m.youtube,
    })),
    errors,
    stats: {
      totalWords,
      totalUtterances,
      totalAudioSeconds: totalAudioSec,
      completedAudioSeconds: totalCompletedSec,
      avgConfidence: confCount > 0 ? (avgConfidence / confCount) : 0,
      audioFilesCached: audioFiles,
      audioSizeMB: Math.round(audioSizeBytes / 1024 / 1024),
      estimatedCost: (totalCompletedSec / 3600 * 0.37).toFixed(2),
      totalEstimatedCost: (totalAudioSec / 3600 * 0.37).toFixed(2),
      etaMinutes,
    },
    timestamp: new Date().toISOString(),
  };
}

// NOTE: This is a local-only dev dashboard. All data rendered via innerHTML
// comes exclusively from our own filesystem (meeting dates, word counts, etc.)
// — no user input or external content is involved.

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RCSD Transcription Mission Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
  :root {
    --phosphor: #33ff33;
    --phosphor-dim: #1a8c1a;
    --phosphor-glow: #33ff3340;
    --amber: #ffb000;
    --amber-dim: #8c6000;
    --red: #ff3333;
    --red-dim: #8c1a1a;
    --bg: #0a0e0a;
    --bg-panel: #0d120d;
    --scanline: rgba(0, 0, 0, 0.15);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--phosphor);
    font-family: 'Share Tech Mono', monospace;
    font-size: 14px;
    overflow-x: hidden;
    min-height: 100vh;
  }

  /* CRT scanline overlay */
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      var(--scanline) 0px,
      var(--scanline) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 1000;
  }

  /* CRT vignette */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%);
    pointer-events: none;
    z-index: 999;
  }

  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    border: 1px solid var(--phosphor-dim);
    padding: 16px 24px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-panel);
    position: relative;
    overflow: hidden;
  }

  .header::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--phosphor);
    box-shadow: 0 0 10px var(--phosphor), 0 0 20px var(--phosphor-glow);
  }

  .header h1 {
    font-family: 'VT323', monospace;
    font-size: 32px;
    letter-spacing: 4px;
    text-transform: uppercase;
    text-shadow: 0 0 10px var(--phosphor-glow);
  }

  .header .clock {
    font-family: 'VT323', monospace;
    font-size: 24px;
    color: var(--amber);
    text-shadow: 0 0 8px rgba(255, 176, 0, 0.4);
  }

  @keyframes flicker {
    0%, 100% { opacity: 1; }
    92% { opacity: 1; }
    93% { opacity: 0.8; }
    94% { opacity: 1; }
    96% { opacity: 0.9; }
    97% { opacity: 1; }
  }

  .flicker { animation: flicker 4s infinite; }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat-box {
    border: 1px solid var(--phosphor-dim);
    background: var(--bg-panel);
    padding: 14px 16px;
    text-align: center;
  }

  .stat-box .label {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--phosphor-dim);
    margin-bottom: 6px;
  }

  .stat-box .value {
    font-family: 'VT323', monospace;
    font-size: 36px;
    text-shadow: 0 0 15px var(--phosphor-glow);
    line-height: 1;
  }

  .stat-box .sub {
    font-size: 11px;
    color: var(--phosphor-dim);
    margin-top: 4px;
  }

  .stat-box.amber .value { color: var(--amber); text-shadow: 0 0 15px rgba(255,176,0,0.4); }
  .stat-box.amber { border-color: var(--amber-dim); }
  .stat-box.red .value { color: var(--red); text-shadow: 0 0 15px rgba(255,51,51,0.4); }
  .stat-box.red { border-color: var(--red-dim); }

  .progress-section {
    border: 1px solid var(--phosphor-dim);
    background: var(--bg-panel);
    padding: 16px 20px;
    margin-bottom: 20px;
  }

  .progress-section .title {
    font-size: 11px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--phosphor-dim);
    margin-bottom: 10px;
  }

  .progress-bar {
    height: 28px;
    background: #111;
    border: 1px solid var(--phosphor-dim);
    position: relative;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--phosphor-dim), var(--phosphor));
    box-shadow: 0 0 20px var(--phosphor-glow), inset 0 0 10px rgba(255,255,255,0.1);
    transition: width 0.8s ease;
    position: relative;
  }

  .progress-fill::after {
    content: '';
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 3px;
    background: #fff;
    box-shadow: 0 0 10px var(--phosphor), 0 0 20px var(--phosphor);
    animation: pulse-edge 1.5s ease-in-out infinite;
  }

  @keyframes pulse-edge {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  .progress-text {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-family: 'VT323', monospace;
    font-size: 18px;
    color: var(--phosphor);
    text-shadow: 0 0 6px var(--phosphor-glow);
    z-index: 2;
    mix-blend-mode: difference;
  }

  .eta-line {
    margin-top: 8px;
    font-size: 13px;
    color: var(--amber);
    text-shadow: 0 0 6px rgba(255,176,0,0.3);
  }

  .panel {
    border: 1px solid var(--phosphor-dim);
    background: var(--bg-panel);
    margin-bottom: 20px;
    overflow: hidden;
  }

  .panel-header {
    padding: 10px 16px;
    border-bottom: 1px solid var(--phosphor-dim);
    font-size: 11px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--phosphor-dim);
    display: flex;
    justify-content: space-between;
  }

  .panel-header .count {
    color: var(--phosphor);
    font-family: 'VT323', monospace;
    font-size: 16px;
    letter-spacing: 0;
  }

  table { width: 100%; border-collapse: collapse; }

  th {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--phosphor-dim);
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid #1a2a1a;
  }

  td {
    padding: 6px 12px;
    border-bottom: 1px solid #0f170f;
    font-size: 13px;
    white-space: nowrap;
  }

  tr:hover td { background: #0f1a0f; }

  .completed-table tr td:first-child,
  .pending-table tr td:first-child {
    font-family: 'VT323', monospace;
    font-size: 18px;
  }

  .pending-table tr td:first-child { color: var(--amber); }

  .conf-bar {
    display: inline-block;
    width: 60px;
    height: 8px;
    background: #111;
    border: 1px solid var(--phosphor-dim);
    vertical-align: middle;
    margin-right: 6px;
  }

  .conf-bar-fill {
    height: 100%;
    background: var(--phosphor);
    box-shadow: 0 0 4px var(--phosphor-glow);
  }

  .error-row td {
    color: var(--red) !important;
    background: rgba(255, 51, 51, 0.05);
  }

  .active-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--phosphor);
    box-shadow: 0 0 6px var(--phosphor), 0 0 12px var(--phosphor-glow);
    animation: pulse-dot 1.2s ease-in-out infinite;
    margin-right: 8px;
    vertical-align: middle;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.4; box-shadow: 0 0 6px var(--phosphor); }
    50% { opacity: 1; box-shadow: 0 0 12px var(--phosphor), 0 0 24px var(--phosphor-glow); }
  }

  .status-live {
    color: var(--phosphor);
    font-family: 'VT323', monospace;
    font-size: 18px;
  }

  .status-done { color: var(--phosphor-dim); }

  .footer {
    text-align: center;
    padding: 20px;
    font-size: 11px;
    color: var(--phosphor-dim);
    letter-spacing: 2px;
  }

  @media (max-width: 800px) {
    .stats-row { grid-template-columns: repeat(2, 1fr); }
    td, th { padding: 4px 8px; font-size: 11px; }
    .header h1 { font-size: 20px; }
  }
</style>
</head>
<body class="flicker">
<div class="container">
  <div class="header">
    <h1>RCSD Transcription Control</h1>
    <div>
      <div class="clock" id="clock"></div>
      <div style="font-size:10px;color:var(--phosphor-dim);text-align:right;margin-top:4px">
        <span class="active-dot" id="liveDot"></span>
        <span id="statusText">INITIALIZING</span>
      </div>
    </div>
  </div>

  <div class="stats-row" id="statsRow"></div>

  <div class="progress-section">
    <div class="title">Mission Progress</div>
    <div class="progress-bar">
      <div class="progress-fill" id="progressFill" style="width:0%"></div>
      <div class="progress-text" id="progressText">0%</div>
    </div>
    <div class="eta-line" id="etaLine"></div>
  </div>

  <div class="panel" id="errorsPanel" style="display:none">
    <div class="panel-header">
      <span>ERRORS</span>
      <span class="count" id="errorCount">0</span>
    </div>
    <table><thead><tr><th>Date</th><th>Video</th><th>Error</th></tr></thead>
    <tbody id="errorsBody"></tbody></table>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span>COMPLETED TRANSCRIPTIONS</span>
      <span class="count" id="completedCount">0</span>
    </div>
    <div style="max-height:400px;overflow-y:auto">
    <table class="completed-table"><thead><tr>
      <th>Date</th><th>Duration</th><th>Words</th><th>Speakers</th><th>Confidence</th><th>Size</th>
    </tr></thead>
    <tbody id="completedBody"></tbody></table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span>PENDING</span>
      <span class="count" id="pendingCount">0</span>
    </div>
    <div style="max-height:300px;overflow-y:auto">
    <table class="pending-table"><thead><tr>
      <th>Date</th><th>Duration</th><th>Est. Words</th><th>Status</th>
    </tr></thead>
    <tbody id="pendingBody"></tbody></table>
    </div>
  </div>

  <div class="footer">
    ASSEMBLYAI UNIVERSAL 3.5 PRO &middot; SPEAKER DIARIZATION &middot; WORD-LEVEL TIMESTAMPS &middot; RAW OPUS AUDIO<br>
    Auto-refreshes every 10s &middot; <span id="lastUpdate"></span>
  </div>
</div>

<script>
// NOTE: Local-only dev dashboard — all data from our own filesystem,
// no user input rendered. innerHTML usage is safe in this context.
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatNum(n) { return n.toLocaleString(); }

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('en-US', { hour12: false }) + '.' +
    String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);
}
setInterval(updateClock, 100);
updateClock();

let prevCompleted = 0;

async function refresh() {
  try {
    const resp = await fetch('/api/status');
    const d = await resp.json();

    const pct = d.total > 0 ? Math.round((d.completedCount / d.total) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = pct + '% (' + d.completedCount + '/' + d.total + ')';

    const isActive = d.pendingCount > 0;
    document.getElementById('statusText').textContent = isActive ? 'TRANSCRIBING' : 'ALL COMPLETE';
    document.getElementById('liveDot').style.display = isActive ? 'inline-block' : 'none';

    // ETA
    const eta = d.stats.etaMinutes;
    if (eta !== null && d.pendingCount > 0) {
      const hrs = Math.floor(eta / 60);
      const mins = eta % 60;
      const etaStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
      const completionTime = new Date(Date.now() + eta * 60000);
      document.getElementById('etaLine').textContent =
        '>>> ETA: ' + etaStr + ' remaining — estimated completion: ' +
        completionTime.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
    } else if (d.pendingCount === 0 && d.completedCount > 0) {
      document.getElementById('etaLine').textContent = '>>> MISSION COMPLETE';
    } else {
      document.getElementById('etaLine').textContent = '>>> Calculating ETA... (need 2+ completions)';
    }

    // Stats
    const completedHrs = (d.stats.completedAudioSeconds / 3600).toFixed(1);
    const totalHrs = (d.stats.totalAudioSeconds / 3600).toFixed(1);
    const wordsPerMin = d.stats.completedAudioSeconds > 0
      ? Math.round(d.stats.totalWords / (d.stats.completedAudioSeconds / 60))
      : 0;

    document.getElementById('statsRow').innerHTML = [
      { label: 'Meetings Done', value: d.completedCount + '/' + d.total, sub: Math.round(d.completedCount/d.total*100) + '% complete' },
      { label: 'Audio Processed', value: completedHrs + 'h', sub: 'of ' + totalHrs + 'h total' },
      { label: 'Words Captured', value: formatNum(d.stats.totalWords), sub: wordsPerMin + ' words/min avg' },
      { label: 'Utterances', value: formatNum(d.stats.totalUtterances), sub: 'diarized segments' },
      { label: 'Avg Confidence', value: d.stats.avgConfidence > 0 ? (d.stats.avgConfidence * 100).toFixed(1) + '%' : '--', cls: d.stats.avgConfidence > 0.95 ? '' : 'amber' },
      { label: 'Cost So Far', value: '$' + d.stats.estimatedCost, sub: 'of ~$' + d.stats.totalEstimatedCost + ' total', cls: 'amber' },
      { label: 'Audio Cached', value: d.stats.audioFilesCached, sub: d.stats.audioSizeMB + ' MB on disk' },
      { label: 'Errors', value: d.errors.length, cls: d.errors.length > 0 ? 'red' : '', sub: d.errors.length > 0 ? 'check below' : 'none' },
    ].map(s => '<div class="stat-box ' + (s.cls||'') + '">' +
      '<div class="label">' + esc(s.label) + '</div>' +
      '<div class="value">' + esc(String(s.value)) + '</div>' +
      (s.sub ? '<div class="sub">' + esc(s.sub) + '</div>' : '') +
    '</div>').join('');

    // Errors
    if (d.errors.length > 0) {
      document.getElementById('errorsPanel').style.display = 'block';
      document.getElementById('errorCount').textContent = d.errors.length;
      document.getElementById('errorsBody').innerHTML = d.errors.map(e =>
        '<tr class="error-row"><td>' + esc(e.date) + '</td><td>' + esc(e.videoId) + '</td><td>' + esc((e.error||'').slice(0,80)) + '</td></tr>'
      ).join('');
    } else {
      document.getElementById('errorsPanel').style.display = 'none';
    }

    // Completed table (newest first)
    document.getElementById('completedCount').textContent = d.completedCount;
    const rows = [...d.completed].reverse();
    document.getElementById('completedBody').innerHTML = rows.map((c, i) => {
      const isNew = i === 0 && d.completedCount > prevCompleted && prevCompleted > 0;
      return '<tr' + (isNew ? ' style="background:#0f2a0f"' : '') + '>' +
        '<td>' + esc(c.date) + '</td>' +
        '<td>' + esc(c.duration) + '</td>' +
        '<td>' + formatNum(c.words) + '</td>' +
        '<td>' + c.speakers + '</td>' +
        '<td><span class="conf-bar"><span class="conf-bar-fill" style="width:' + (c.confidence*100) + '%"></span></span>' + (c.confidence*100).toFixed(1) + '%</td>' +
        '<td>' + c.fileSizeKB + ' KB</td>' +
      '</tr>';
    }).join('');

    // Pending table
    document.getElementById('pendingCount').textContent = d.pendingCount;
    document.getElementById('pendingBody').innerHTML = d.pending.map((p, i) => {
      const estWords = p.durationSeconds > 0 ? formatNum(Math.round(p.durationSeconds / 60 * wordsPerMin)) : '?';
      const status = i === 0 && isActive
        ? '<span class="active-dot"></span><span class="status-live">PROCESSING</span>'
        : '<span class="status-done">queued</span>';
      return '<tr><td>' + esc(p.date) + '</td><td>' + esc(p.duration) + '</td><td>' + estWords + '</td><td>' + status + '</td></tr>';
    }).join('');

    document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    prevCompleted = d.completedCount;
  } catch(e) {
    document.getElementById('statusText').textContent = 'CONNECTION LOST';
  }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getData()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  RCSD Transcription Mission Control');
  console.log('  http://localhost:' + PORT);
  console.log('');
});
