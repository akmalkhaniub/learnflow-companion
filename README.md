# 🎧 LearnFlow - Hands-Free Reader & Ask Gemini Companion

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Gemini AI](https://img.shields.io/badge/AI-Gemini%20Nano%20%26%20Flash-purple.svg)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Turn any documentation, technical book, or tutorial into a **continuous hands-free audiobook**, generate **spoken 2-minute executive briefs with Gemini**, and automatically archive complete pages (with tables, diagrams, and YouTube scripts with screenshots) directly to your **Local Vault** and **Google Drive**.

---

## 🌟 Why LearnFlow?

Most online technical learning materials require continuous manual clicking, scrolling, and reading through walls of text and code. Existing text-to-speech tools stumble across multi-chapter books, don't auto-navigate pages, read raw code syntax robotically, and don't preserve your learning history.

**LearnFlow** solves this with a purpose-built architecture tailored for platforms like **O'Reilly Learning (Safari Books Online)**, **Google Cloud Skills Boost (`skills.google`)**, and **YouTube technical tutorials**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LearnFlow Core Engine                           │
├──────────────────────────┬───────────────────────┬─────────────────────┤
│ 1. Hands-Free Audio      │ 2. Ask Gemini AI      │ 3. Deep Archiver    │
│ - O'Reilly next chapter  │ - 2-Min Audio Brief   │ - Preserves tables  │
│ - Google Skills next step│ - Explain code/tables │ - Base64 figures    │
│ - Karaoke highlighting   │ - YouTube Q&A         │ - Local + GDrive    │
└──────────────────────────┴───────────────────────┴─────────────────────┘
```

---

## 🚀 Key Features

### 1. Hands-Free Audio Reading & Auto-Navigation
- **Native Browser Voices:** Completely offline, free, and instant audio playback using high-quality system voices (Google, Microsoft Natural, Apple) with adjustable speed ($0.8\times$ to $2.2\times$).
- **O'Reilly Learning Platform:** 
  - Extracts clean book text (`#sbo-rt-content`), eliminating sidebars and navigation noise.
  - When a chapter finishes reading, **Auto-Navigator** automatically locates and clicks the next chapter button (`a[data-testid="next-link"]`), advances the page, and **resumes playback automatically**.
- **Google Cloud Skills Boost (`skills.google`):**
  - Isolates lab tutorial steps and auto-advances through sequential procedures.
- **Karaoke Highlighting:** Soft visual highlighting on the active sentence with smooth auto-scroll.

### 2. "Ask Gemini" Companion (On-Device Nano + Cloud Flash)
- **Omnibox Address Bar Integration:** Type `lf <your question>` in Chrome's URL bar, press `Enter`, and the Side Panel immediately opens with Gemini's contextual answer!
- **2-Minute Executive Audio Briefs:** Click **✨** on the floating player to generate a concise, spoken executive summary tailored for listening on the go.
- **Plain-English Code & Table Explanations:** Explains complex bash scripts, YAML files, and architecture tables in plain spoken terms.
- **Hybrid AI Engine:**
  - **On-Device:** Works offline with Chrome's built-in **Gemini Nano** (`window.ai`).
  - **Cloud:** Connects to the **Gemini 2.0 / 1.5 Flash API** for deep reasoning over long chapters.

### 3. Deep Archival (Tables, Figures, & Local/Cloud Storage)
- **Tables Preserved:** Automatically converts HTML tables into clean GitHub-flavored Markdown tables.
- **Self-Contained Illustrations:** Converts diagrams and figures into embedded **Base64 Data URLs** so your archived notes render images even when offline.
- **Local Disk Vault:** Automatically organizes notes inside your Downloads folder:
  ```text
  Downloads/LearnFlow_Vault/
  ├── OReilly/
  │   └── [Book_Title]/
  │       ├── Chapter_1.md
  │       └── Chapter_2.md
  ├── GoogleSkills/
  │   └── [Tutorial_Title].md
  └── YouTube/
      └── [Video_Title].md
  ```
  *(Or bind directly to any custom local drive folder via the Side Panel's File System Access button).*
- **Google Drive Sync:** Direct synchronization to a dedicated `LearnFlow Vault` folder in your Google Drive via the included 1-minute Google Apps Script webhook.

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

## 🚢 Publishing to the Chrome Web Store

If you plan to publish LearnFlow for other developers and students to install from the Chrome Web Store:

1. **Google Developer Account:** Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (requires a one-time \$5 registration fee).
2. **Package the Extension:** Zip the project files (excluding `.git` and `.gitignore`):
   ```bash
   zip -r learnflow-extension.zip . -x "*.git*"
   ```
3. **Store Assets:**
   - 128x128 store icon.
   - At least one 1280x800 screenshot showing the in-page player and Side Panel.
   - A short privacy policy describing that reading data is processed locally.
4. **Permissions Justification:** Chrome requires a 1-sentence note for permissions like `downloads` ("Used to save user-requested Markdown study guides to local drive") and `storage` ("Used to store offline reading progress and settings").

---

## 📄 License

MIT License. Open source and free for personal and community use.
