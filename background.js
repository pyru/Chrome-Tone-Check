// Fix navigation preload cancellation warning in MV3 service workers
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable();
      }
      await clients.claim();
    })()
  );
});

// Port-based communication keeps the service worker alive during async Gemini calls.
// sendMessage drops the channel if the worker sleeps mid-fetch; a port does not.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tonecheck') return;

  port.onMessage.addListener(async (request) => {
    try {
      let result;
      if (request.action === 'analyzeTone') {
        result = await analyzeToneWithGemini(request.text);
      } else if (request.action === 'analyzeMeetingAudio') {
        result = await analyzeSpeechWithGemini(
          request.audioData, request.mimeType, request.audioFeatures
        );
      }
      try { port.postMessage(result || { isHarsh: false, reason: null, alternative: null }); } catch (_) {}
    } catch (error) {
      try { port.postMessage({ error: error.message }); } catch (_) {}
    }
  });
});

async function analyzeToneWithGemini(text) {
  // Retrieve API key from storage
  const storage = await chrome.storage.local.get(['apiKey']);
  const apiKey = storage.apiKey;

  if (!apiKey) {
    throw new Error('API Key missing. Please set it in the extension popup.');
  }

  // gemini-2.5-flash with thinkingBudget:0 — thinking disabled = fast responses, reliably available
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `Classify if this text is harsh, aggressive, condescending, or purely negative. Return ONLY valid JSON (no markdown, no backticks):
{"isHarsh":boolean,"reason":"one-sentence reason or null","alternative":"gentler rewrite or null"}

Text: "${text}"`;


  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 200,
          thinkingConfig: { thinkingBudget: 0 }
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let detail = errText;
      try { detail = JSON.parse(errText).error?.message || errText; } catch {}
      if (response.status === 429) {
        throw new Error('Rate limit reached — please wait a moment before typing more.');
      }
      throw new Error(`API ${response.status}: ${detail}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      console.error("No candidates returned, possibly blocked by safety constraints.", data);
      return { isHarsh: false, reason: "Text was blocked or could not be analyzed.", alternative: "" };
    }

    const candidateText = data.candidates[0]?.content?.parts?.[0]?.text;

    if (candidateText) {
      const cleanedText = candidateText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanedText);
    } else {
      throw new Error('Invalid response structure from Gemini API');
    }

  } catch (error) {
    console.error('Error analyzing tone:', error);
    throw error;
  }
}

// Analyzes a raw audio chunk for both spoken content AND vocal tone/anger.
async function analyzeSpeechWithGemini(audioData, mimeType, audioFeatures) {
  const storage = await chrome.storage.local.get(['apiKey']);
  const apiKey = storage.apiKey;
  if (!apiKey) throw new Error('API Key missing. Please set it in the extension popup.');

  // gemini-2.5-flash with thinkingBudget:0 — audio support, thinking disabled for low latency
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const featureContext = audioFeatures
    ? ` Measured audio: volume RMS ${audioFeatures.avgVol}, avg pitch ${audioFeatures.avgPitch} Hz.`
    : '';

  const prompt = `Listen to this audio clip.${featureContext} Detect if the speaker is harsh, angry, screaming, or sarcastic — judge BOTH words and vocal tone (a calm "That's fine" vs a mocking "That's FINE"). Return ONLY valid JSON (no markdown):
{"isHarsh":boolean,"reason":"one-sentence reason or null","alternative":"calmer rewrite or null"}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: audioData } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    let detail = errText;
    try { detail = JSON.parse(errText).error?.message || errText; } catch {}
    if (response.status === 429) throw new Error('Rate limit reached — please wait a moment before typing more.');
    throw new Error(`API ${response.status}: ${detail}`);
  }

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) {
    return { isHarsh: false, reason: null, alternative: null };
  }

  const candidateText = data.candidates[0]?.content?.parts?.[0]?.text;
  if (candidateText) {
    const cleanedText = candidateText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedText);
  }
  throw new Error('Invalid response structure from Gemini audio API');
}
