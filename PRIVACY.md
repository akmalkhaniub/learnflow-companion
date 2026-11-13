# Privacy Policy for LearnFlow

**Last Updated:** November 2026

LearnFlow is an open-source, privacy-first personal learning companion built for Google Chrome. We believe your reading habits, study notes, and personal learning workflows are strictly your own.

---

## 1. Data Collection & Processing
* **Local Processing:** All text-to-speech conversion, DOM extraction, and page readability parsing occur entirely on your local machine using standard browser APIs (`window.speechSynthesis`).
* **No Telemetry or Tracking:** LearnFlow does not collect telemetry, track browsing behavior, or send personal browsing history to third-party analytic servers.
* **On-Device AI:** When Chrome's built-in **Gemini Nano** is used, all prompt execution, code summarization, and audio briefing happen 100% locally on your device without sending text across the internet.

---

## 2. Storage & Cloud Sync
* **Local Storage:** Your reading history, playlist queue, and preferences are stored locally in your browser via `chrome.storage.local`.
* **Local File Exports:** Archived notes and Markdown files are saved directly to your local computer's storage (e.g. `Downloads/LearnFlow_Vault/` or your configured Obsidian folder).
* **Google Drive Sync (Optional):** If you configure Google Drive sync, notes and figures are transmitted exclusively to your personal Google Drive account using your own Google Apps Script webhook or Google OAuth token. No intermediary server has access to your files.

---

## 3. Third-Party Services
* **Google Gemini API (Optional):** If you choose to supply a Google Gemini API key, prompt queries and relevant document excerpts are sent directly to Google's official Gemini API endpoints for processing according to [Google's AI Terms of Service](https://ai.google.dev/terms).

---

## 4. Permissions Disclosure
* `storage`: Used to save reading progress, settings, and local vault indices.
* `activeTab` & `tabs`: Used to extract text from open tutorial pages, capture YouTube video frames, and switch tabs during Playlist Queue autoplay.
* `downloads`: Used solely to save user-requested Markdown study guides, images, and Anki CSV flashcards to your local disk.
* `sidePanel`: Used to display the interactive learning assistant and vault browser.
* `contextMenus`: Used to provide quick "Read selection aloud" and "Ask Gemini" actions from the right-click menu.
* `identity`: Used strictly for authenticating directly with Google Drive if OAuth is selected.

---

## 5. Contact & Open Source
LearnFlow is free and open-source software. You can inspect the complete source code or report issues at:
**[https://github.com/akmalkhaniub/learnflow-companion](https://github.com/akmalkhaniub/learnflow-companion)**
