/* content.js */

let typingTimer;
let activeElement = null;
let currentNudge = null;
const TYPING_DELAY = 1500; // wait 1.5s after typing to analyze

// Per-element tracking so multiple compose windows don't share state
const lastAnalyzedByElement = new WeakMap();
let analysisInFlight = false;
let rateLimitedUntil = 0; // timestamp — don't send requests before this

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
// 2. Speech Analysis for Web Meeting Apps
// -------------------------------------------------------------
let recognition = null;
let isListening = false;
let speechBuffer = "";
let speechTimer = null;

function setupMeetingSpeechWidget() {
  // Only inject mic widget if we are on likely meeting sites, or allow user to toggle it globally
  // For now, let's inject it everywhere but keep it hidden unless explicitly opened?
  // Actually, a nice floating widget is great. Let's just create it.
  
  const micWidget = document.createElement('div');
  micWidget.id = 'tc-mic-widget';
  // SVG Mic Icon
  micWidget.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>`;
  document.body.appendChild(micWidget);

  const speechNudge = document.createElement('div');
  speechNudge.id = 'tc-speech-nudge';
  document.body.appendChild(speechNudge);

  micWidget.addEventListener('click', toggleListening);
}

function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window)) {
    alert("Your browser doesn't support speech recognition.");
    return;
  }
  
  recognition = new window.webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        // interim results are not analyzed — only final transcripts are sent
      }
    }

    if (finalTranscript) {
      speechBuffer += finalTranscript + " ";
      clearTimeout(speechTimer);
      // Wait for a pause in speech (2 seconds) to evaluate tone
      speechTimer = setTimeout(() => {
        analyzeSpeechContext(speechBuffer);
        speechBuffer = ""; // reset after analyze
      }, 2000);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error', event.error);
    isListening = false;
    updateMicUI();
  };

  recognition.onend = () => {
    // restart if still trying to listen
    if (isListening) {
      recognition.start();
    }
  };
}

function toggleListening() {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return; // not supported

  if (isListening) {
    recognition.stop();
    isListening = false;
  } else {
    recognition.start();
    isListening = true;
  }
  updateMicUI();
}

function updateMicUI() {
  const widget = document.getElementById('tc-mic-widget');
  if (isListening) {
    widget.classList.add('tc-mic-listening');
  } else {
    widget.classList.remove('tc-mic-listening');
    document.getElementById('tc-speech-nudge').style.display = 'none';
  }
}

async function analyzeSpeechContext(text) {
  if (text.length < 15) return;
  chrome.runtime.sendMessage({ action: 'analyzeTone', text }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Chrome Runtime Error:", chrome.runtime.lastError);
      return;
    }
    if (response && response.isHarsh) {
      showSpeechNudge(response);
    }
  });
}

let speechHideTimer;
function showSpeechNudge(analysis) {
  const nudge = document.getElementById('tc-speech-nudge');
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

  // Auto hide after 8 seconds
  clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(() => {
    nudge.style.display = 'none';
  }, 8000);
}

// Initialize speech widget
setupMeetingSpeechWidget();
