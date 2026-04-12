/* content.js */

let typingTimer;
let activeElement = null;
let currentNudge = null;
const TYPING_DELAY = 1500; // wait 1.5s after typing to analyze

// Per-element tracking so multiple compose windows don't share state
const lastAnalyzedByElement = new WeakMap();
let analysisInFlight = false;
let rateLimitedUntil = 0; // timestamp — don't send requests before this
let contextInvalidated = false; // set when extension is reloaded mid-session

// 1. Listen for keyup in most common fields (use capturing phase to bypass Gmail's stopPropagation)
document.addEventListener('keyup', (e) => {
  let target = e.target;
  
  if (target && target.nodeType === 3) target = target.parentElement; // text node
  
  if (!target) return;

  const isContentEditable = target.isContentEditable || (target.hasAttribute && target.hasAttribute('contenteditable')) || target.getAttribute('role') === 'textbox';
  const isInputOrTextArea = target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text');

  if (isContentEditable || isInputOrTextArea) {
    if (isContentEditable && target.closest) {
      target = target.closest('[contenteditable="true"]') || target.closest('[role="textbox"]') || target;
    }

    activeElement = target;
    clearTimeout(typingTimer);
    
    if (currentNudge) {
      currentNudge.style.opacity = '0.5'; // Dim slightly while typing
    }

    typingTimer = setTimeout(() => {
      analyzeActiveInput(target);
    }, TYPING_DELAY);
  }
}, true); // TRUE = Capturing phase! This catches the event before Gmail stops it.

function getElementText(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    return el.value;
  } else if (el.isContentEditable || (el.hasAttribute && el.hasAttribute('contenteditable')) || el.getAttribute('role') === 'textbox') {
    return el.innerText || el.textContent || '';
  }
  return '';
}

