# 📦 Chrome Web Store Submission Kit

Use this document to copy and paste directly into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## 1. Store Metadata

### Title
```text
LearnFlow - Hands-Free Reader & Ask Gemini AI
```
*(45 characters / 45 max)*

### Summary (Short Description)
```text
Continuous hands-free audiobook reader, Code Whisperer, Multi-Tab Queue, Anki cards & Gemini companion for O'Reilly, docs & YouTube.
```
*(132 characters / 132 max)*

### Category
* **Primary:** Productivity
* **Secondary:** Education / Workflow

---

## 2. Detailed Description (Paste into Store Listing)

```text
🎧 Turn Technical Books, Documentation & Tutorials into Continuous Hands-Free Audiobooks!

LearnFlow is your all-in-one personal reading companion. It converts technical book platforms, documentation websites, and video tutorials into an uninterrupted audio learning experience, automatically flips chapters, explains code conversationally, and archives comprehensive study notes to your Local Vault, Obsidian, and Google Drive.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 CORE HIGHLIGHTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 📖 TRUE CONTINUOUS AUDIOBOOK MODE
• O'Reilly Learning (Safari Books Online): Automatically detects when a chapter finishes, advances to the next chapter link, and continues reading aloud hands-free.
• Google Cloud Skills Boost (skills.google): Auto-advances through step-by-step lab procedures.
• Native Browser Speech: Completely offline, fast, and uses your system's natural English voices with speed controls from 0.8x to 2.2x.
• Visual Karaoke Highlighting: Softly highlights the current sentence with smooth auto-scroll.

2. 💻 SMART "CODE WHISPERER" AUDIO
• Never suffer through robotic syntax reading again ("curly brace semicolon arrow function").
• Gemini dynamically translates complex code blocks into a single natural spoken sentence describing what the code actually does.

3. 📑 MULTI-TAB PLAYLIST QUEUE
• Queue up 5 documentation tabs, chapters, or YouTube videos.
• When one tab finishes reading, LearnFlow automatically switches to the next tab and resumes playback like a podcast playlist.

4. ✨ ASK GEMINI COMPANION (ON-DEVICE NANO + CLOUD FLASH)
• Omnibox Shortcut: Type "lf" in Chrome's address bar to ask questions or search your vault.
• 2-Minute Spoken Audio Briefs: Generates concise executive summaries tailored for quick listening on walks or commutes.
• Side Panel Q&A: Query active page content or search across your past vault.

5. 📇 INSTANT ANKI FLASHCARDS
• Automatically extracts 5 high-yield active-recall question-and-answer pairs from any tutorial.
• 1-Click export to Anki-compatible CSV format.

6. 💾 COMPLETE ARCHIVING & STUDY GUIDES
• Tables Preserved: Converts HTML tables into clean Markdown tables.
• Self-Contained Illustrations: Converts figures and diagrams into embedded Base64 images that render offline.
• YouTube Study Guides: Captures high-res video frame screenshots + timestamped transcripts into Markdown.
• Dual Storage: Saves directly to your local drive (Downloads or custom Obsidian vault path) and auto-syncs to your Google Drive.

7. ⏱️ SLEEP & POMODORO TIMER
• Set 15m, 25m (Pomodoro), or 45m timers with gentle audio fade-out and auto-stop.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRIVACY & TRANSPARENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 100% Client-Side Processing: Speech synthesis and parsing run locally.
• No Tracking or Telemetry: Your browsing habits and notes are strictly private.
• Open Source: Fully auditable on GitHub.
```

---

## 3. Permissions Justifications (Required for Review Approval)

When prompted by the Chrome Web Store review team for permission justifications, paste the following:

| Permission | Justification for Reviewer |
| :--- | :--- |
| `storage` | Required to store user settings, reading speed preferences, playlist queue, and local vault index. |
| `activeTab` | Required to extract article and tutorial text from the current page and capture video canvas frames on YouTube. |
| `tabs` | Required to switch to the next tab in the user's sequential Playlist Queue when audio playback finishes. |
| `downloads` | Required to save user-requested Markdown study guides, images, and Anki CSV flashcards to the local disk. |
| `sidePanel` | Required to display the interactive learning assistant, playlist manager, and vault search panel. |
| `contextMenus` | Required to provide right-click shortcuts ("Read selection aloud" and "Ask Gemini to explain snippet"). |
| `identity` | Required to authenticate directly with the user's personal Google Drive when syncing notes. |

---

## 4. Privacy Practices Declarations

* **Single Purpose:** A continuous hands-free technical reader, auto-navigator, and study assistant with on-device AI summarization and note archival.
* **Does this extension collect user data?** No (or "Yes - only stored locally on the user's device and personal Google Drive").
* **Certification:** Check the box confirming compliance with the Chrome Web Store Developer Program Policies.
