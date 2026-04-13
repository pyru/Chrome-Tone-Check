# ToneCheck — Chrome Extension

ToneCheck watches your writing and speaking in real time and gives you a gentle nudge when your tone sounds harsh, angry, or aggressive — powered by Google Gemini AI.

---

## What It Does

- **While you type** — analyzes your emails and messages and alerts you if the tone is harsh, with a one-click suggestion to soften it
- **While you speak** — listens during Zoom, Google Meet, or any web meeting and warns you if your voice sounds angry, stressed, or too loud

---

## Setup (3 steps, takes 2 minutes)

### Step 1 — Get a free Gemini API Key

1. Go to **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**
2. Sign in with your Google account
3. Click **Create API key** and copy it — you will need it in Step 3

### Step 2 — Install the Extension

1. Download or clone this repository to your computer
2. Open Chrome and go to **`chrome://extensions`** in the address bar
3. Turn on **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Select the **ToneCheck** folder you downloaded
6. The ToneCheck icon will appear in your Chrome toolbar

### Step 3 — Add Your API Key

1. Click the **ToneCheck icon** in the Chrome toolbar
2. Paste your Gemini API key into the box
3. Click **Save**

You're ready to go.

---

## How to Use

### Checking tone while writing (Gmail, Outlook, Slack, etc.)

1. Open any email or message compose window
2. Start typing your message
3. Pause for a moment — ToneCheck will silently analyze your text
4. If the tone seems harsh, a small alert appears near the text box

   ![tone alert example]

   - Click **Replace** to instantly swap in the suggested calmer version
   - Click **Ignore** to keep your original text

### Checking tone during a meeting (Zoom, Google Meet, Teams)

1. Look for the **purple microphone button** in the bottom-right corner of any page
2. Click it — Chrome will ask for microphone access, click **Allow**
3. The button pulses to show it is listening
4. Speak normally during your meeting
5. If your voice sounds angry, too loud, or stressed, an alert pops up with a tip
6. Click **✕** on the alert to dismiss it, or it will close automatically after 8 seconds
7. Click the microphone button again to stop listening

> **Works with:** Zoom web (`zoom.us`), Google Meet, Microsoft Teams web
> **Does not work with:** The Zoom desktop app (Chrome extensions cannot access native apps)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| No alerts appearing | Click the ToneCheck icon and make sure your API key is saved |
| Red banner at the top of the page | The extension was reloaded — press **Ctrl + Shift + R** to refresh the tab |
| Microphone button does nothing | Click **Allow** when Chrome asks for microphone permission |
| `Rate limit` error in console | Wait 60 seconds — ToneCheck will resume automatically |
| Voice alerts not showing on Zoom | Refresh the Zoom tab after installing or reloading the extension |

---

## Privacy

Your text and audio are sent only to **Google's Gemini API** using your own API key. Nothing is stored, logged, or shared with anyone else.

---

## License

MIT