function setElementText(el, newText) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = newText;
  } else if (el.isContentEditable || el.hasAttribute('contenteditable')) {
    el.innerText = newText;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function analyzeActiveInput(el) {
  if (contextInvalidated) return; // extension reloaded — wait for page refresh
  // Element may have been removed from the DOM by the time the debounce fires
  if (!document.contains(el)) return;

  const text = getElementText(el).trim();

  if (text.length < 15) {
    if (currentNudge) {
      currentNudge.remove();
      currentNudge = null;
    }
    lastAnalyzedByElement.delete(el);
    return;
  }

  const lastText = lastAnalyzedByElement.get(el) || '';

  // Skip if: same text as last analysis, another request in flight, or rate-limited
  if (text === lastText || analysisInFlight || Date.now() < rateLimitedUntil) return;

  lastAnalyzedByElement.set(el, text);
  analysisInFlight = true;

  // Safety valve: if the service worker dies and never responds, unlock after 15s
  const inflightTimeout = setTimeout(() => { analysisInFlight = false; }, 15000);

  // Guard: chrome.runtime can become undefined when the service worker
  // is fully dead — different from "Extension context invalidated".
  if (!chrome?.runtime?.sendMessage) {
    clearTimeout(inflightTimeout);
    analysisInFlight = false;
    contextInvalidated = true;
    return;
  }

  try {
    chrome.runtime.sendMessage({ action: 'analyzeTone', text }, (response) => {
      clearTimeout(inflightTimeout);
      analysisInFlight = false;

      if (!chrome?.runtime || chrome.runtime.lastError) {
        return; // context gone or channel closed — silently skip
      }

      if (response && response.error) {
        console.error("ToneCheck API error:", response.error);
        if (response.error.includes('Rate limit')) {
          rateLimitedUntil = Date.now() + 60_000;
          lastAnalyzedByElement.delete(el);
        }
        return;
      }

      if (response && response.isHarsh) {
        showNudge(el, response);
      } else if (currentNudge) {
        currentNudge.remove();
        currentNudge = null;
      }
    });
  } catch(e) {
    clearTimeout(inflightTimeout);
    analysisInFlight = false;
    // Covers both "Extension context invalidated" and
    // "Cannot read properties of undefined (reading 'sendMessage')"
    if (e instanceof TypeError || (e.message && e.message.includes('context'))) {
      contextInvalidated = true;
      return;
    }
    console.error("ToneCheck send error:", e);
  }
}

function showNudge(targetEl, analysis) {
  if (currentNudge) currentNudge.remove();

  const nudge = document.createElement('div');
  nudge.id = 'tone-check-nudge';
  
  nudge.innerHTML = `
    <div class="tc-header">
      <span>⚠️ Tone Alert</span>
    </div>
    <div class="tc-reason">${analysis.reason}</div>
    <div class="tc-alternative">"${analysis.alternative}"</div>
    <div class="tc-actions">
      <button class="tc-btn tc-btn-ignore" id="tc-ignore-btn">Ignore</button>
      <button class="tc-btn tc-btn-replace" id="tc-replace-btn">Replace</button>
    </div>
  `;

  document.body.appendChild(nudge);
  currentNudge = nudge;

  // Position it near the input element
  const rect = targetEl.getBoundingClientRect();
  const topPos = window.scrollY + rect.bottom + 8;
  const leftPos = window.scrollX + rect.left;

  nudge.style.top = topPos + 'px';
  nudge.style.left = leftPos + 'px';

  // Make sure it doesn't overflow right
  if (leftPos + 300 > window.innerWidth) {
    nudge.style.left = (window.innerWidth - 320) + 'px';
  }

  // Event listeners
  document.getElementById('tc-ignore-btn').onclick = () => {
    nudge.remove();
    currentNudge = null;
  };

  document.getElementById('tc-replace-btn').onclick = () => {
    setElementText(targetEl, analysis.alternative);
    nudge.remove();
    currentNudge = null;
  };
}

// =============================================================
// 2. Real-time Audio Sentiment Analysis
//    Layer 1 — instant local detection (pitch, volume, speech rate)
//    Layer 2 — Gemini audio analysis every 6 s (anger, sarcasm, nuance)
// =============================================================

// ── Layer 1: AudioSentimentAnalyzer ──────────────────────────
// Uses Web Audio API to measure RMS volume, dominant pitch (FFT),
// and zero-crossing rate (speech rate proxy) on every animation frame.
// Fires immediate local alerts without any API call.
class AudioSentimentAnalyzer {
  constructor(stream) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.analyser);

    this.fftBuf  = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeBuf = new Uint8Array(this.analyser.fftSize);

    this.volumeHistory = []; // ~3 s sliding window at rAF rate
    this.pitchHistory  = [];
    this.baselineVol   = null;
    this.rafId         = null;
    this.lastAlertTime = 0;
  }

  // Root-mean-square energy → loudness
  getRMS() {
    this.analyser.getByteTimeDomainData(this.timeBuf);
    let sum = 0;
    for (const v of this.timeBuf) { const n = (v - 128) / 128; sum += n * n; }
    return Math.sqrt(sum / this.timeBuf.length);
  }

  // Zero-crossing rate → speech rate / sharpness
  getZCR() {
    this.analyser.getByteTimeDomainData(this.timeBuf);
    let c = 0;
    for (let i = 1; i < this.timeBuf.length; i++) {
      const a = this.timeBuf[i - 1] - 128, b = this.timeBuf[i] - 128;
      if ((a >= 0) !== (b >= 0)) c++;
    }
    return c / this.timeBuf.length;
  }

  // Dominant frequency in the voice range (80–600 Hz) via FFT
  getDominantFreq() {
    this.analyser.getByteFrequencyData(this.fftBuf);
    const sr = this.ctx.sampleRate, fftSize = this.analyser.fftSize;
    const lo = Math.floor(80  * fftSize / sr);
    const hi = Math.floor(600 * fftSize / sr);
    let maxVal = 0, maxIdx = lo;
    for (let i = lo; i < hi; i++) {
      if (this.fftBuf[i] > maxVal) { maxVal = this.fftBuf[i]; maxIdx = i; }
    }
    return maxVal > 20 ? (maxIdx * sr / fftSize) : 0;
  }

  classify() {
    const rms  = this.getRMS();
    const zcr  = this.getZCR();
    const freq = this.getDominantFreq();

    if (rms < 0.02) return null; // silence — skip

    // Sliding windows (≈180 frames ≈ 3 s at 60 fps)
    this.volumeHistory.push(rms);
    if (this.volumeHistory.length > 180) this.volumeHistory.shift();
    if (freq > 0) {
      this.pitchHistory.push(freq);
      if (this.pitchHistory.length > 180) this.pitchHistory.shift();
    }

    // Calibrate baseline after first 5 seconds of listening
    if (!this.baselineVol && this.volumeHistory.length >= 300) {
      this.baselineVol = this.volumeHistory.reduce((a, b) => a + b) / this.volumeHistory.length;
    }

    const avgVol   = this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length;
    const avgPitch = this.pitchHistory.length
      ? this.pitchHistory.reduce((a, b) => a + b, 0) / this.pitchHistory.length : 0;

    // Pitch standard deviation — high variance = erratic/emotional delivery
    const pitchStdDev = this.pitchHistory.length > 1
      ? Math.sqrt(this.pitchHistory.reduce((acc, p) => acc + (p - avgPitch) ** 2, 0) / this.pitchHistory.length)
      : 0;

    const volRatio = this.baselineVol ? avgVol / this.baselineVol : 1;

    // ── Classification rules ──────────────────────────────────
    // SCREAMING: sustained very high volume (>30 of last 60 frames above threshold)
    const loudFrames = this.volumeHistory.slice(-60).filter(v => v > 0.38).length;
    if (avgVol > 0.42 && loudFrames > 25) {
      return { type: 'screaming', rms: avgVol, pitch: avgPitch, zcr };
    }

    // ANGRY: volume elevated 2× above baseline + high pitch + fast speech rate
    if (volRatio > 2.0 && avgPitch > 220 && zcr > 0.08) {
      return { type: 'angry', rms: avgVol, pitch: avgPitch, zcr };
    }

    // STRESSED/TENSE: elevated volume + erratic pitch contour (sarcasm signal)
    if (volRatio > 1.6 && pitchStdDev > 55) {
      return { type: 'stressed', rms: avgVol, pitch: avgPitch, zcr };
    }

    return null;
  }

  start(onDetect) {
    const loop = () => {
      const result = this.classify();
      if (result) {
        const now = Date.now();
        if (now - this.lastAlertTime > 4000) { // throttle: one local alert per 4 s
          this.lastAlertTime = now;
          onDetect(result);
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.ctx.close().catch(() => {});
  }

  // Summary passed to Gemini as additional context for every audio chunk
  getSummary() {
    const avgVol = this.volumeHistory.length
      ? (this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length).toFixed(3)
      : '0';
    const avgPitch = this.pitchHistory.length
      ? Math.round(this.pitchHistory.reduce((a, b) => a + b, 0) / this.pitchHistory.length)
      : 0;
    return { avgVol, avgPitch };
  }
}

// ── Local alert messages ──────────────────────────────────────
const LOCAL_TONE_ALERTS = {
  screaming: {
    icon: '🔊',
    label: 'Volume Alert — You are screaming',
    reason: 'Your voice volume is very high, which can feel aggressive or threatening to others.',
    tip: 'Lower your voice, take a slow breath, and continue at a calmer volume.'
  },
  angry: {
    icon: '😤',
    label: 'Tone Alert — Angry voice detected',
    reason: 'High volume + elevated pitch + fast speech pace — this combination signals anger.',
    tip: 'Pause, slow your speech, and soften your tone before continuing.'
  },
  stressed: {
    icon: '⚡',
    label: 'Tone Alert — Stressed or sarcastic delivery',
    reason: 'Irregular pitch contour detected — this can come across as sarcastic or dismissive.',
    tip: 'Speak at a steady, even pace and keep your tone neutral and direct.'
  }
};

// ── Speech section state ──────────────────────────────────────
let mediaRecorder       = null;
let audioAnalyzer       = null;
let isListening         = false;
let audioAnalysisInFlight = false;

function setupMeetingSpeechWidget() {
  const micWidget = document.createElement('div');
  micWidget.id    = 'tc-mic-widget';
  micWidget.title = 'ToneCheck: Click to monitor your speech tone';
  micWidget.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>`;
  document.body.appendChild(micWidget);

  const speechNudge = document.createElement('div');
  speechNudge.id = 'tc-speech-nudge';
  document.body.appendChild(speechNudge);

  micWidget.addEventListener('click', toggleListening);
}

async function toggleListening() {
  if (isListening) { stopMicCapture(); } else { await startMicCapture(); }
}

async function startMicCapture() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // ── Layer 1: start real-time local analysis ───────────────
    audioAnalyzer = new AudioSentimentAnalyzer(stream);
    audioAnalyzer.start((detection) => showLocalToneAlert(detection));

    // ── Layer 2: MediaRecorder → Gemini audio every 6 s ──────
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size < 1000 || audioAnalysisInFlight || contextInvalidated) return;
      if (!chrome?.runtime?.sendMessage) { contextInvalidated = true; return; }
      audioAnalysisInFlight = true;
      try {
        const base64        = await blobToBase64(e.data);
        const audioFeatures = audioAnalyzer ? audioAnalyzer.getSummary() : null;
        chrome.runtime.sendMessage(
          { action: 'analyzeMeetingAudio', audioData: base64, mimeType: e.data.type || mimeType, audioFeatures },
          (response) => {
            audioAnalysisInFlight = false;
            if (!chrome?.runtime || chrome.runtime.lastError || !response || response.error) return;
            if (response.isHarsh) showSpeechNudge(response);
          }
        );
      } catch (err) {
        audioAnalysisInFlight = false;
        if (err instanceof TypeError || (err.message && err.message.includes('context'))) {
          contextInvalidated = true;
        }
      }
    };

    mediaRecorder.start(6000);
    isListening = true;
    updateMicUI();
  } catch (err) {
    isListening = false;
    updateMicUI();
    if (err.name === 'NotAllowedError') {
      alert('ToneCheck: Please allow microphone access to analyze speech tone.');
    } else {
      console.error('ToneCheck mic error:', err.message);
    }
  }
}

function stopMicCapture() {
  if (audioAnalyzer) { audioAnalyzer.stop(); audioAnalyzer = null; }
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    mediaRecorder = null;
  }
  isListening = false;
  updateMicUI();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function updateMicUI() {
  const widget = document.getElementById('tc-mic-widget');
  if (!widget) return;
  if (isListening) {
    widget.classList.add('tc-mic-listening');
    widget.title = 'ToneCheck: Listening — click to stop';
  } else {
    widget.classList.remove('tc-mic-listening');
    widget.title = 'ToneCheck: Click to monitor your speech tone';
    const nudge = document.getElementById('tc-speech-nudge');
    if (nudge) nudge.style.display = 'none';
  }
}

let speechHideTimer;

// Immediate local alert (no API call) triggered by AudioSentimentAnalyzer
function showLocalToneAlert(detection) {
  const msg = LOCAL_TONE_ALERTS[detection.type];
  if (!msg) return;
  renderSpeechNudge(`${msg.icon} ${msg.label}`, msg.reason, msg.tip);
}

// Gemini-powered alert (sarcasm, nuanced anger, harsh words)
function showSpeechNudge(analysis) {
  renderSpeechNudge('🎙️ Speech Tone Alert', analysis.reason, analysis.alternative);
}

function renderSpeechNudge(title, reason, tip) {
  const nudge = document.getElementById('tc-speech-nudge');
  if (!nudge) return;
  nudge.innerHTML = `
    <div class="tc-header">
      <span>${title}</span>
      <button id="tc-speech-close" style="background:none;border:none;color:white;cursor:pointer">✕</button>
    </div>
    <div class="tc-reason">${reason}</div>
    <div class="tc-alternative">"${tip}"</div>
  `;
  nudge.style.display = 'flex';
  document.getElementById('tc-speech-close').onclick = () => { nudge.style.display = 'none'; };
  clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(() => { nudge.style.display = 'none'; }, 8000);
}

// Initialize speech widget
setupMeetingSpeechWidget();
