# 🎧 LearnFlow - Hands-Free Reader & Auto-Archiver (Chrome Extension)

A personal Chrome extension (Manifest V3) that turns documentation, tutorial websites, and book platforms into **continuous hands-free audiobooks**, automatically tracks your learning history, and archives full content (with tables, figures, and YouTube transcripts with screenshots) to both your **Local Drive** and **Google Drive**.

---

## 🌟 Key Features

### 1. Hands-Free Audio & Auto-Navigation
- **Native Browser Voices:** Completely free, offline, instant playback using your system's natural English voices (Google, Microsoft Neural, Apple, etc.) with rate control ($0.8\times$ to $2.2\times$).
- **O'Reilly Learning Platform:** 
  - Extracts the core reader body (`#sbo-rt-content`), isolating clean text from sidebar menus.
  - When the chapter ends, **Auto-Navigator** automatically locates and clicks the next chapter button (`a[data-testid="next-link"]`), advances the page, and immediately resumes reading hands-free!
- **skills.google / Google Cloud Skills Boost:**
  - Extracts the lab/tutorial instruction steps and auto-advances to the next lesson or step.
- **Karaoke Highlighting:** Visually highlights the active sentence with smooth auto-scrolling so you can glance at the screen at any moment.

### 2. Deep Archival (Local Drive + Google Drive)
- **Tables & Figures Preserved:**
  - Converts HTML tables into clean GitHub-flavored Markdown tables.
  - Converts figures and illustrations into self-contained embedded images (`base64` Data URLs) so your archived `.md` files render diagrams even offline!
- **Local Drive Storage:**
  - Saves automatically to your local disk in a clean folder structure:
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
  - Also supports direct directory binding via the **File System Access API** in the Side Panel.
- **Google Drive Sync:**
  - Includes a zero-friction Google Apps Script webhook integration (or Google Drive API) to mirror your notes directly into a `LearnFlow Vault` folder in your Google Drive.

### 3. YouTube Study Guide & Transcript Generator
- **Transcript Extraction:** Grabs timestamps and formatted text segments.
- **Keyframe Screenshots:** Takes in-memory canvas screenshots of the exact video playback frame and embeds them into your Markdown notes.

### 4. Chrome Side Panel Dashboard
- **📁 Vault:** Search, filter, and review all saved books, tutorials, and video notes.
- **🕒 Auto-History:** Automatically tracks pages and videos you visit without manual bookmarking.
- **⚙️ Settings:** Configure voices, speed rate, auto-advance countdown delay, and cloud sync.

---

## 🚀 Installation Instructions (30 Seconds)

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
2. Turn ON **"Developer mode"** in the top-right corner.
3. Click **"Load unpacked"** in the top-left corner.
4. Select the project directory:
   ```text
   G:\ReplitProjects\learnflow-companion
   ```
5. Pin **LearnFlow** to your Chrome toolbar for easy access!

---

## 📖 How to Use

### A. Reading O'Reilly Books or Google Skills Tutorials
1. Visit any book chapter on [learning.oreilly.com](https://learning.oreilly.com) or a tutorial on [skills.google](https://skills.google).
2. The **floating audio pill** appears at the bottom-right corner of your screen:
   - Click **▶ Play** to start listening.
   - Adjust speed ($1.0\times$, $1.25\times$, $1.5\times$, etc.) via the dropdown.
   - Keep **🔄 Auto-Next** toggled ON.
   - When the chapter finishes, it will count down (2s), auto-click next, load the next chapter, and resume reading automatically!
   - Click **💾** anytime to archive the page to local disk and Google Drive.

### B. YouTube Videos
1. Open any YouTube tutorial (e.g. `youtube.com/watch?v=...`).
2. The floating bar switches to **YouTube Mode**.
3. Click **📸 Save Note & Transcript**:
   - Takes a high-resolution screenshot of the current video frame.
   - Pulls the transcript script with timestamps.
   - Saves a complete Markdown study guide to `Downloads/LearnFlow_Vault/YouTube/`.

### C. Chrome Side Panel
- Click the **LearnFlow** extension icon in your browser toolbar to open the Side Panel.
- Browse past tracked pages, search your saved chapters, or export everything to JSON.

---

## ☁️ Setting Up Google Drive Sync (Optional, 1 Minute)

1. Open [script.google.com](https://script.google.com) and click **New project**.
2. Open LearnFlow's **Settings tab** in the Side Panel and click **"📋 Copy Apps Script Code"**.
3. Paste the code into the Google Apps Script editor.
4. Click **Deploy** -> **New deployment** -> Select type **Web app**.
   - Set *Execute as:* **Me**.
   - Set *Who has access:* **Anyone** (or your Google account).
5. Copy the generated Web app URL (ends with `/exec`).
6. Paste the URL into LearnFlow's **Google Apps Script Webhook URL** field in Settings and click **Save**.
7. All your archives will now automatically sync to a `LearnFlow Vault` folder in your Google Drive!
