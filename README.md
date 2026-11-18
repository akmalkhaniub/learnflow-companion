# 🎧 LearnFlow - Hands-Free Reader & Ask Gemini Companion (v1.2.0)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Gemini AI](https://img.shields.io/badge/AI-Gemini%20Nano%20%26%20Flash-purple.svg)](https://ai.google.dev/)
[![Version](https://img.shields.io/badge/Version-1.2.0-orange.svg)](https://github.com/akmalkhaniub/learnflow-companion)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Turn any documentation, technical book, or tutorial into a **continuous hands-free audiobook**, generate **spoken 2-minute executive briefs with Gemini**, whisper-summarize code blocks aloud, manage a **multi-tab learning queue**, and export **Anki flashcards** while automatically archiving to your **Local Obsidian Vault** and **Google Drive**.

---

## 🌟 What's New in v1.2.0

* 💻 **Smart Code Whisperer:** Instead of robotic syntax, code blocks are automatically translated into 1 natural spoken sentence describing what the code does.
* 📑 **Multi-Tab Playlist Queue:** Line up 5 chapters, tutorials, or YouTube videos across open tabs; LearnFlow autoplays through them in sequence like Spotify.
* ⏱️ **Sleep & Pomodoro Timer:** Set a 15m, 25m (Pomodoro), or 45m timer that automatically stops audio and pauses auto-advance.
* 📇 **Instant Anki Flashcards:** Automatically generates 5 high-yield active-recall flashcards from any chapter/video with 1-click `.csv` export.
* 🔍 **Semantic Vault Search:** Ask Gemini in the Side Panel: *"Summarize the Kubernetes tutorials I studied last week"*, and it queries your saved notes.
* 📓 **Obsidian Vault Sync:** Direct folder path configuration to save Markdown notes straight into your Obsidian Vault.

---

## 🚀 Core Feature Breakdown

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LearnFlow 1.2 Architecture                      │
├──────────────────────────┬───────────────────────┬─────────────────────┤
│ 1. Hands-Free Audio      │ 2. Ask Gemini AI      │ 3. Deep Archiver    │
│ - O'Reilly next chapter  │ - 2-Min Audio Brief   │ - Preserves tables  │
│ - Google Skills next step│ - Smart Code Whisperer│ - Base64 diagrams   │
│ - Multi-Tab Queue        │ - Anki Flashcard Gen  │ - Local & Obsidian  │
│ - Sleep & Pomodoro Timer │ - Semantic Vault Q&A  │ - Google Drive Sync │
└──────────────────────────┴───────────────────────┴─────────────────────┘
```

### 1. Hands-Free Audio Reading & Auto-Navigation
- **Native Browser Voices:** Completely offline, free, and instant audio playback using high-quality system voices with adjustable speed ($0.8\times$ to $2.2\times$).
- **O'Reilly Learning Platform:** Auto-detects chapter completion, flips to the next chapter (`a[data-testid="next-link"]`), and continues reading without touching your mouse.
- **Google Cloud Skills Boost (`skills.google`):** Automatically navigates sequential lab steps.
- **Karaoke Highlighting:** Soft visual highlighting on the active sentence with smooth auto-scroll.

### 2. "Ask Gemini" Companion
- **Omnibox Address Bar Integration:** Type `lf <your question>` in Chrome's URL bar, press `Enter`, and the Side Panel immediately opens with Gemini's contextual answer!
- **2-Minute Executive Audio Briefs:** Click **✨** on the floating player to generate a concise, spoken executive summary tailored for listening on the go.
- **Smart Code Whisperer:** Understand code without reading curly braces and commas.
- **Hybrid AI Engine:** Works offline with Chrome's built-in **Gemini Nano** (`window.ai`), or connects to **Gemini 2.0 / 1.5 Flash API** for deep reasoning.

### 3. Deep Archival (Tables, Figures, & Multi-Cloud Storage)
- **Tables Preserved:** Automatically converts HTML tables into clean GitHub-flavored Markdown tables.
- **Self-Contained Illustrations:** Converts diagrams and figures into embedded **Base64 Data URLs** so notes render images offline.
- **Obsidian / Local Disk Vault:** Saves directly to `Downloads/LearnFlow_Vault/` or your configured Obsidian folder.
- **Google Drive Sync:** Direct synchronization to a dedicated `LearnFlow Vault` folder in your Google Drive via the included Google Apps Script webhook.

### 4. YouTube Video Study Guide Generator
- **Transcript Extraction:** Pulls video scripts with chronological timestamps.
- **Keyframe Canvas Capture:** Grabs high-res screenshots from the HTML5 video player and bundles them directly into your notes.

---

## ⌨️ Quick Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `lf <query>` in Address Bar | Ask Gemini or search your vault |
| `Alt + L` | Toggle Audio Play / Pause |
| `Alt + G` | Generate 2-Minute Gemini Audio Brief |
| `Alt + Shift + L` | Toggle Chrome Side Panel |
| Right-Click Selection | "✨ Ask Gemini to explain this snippet" or "🎧 Read aloud" |

---

## 📦 Installation (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/akmalkhaniub/learnflow-companion.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (top-left) and select the `learnflow-companion` folder.
5. Pin **LearnFlow** to your browser toolbar.

---

## ☁️ Google Drive Sync Setup (Optional, 1 Minute)

1. Open [script.google.com](https://script.google.com) and click **New project**.
2. Open the **Settings tab** in LearnFlow's Side Panel and click **"📋 Copy Apps Script Code"**.
3. Paste the code into the script editor.
4. Click **Deploy** -> **New deployment** -> Select **Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
5. Copy the generated Web app URL (ends with `/exec`).
6. Paste the URL into the **Google Apps Script Webhook URL** field in LearnFlow's Settings and click **Save**.

---

## 📄 License

MIT License. Open source and free for personal and community use.


## Reliability update & Resume home

The side panel now opens on Home, with the most recent saved article, a Resume button, and the next three queued pages. Briefs and selected-text playback do not change article progress or trigger chapter completion. Queue entries remain queued until the destination reader confirms it has started; failed handoffs can be retried.

History records pages used with LearnFlow, not unrelated browsing. Existing history can be cleared in the History tab. Drive sync validates server responses and uploads separate figure assets. **Existing Apps Script users must copy the updated script from Settings and redeploy their web app to enable figure uploads.** Failed cloud sync is shown separately from successful local saving.

### Verification

- `node tests/regression.test.cjs` — Drive response handling and interrupted narration regression tests (no dependencies).
- `python tests/e2e_test.py` — browser tests using Python Playwright and Microsoft Edge on Windows. Includes Home/resume, playback isolation, privacy, archival, and queue handoff. Screenshots are written to `tests/artifacts/`.


### v1.2.7 reader fixes

Text highlights follow the active sentence without an inset stripe covering the left edge. Speech errors pause at the current sentence for retry; finishing retains the last position on screen. Archiving no longer rebuilds the playback queue, fragment-only URL changes do not restart reading, and rapid navigation saves positions in order.

After updating, reload the unpacked extension and refresh the article tab to replace its existing content scripts. The side-panel header displays the loaded version.


### v1.2.8 automatic chapter advance

Progress reaches 100% only after the final sentence finishes. Automatic archival skips AI flashcards and limits image fetching to a four-second budget (remaining images retain their source URLs), so these requests cannot hold up chapter navigation. Manual archival still generates flashcards when configured. Auto-Next respects the configured delay, ignores disabled/hidden/self links, and keeps its resume marker in the current tab. The next page waits for readable content before starting; missing Next links and disabled Auto-Next show an explanation.


### v1.2.9 reading controls and figure explanations

- Scroll, then use the crosshair button or Settings → Read from here. Previous/Next section jumps between headings. Optional Follow my scroll pauses listening during a wheel/touch/keyboard scroll and resumes at visible text after scrolling settles.
- Settings shows the detected Next control. Next page now tests it immediately; Choose Next lets you select an enabled page control for the current chapter. O'Reilly navigation also checks actual ordered book TOC links and ignores current-chapter fragments; no chapter URLs are guessed. Buttons that replace chapter content without changing the URL are handled.
- Figure explanations use image pixels, captions, and nearby prose, describing components, relationships, flow, and takeaway. Failures show their cause, explicitly read “Caption only,” and can be retried with Explain visible figure. Cross-origin image retrieval can use the extension's existing host permissions.
- The cloud client now uses Gemini Interactions with `gemini-3.5-flash-lite` by default, a configurable model, a request timeout, and `store: false`. Settings → Test AI connection checks saved credentials. A cloud API key is required for figure explanations, and provider usage charges may apply.

Validation uses local browser fixtures and mocked AI responses. The signed-in O'Reilly page and real Gemini account have not been verified by these tests. Reload the extension and refresh the article tab after updating.
