# Chrome Tone Check

A Chrome extension that watches your writing and speaking in real time and gives you a gentle nudge when your tone sounds harsh, angry, sarcastic, or aggressive — powered by Google Gemini AI and live audio sentiment analysis.

---

## Why This Matters

Miscommunication is costly. A single poorly-worded email can damage a professional relationship, derail a project, or escalate a conflict that didn't need to exist. Research consistently shows that tone — not just content — determines how messages are received.

**Chrome Tone Check** acts like a thoughtful colleague reading over your shoulder:
- Catches heated language before you hit Send
- Detects angry, screaming, or sarcastic voice tone in real time — not just harsh words
- Suggests a calmer, more constructive alternative
- Works across email, chat, and live meetings (Google Meet, Zoom web, Teams web)
- Runs privately — your data never leaves your browser except for the Gemini API call

### Who Benefits

| User | Impact |
|---|---|
| Professionals under stress | Prevents impulsive emails that damage relationships |
| Remote teams | Bridges tone gaps that video calls would naturally soften |
| Managers giving feedback | Encourages constructive framing over criticism |
| Non-native English speakers | Flags unintentionally blunt phrasing |
| Anyone in a high-stakes meeting | Catches rising anger before it escalates |

---

## Features

### Text Analysis
- Monitors any text box as you type (Gmail, Outlook, Slack, Teams, Notion, etc.)
- Analyzes tone after a 1.5-second pause — one API call per pause, not per keystroke
- Detects harsh, aggressive, condescending, or dismissive language
- Shows a nudge with a one-click replacement

### Speech & Voice Analysis (Two-Layer System)

#### Layer 1 — Instant Local Detection (no API call, zero latency)
Uses the Web Audio API to measure three acoustic features on every animation frame:

| Signal | Measurement | Detects |
|---|---|---|
| **Volume** | RMS energy of the waveform | Screaming (sustained high amplitude) |
| **Pitch** | FFT peak in the 80–600 Hz voice band | Angry pitch elevation (> 220 Hz) |
| **Speech rate** | Zero-crossing rate of the waveform | Fast, agitated delivery |
| **Pitch variance** | Std deviation over a 3-second window | Erratic / sarcastic intonation |

Fires one of three immediate alerts with no API cost:
- 🔊 **Volume Alert** — screaming detected
- 😤 **Tone Alert** — angry voice (high volume + elevated pitch + fast rate)
- ⚡ **Stress Alert** — stressed or sarcastic pitch contour

#### Layer 2 — Gemini Audio Analysis (every 6 seconds)
Records 6-second audio chunks and sends them to Gemini along with the locally measured volume and pitch as numerical context. Gemini explicitly checks for:
- Harsh or condescending **words**
- **Angry** vocal tone (even with neutral words)
- **Screaming** or excessive volume
- **Sarcasm** — e.g. *"That's FINE"* said with exaggerated intonation

### Other
- **Rate-limit backoff** — automatically waits 60 seconds after a 429 error and retries
- **Multi-window aware** — multiple compose windows each track their own last-analyzed text independently
- **Extension reload safe** — detects context invalidation and stops gracefully if the extension is reloaded mid-session
- **Private by design** — no server of ours is involved; all API calls use your own Gemini key

---

## Setup

### 1. Get a Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Copy the key — you will paste it into the extension popup

### 2. Install the Extension (Developer Mode)
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `ToneCheck` folder from this repository
5. The extension icon appears in your Chrome toolbar

### 3. Add Your API Key
1. Click the **Tone Check** icon in the toolbar
2. Paste your Gemini API key
3. Click **Save Configuration**

That's it — active on every page immediately.

---

## How to Use

### Text (Email / Chat)
1. Open any compose window
2. Type your message
3. Pause for 1.5 seconds — Tone Check analyzes silently
4. If the tone is harsh, a nudge appears below the text box:
   - **Ignore** — keep your original text
   - **Replace** — swap in the suggested alternative instantly

### Speech (Meetings)
1. A floating microphone icon appears on every page
2. Click it — Chrome will prompt for microphone access
3. Speak normally during your meeting
4. Alerts appear automatically:
   - **Immediate** (Layer 1): volume, anger, or sarcastic pitch triggers a local alert within milliseconds
   - **Nuanced** (Layer 2): every 6 seconds, Gemini analyzes the full audio for anger, screaming, sarcasm, and harsh words
5. Each alert shows the detected issue and a suggested rephrasing — auto-dismisses after 8 seconds
6. Click the mic icon again to stop

### Zoom Compatibility
| Environment | Works? |
|---|---|
| Zoom web client (`zoom.us` in Chrome) | Yes — mic runs in shared mode alongside Zoom |
| Google Meet | Yes — fully browser-based |
| Teams web | Yes — fully browser-based |
| Zoom desktop app | No — Chrome extensions cannot inject into native apps |

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    content.js                       │
│                                                     │
│  Text input ──► debounce (1.5s) ──► sendMessage ──► background.js
│                                                     │            │
│  Mic button ──► getUserMedia                        │            │
│                    │                                │            ▼
│                    ├──► AudioSentimentAnalyzer      │   analyzeToneWithGemini()
│                    │    (rAF loop, instant alerts)  │   analyzeSpeechWithGemini()
│                    │                                │            │
│                    └──► MediaRecorder               │            │
│                         (6s chunks ──► sendMessage ─┘            │
│                                                                   │
│  ◄────────────────────── response (isHarsh, reason, alternative) ┘
│
│  showNudge() / showSpeechNudge() / showLocalToneAlert()
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
ToneCheck/
├── manifest.json        # Chrome MV3 manifest
├── background.js        # Service worker — Gemini text + audio API calls
├── content.js           # Page script — text debounce, AudioSentimentAnalyzer, MediaRecorder
├── content.css          # Nudge overlay styles
├── popup.html           # Extension popup UI
├── popup.js             # Saves API key to chrome.storage.local
├── popup.css            # Popup styles
├── .env.example         # Developer reference (key not read at runtime)
├── .gitignore
└── demo/
    ├── DEMO_SCRIPT.md       # Scene-by-scene recording guide
    └── VOICEOVER_NARRATION.md  # Full narration script
```

---

## Privacy

- Audio and text are sent only to the **Google Gemini API** using **your own API key** — no third-party servers
- Nothing is logged, stored, or shared beyond the single API call per analysis
- Audio chunks are base64-encoded in memory and discarded after the API response
- Permissions requested: `storage`, `activeTab`, `scripting` — no broad data access

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No nudge appearing | Confirm your API key is saved in the popup |
| `API 400` error | Reload the extension at `chrome://extensions` |
| `Rate limit` error | Wait ~60 seconds — the extension backs off and retries automatically |
| Mic button not responding | Allow microphone access when Chrome prompts |
| Speech alerts not appearing | Speak for at least 6 seconds before the first Gemini chunk fires |
| Volume alert too sensitive | The analyzer calibrates a baseline over the first ~5 seconds of listening |
| Extension context invalidated | Reload the page after reloading the extension |

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss the approach.

---

## License

MIT
