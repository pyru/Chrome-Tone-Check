# Chrome Tone Check

A Chrome extension that quietly watches your writing and speaking in real time and gives you a gentle nudge when your tone sounds harsh, aggressive, or condescending — powered by Google Gemini AI.

---

## Why This Matters

Miscommunication is costly. A single poorly-worded email can damage a professional relationship, derail a project, or escalate a conflict that didn't need to exist. Research consistently shows that tone — not just content — determines how messages are received.

**Chrome Tone Check** acts like a thoughtful colleague reading over your shoulder:
- It catches heated language before you hit Send
- It suggests a calmer, more constructive alternative
- It works across email, chat, and live meetings
- It runs privately — your text never leaves your browser except for the AI analysis call

### Who benefits

| User | Impact |
|---|---|
| Professionals under stress | Prevents impulsive emails that damage relationships |
| Remote teams | Bridges tone gaps that video calls would naturally soften |
| Managers giving feedback | Encourages constructive framing over criticism |
| Non-native English speakers | Flags unintentionally blunt phrasing |
| Anyone in a high-stakes conversation | Adds a moment of reflection before words are sent |

---

## Features

- **Real-time text analysis** — detects harsh tone as you type in any text box (Gmail, Outlook, Slack, Teams, Notion, etc.)
- **Speech analysis** — floating mic widget listens during web meetings (Google Meet, Zoom web, Teams) and alerts you if you sound too aggressive
- **One-click replacement** — accept the suggested alternative with a single click
- **Debounced & rate-limited** — sends one API call per pause in typing, not on every keystroke
- **Private by design** — no data stored on any server; analysis happens via your own Gemini API key

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
5. The extension icon will appear in your Chrome toolbar

### 3. Add Your API Key
1. Click the **Tone Check** extension icon in the toolbar
2. Paste your Gemini API key into the input field
3. Click **Save Configuration**

That's it — the extension is now active on every page.

---

## How to Use

### Text Analysis (Email / Chat)
- Open any compose window (Gmail, Outlook, Slack, etc.)
- Start typing your message
- After a 1.5-second pause, Tone Check silently analyzes your text
- If your tone is detected as harsh, a nudge appears below the text box:
  - **Ignore** — dismiss the suggestion and keep your original text
  - **Replace** — swap your text with the suggested alternative instantly

### Speech Analysis (Meetings)
- A small floating microphone icon appears on every page
- Click it to start listening (you'll be prompted to allow microphone access)
- Speak normally during your meeting
- If your speech sounds harsh or aggressive, a speech alert appears with a suggested rephrasing
- The alert auto-dismisses after 8 seconds
- Click the mic icon again to stop listening

---

## Project Structure

```
ToneCheck/
├── manifest.json        # Chrome extension manifest (MV3)
├── background.js        # Service worker — calls Gemini API
├── content.js           # Injected into pages — detects typing & speech
├── content.css          # Styles for the nudge overlay
├── popup.html           # Extension popup UI
├── popup.js             # Popup logic — saves API key to chrome.storage
├── popup.css            # Popup styles
├── .env.example         # Developer reference for required keys
└── .gitignore
```

---

## Environment Variables

This extension does **not** read `.env` files at runtime (Chrome extensions are client-side only). Your API key is stored securely in `chrome.storage.local` via the extension popup.

The `.env.example` file is provided as a reference for developers:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

Copy it to `.env` locally if needed for tooling — it is gitignored and will never be committed.

---

## Privacy

- Your text is sent to the **Google Gemini API** using your own API key — no third-party servers are involved
- Nothing is logged, stored, or shared beyond the single API call
- Speech audio is processed locally by the browser's Web Speech API and only the transcript text is sent to Gemini
- The extension requests only the permissions it needs: `storage`, `activeTab`, `scripting`, `tabCapture`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No nudge appearing | Check that your API key is saved in the popup |
| `API 400` error | Reload the extension at `chrome://extensions` |
| `Rate limit` error | Wait ~60 seconds; the extension backs off automatically |
| Mic button not working | Allow microphone access when Chrome prompts you |
| Nudge appears in wrong position | Scroll the page slightly to trigger a reposition |

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

---

## License

MIT
