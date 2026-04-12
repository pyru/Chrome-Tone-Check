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

  try {
    chrome.runtime.sendMessage({ action: 'analyzeTone', text }, (response) => {
      clearTimeout(inflightTimeout);
      analysisInFlight = false;

      if (chrome.runtime.lastError) {
        console.error("ToneCheck runtime error:", chrome.runtime.lastError.message);
        return;
      }

      if (response && response.error) {
        console.error("ToneCheck API error:", response.error);
        if (response.error.includes('Rate limit')) {
          rateLimitedUntil = Date.now() + 60_000; // back off 60s after a 429
          lastAnalyzedByElement.delete(el); // allow retry once cooldown expires
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
    if (e.message && e.message.includes('Extension context invalidated')) {
      contextInvalidated = true; // stop all future attempts until page refresh
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

// -------------------------------------------------------------
// 2. Speech Analysis — MediaRecorder → Gemini audio
//    Detects BOTH harsh words AND angry vocal tone (pitch/intensity).
//    Works alongside Zoom/Meet since Chrome shares the mic in shared mode.
// -------------------------------------------------------------
let mediaRecorder = null;
let isListening = false;
let audioAnalysisInFlight = false;

function setupMeetingSpeechWidget() {
  const micWidget = document.createElement('div');
  micWidget.id = 'tc-mic-widget';
  micWidget.title = 'ToneCheck: Click to monitor your speech tone';
  micWidget.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>`;
  document.body.appendChild(micWidget);

  const speechNudge = document.createElement('div');
  speechNudge.id = 'tc-speech-nudge';
  document.body.appendChild(speechNudge);

  micWidget.addEventListener('click', toggleListening);
}

async function toggleListening() {
  if (isListening) {
    stopMicCapture();
  } else {
    await startMicCapture();
  }
}

async function startMicCapture() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = async (e) => {
      // Skip silent/tiny chunks and avoid piling up concurrent requests
      if (e.data.size < 1000 || audioAnalysisInFlight || contextInvalidated) return;
      audioAnalysisInFlight = true;
      try {
        const base64 = await blobToBase64(e.data);
        chrome.runtime.sendMessage(
          { action: 'analyzeMeetingAudio', audioData: base64, mimeType: e.data.type || mimeType },
          (response) => {
            audioAnalysisInFlight = false;
            if (chrome.runtime.lastError || !response || response.error) return;
            if (response.isHarsh) showSpeechNudge(response);
          }
        );
      } catch (err) {
        audioAnalysisInFlight = false;
        if (err.message && err.message.includes('Extension context invalidated')) {
          contextInvalidated = true;
        }
      }
    };

    mediaRecorder.start(6000); // analyze in 6-second chunks
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
function showSpeechNudge(analysis) {
  const nudge = document.getElementById('tc-speech-nudge');
  if (!nudge) return;
  nudge.innerHTML = `
    <div class="tc-header">
      <span>🎙️ Speech Tone Alert</span>
      <button id="tc-speech-close" style="background:none;border:none;color:white;cursor:pointer">✕</button>
    </div>
    <div class="tc-reason">${analysis.reason}</div>
    <div class="tc-alternative">"Try saying: ${analysis.alternative}"</div>
  `;
  nudge.style.display = 'flex';

  document.getElementById('tc-speech-close').onclick = () => {
    nudge.style.display = 'none';
  };

  clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(() => {
    nudge.style.display = 'none';
  }, 8000);
}

// Initialize speech widget
setupMeetingSpeechWidget();
