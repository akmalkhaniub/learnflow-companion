# Privacy Policy for LearnFlow

**Last Updated:** November 28, 2026 (v1.5.2)

LearnFlow is an open-source, privacy-first personal learning companion built for Google Chrome. We believe your reading habits, study notes, and personal learning workflows are strictly your own.

---

## 1. Data Collection & Processing
* **Local Processing:** All text-to-speech conversion, DOM extraction, and page readability parsing occur entirely on your local machine using standard browser APIs (`window.speechSynthesis`).
* **No Telemetry or Tracking:** LearnFlow does not collect telemetry or send browsing history to analytics servers. It records learning history locally only when you use reading, briefing, selection playback, or archival features on a page. Unrelated browsing is not recorded. You can clear existing history from the History tab; records from earlier versions remain until you clear them.
* **On-Device AI:** When Chrome's built-in **Gemini Nano** is used, all prompt execution, code summarization, and audio briefing happen 100% locally on your device without sending text across the internet.

---

## 2. Storage & Cloud Sync
* **Local Storage:** Your reading history, playlist queue, bookmarks with personal notes, and preferences are stored locally in your browser via `chrome.storage.local`. Bookmark notes are not sent to AI or Google Drive. You can edit or delete them in the Study tab.
* **Local File Exports:** Archived notes and Markdown files are saved directly to your local computer's storage (e.g. `Downloads/LearnFlow_Vault/` or your configured Obsidian folder).
* **Google Drive Sync (Optional):** If you configure Google Drive sync, notes and figures are transmitted exclusively to your personal Google Drive account using your own Google Apps Script webhook or Google OAuth token. No intermediary server has access to your files.

---

## 3. Third-Party Services
* **Firebase AI Logic (default AI provider):** Once AI is configured (Firebase config plus an App Check token), LearnFlow sends AI requests through Google's Firebase AI Logic to the Gemini Developer API. In **Prefer On-Device** mode, requests run on Chrome's built-in Gemini Nano when your device supports it, and are sent to the cloud only when it doesn't. **Cloud Only** mode always sends them to the cloud. Figure explanations always go to the cloud. A request contains the text needed for the task:
  * **While reading:** code blocks (Code Whisperer, on by default), tables, and figure images with their captions and nearby text, sent as LearnFlow reaches them and up to two items ahead.
  * **When you ask:** page text for audio briefs, the current section for quizzes, page text for Anki flashcards, your question plus up to 25,000 characters of the current page's text when you ask from the Side Panel or `lf` address-bar search, the titles, categories and URLs of up to 25 saved notes for vault search, and selected text for "Ask Gemini".
  * **App Check:** LearnFlow sends an App Check debug token or attestation to Google's App Check service to prove requests come from LearnFlow.

  Processing follows [Firebase's](https://firebase.google.com/terms) and [Google's Gemini API](https://ai.google.dev/terms) terms. LearnFlow doesn't operate its own servers and doesn't see your requests. Bookmark notes are never sent. **On-Device Only** mode keeps text tasks on your device, but figure explanations still use the cloud. To stop all cloud AI requests, clear the App Check token in Settings.
* **Google Gemini API (Optional developer fallback):** If you select **Direct Gemini** and supply a Google Gemini API key, prompt queries, relevant document excerpts, and figure images (for figure explanations) are sent directly to Google's official Gemini API endpoints for processing according to [Google's AI Terms of Service](https://ai.google.dev/terms). Requesting a section quiz sends up to 16,000 characters from the current section; quiz answers and scores remain in the side panel and are not saved.

---

## 4. Permissions Disclosure
* `storage`: Used to save reading progress, settings, and local vault indices.
* `activeTab` & `tabs`: Used to extract text from open tutorial pages, capture YouTube video frames, and switch tabs during Playlist Queue autoplay.
* `downloads`: Used solely to save user-requested Markdown study guides, images, and Anki CSV flashcards to your local disk.
* `sidePanel`: Used to display the interactive learning assistant and vault browser.
* `contextMenus`: Used to provide quick "Read selection aloud" and "Ask Gemini" actions from the right-click menu.
* `identity`: Used strictly for authenticating directly with Google Drive if OAuth is selected.
* `scripting`: Used to read the current tab's text as context when you ask Gemini a question from the Side Panel.
* `tts`: Used as a fallback speech engine (`chrome.tts`) when page audio can't start automatically after moving to the next chapter.
* Host access (`<all_urls>`): Used so the reader can read, highlight and move through tutorial pages on any site (including embedded lesson frames), and fetch figure images for explanations and archives. LearnFlow only reads a page when you use it there.

---

## 5. Contact & Open Source
LearnFlow is free and open-source software. You can inspect the complete source code or report issues at:
**[https://github.com/akmalkhaniub/learnflow-companion](https://github.com/akmalkhaniub/learnflow-companion)**

LearnFlow requests stateless Gemini interactions (`store: false`). This does not override Google's own service terms or data-handling policies.
