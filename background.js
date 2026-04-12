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

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'analyzeTone') {
    (async () => {
      try {
        const result = await analyzeToneWithGemini(request.text);
        sendResponse(result);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'analyzeMeetingAudio') {
    // Receives a base64 audio chunk + locally-measured features (volume, pitch)
    // and sends both to Gemini for nuanced analysis of anger, sarcasm, etc.
    (async () => {
      try {
        const result = await analyzeSpeechWithGemini(
          request.audioData, request.mimeType, request.audioFeatures
        );
        sendResponse(result);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});

async function analyzeToneWithGemini(text) {
  // Retrieve API key from storage
  const storage = await chrome.storage.local.get(['apiKey']);
  const apiKey = storage.apiKey;

  if (!apiKey) {
    throw new Error('API Key missing. Please set it in the extension popup.');
  }

  // gemini-2.0-flash is retired; gemini-2.5-flash is the current flash model.
  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `
You are a tone analyzer assistant. Analyze the following text (which could be an email, chat message, or transcribed speech). 
Determine if the tone could be perceived as harsh, purely negative, aggressive, or condescending.
If it is, provide a gentler, more constructive alternative, and a brief reason.
If it's fine, mark it as not harsh.
Return ONLY valid JSON in this exact format, with no markdown formatting or backticks:
{
  "isHarsh": boolean,
  "reason": "string or null",
  "alternative": "string or null"
}

Text to analyze:
"${text}"
`;

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
          temperature: 0.2
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
      // Extract the human-readable message from Gemini's error JSON so it
      // surfaces in the Gmail console rather than staying buried in the
      // service worker console.
      let detail = errText;
      try { detail = JSON.parse(errText).error?.message || errText; } catch {}
      if (response.status === 429) {
        throw new Error('Rate limit reached — please wait a moment before typing more.');
      }
      throw new Error(`API ${response.status}: ${detail}`);
    }

    const data = await response.json();
    
    // Check if it got blocked by safety or had no candidates
    if (!data.candidates || data.candidates.length === 0) {
      console.error("No candidates returned, possibly blocked by safety constraints.", data);
       return { isHarsh: false, reason: "Text was blocked or could not be analyzed.", alternative: "" };
    }

    const candidateText = data.candidates[0]?.content?.parts?.[0]?.text;
    
    if (candidateText) {
      // Strip any markdown fences the model may wrap around the JSON
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
// Receives base64-encoded WebM audio recorded from the user's microphone.
async function analyzeSpeechWithGemini(audioData, mimeType, audioFeatures) {
  const storage = await chrome.storage.local.get(['apiKey']);
  const apiKey = storage.apiKey;
  if (!apiKey) throw new Error('API Key missing. Please set it in the extension popup.');

  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // Append locally-measured signal features so Gemini has quantitative context
  // to help detect sarcasm, anger, and screaming more accurately.
  const featureContext = audioFeatures
    ? `\nLocally measured audio features — volume RMS: ${audioFeatures.avgVol} (0–1 scale), average pitch: ${audioFeatures.avgPitch} Hz.`
    : '';

  const prompt = `Listen to this audio of someone speaking.${featureContext}
Analyze ALL of the following dimensions:
1. WORDS: Are the words harsh, dismissive, threatening, or condescending?
2. ANGER: Does the voice sound tense, loud, or aggressive in tone?
3. SCREAMING: Is the speaker shouting or raising their voice excessively?
4. SARCASM: Does the intonation suggest sarcasm (exaggerated pitch rise/fall, drawn-out words, mocking tone)?

Detect any of the above — even if the words alone seem neutral (e.g. "That's FINE" said sarcastically).
If any dimension is problematic, provide a calmer rephrasing and a brief reason.
If everything is fine, mark as not harsh.
Return ONLY valid JSON with no markdown:
{
  "isHarsh": boolean,
  "reason": "string or null",
  "alternative": "string or null"
}`;

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
      generationConfig: { temperature: 0.2 }
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
