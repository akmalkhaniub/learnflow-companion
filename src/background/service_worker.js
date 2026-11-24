/**
 * service_worker.js - Background coordinator for LearnFlow & Ask Gemini Companion
 * Handles local disk downloads (Markdown + images/ folder), Show-in-Folder,
 * exact-URL tab history tracking (YouTube SPA & O'Reilly SPA), Google Drive sync, and Playlist Queue.
 */

import { GDriveSync } from '../utils/gdrive.js';

// Open the compact Smart Bar on toolbar icon click (user can open the full Side Panel from the bar or Alt+Shift+L)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((error) => console.error('[LearnFlow] Side panel config error:', error));

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_PLAYER' });
  } catch {
    // Restricted pages (chrome://, New Tab, Web Store) have no content script — open Side Panel instead
    if (tab.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  }
});

// Register Context Menus on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lf-open-player',
      title: '🎧 Open / Toggle LearnFlow Player on this page',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'lf-read-selection',
      title: '🎧 Read aloud with LearnFlow',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'lf-ask-gemini-selection',
      title: '✨ Ask Gemini to explain this snippet',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'lf-gemini-audio-brief',
      title: '🎙️ Ask Gemini: 2-Min Audio Briefing of this page',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'lf-add-to-queue',
      title: '📑 Add this page to Playlist Queue',
      contexts: ['page']
    });
  });
});

// Context Menu Clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'lf-open-player') {
    chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_PLAYER' });
  } else if (info.menuItemId === 'lf-read-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'READ_TEXT_SNIPPET',
      text: info.selectionText
    });
  } else if (info.menuItemId === 'lf-ask-gemini-selection') {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    chrome.storage.local.set({
      learnflow_pending_query: {
        prompt: `Explain this snippet in plain, clear spoken terms:\n"${info.selectionText}"`,
        source: tab.url
      }
    });
  } else if (info.menuItemId === 'lf-gemini-audio-brief') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRIGGER_GEMINI_AUDIO_BRIEF'
    });
  } else if (info.menuItemId === 'lf-add-to-queue') {
    const data = await chrome.storage.local.get(['learnflow_playlist']);
    const playlist = data.learnflow_playlist || [];
    playlist.push({
      title: tab.title,
      url: tab.url,
      siteType: detectSiteTypeFromUrl(tab.url),
      addedAt: Date.now()
    });
    await chrome.storage.local.set({ learnflow_playlist: playlist });
  }
});

// Omnibox Support: Type "lf <query>" in Chrome address bar
chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.windowId) {
    await chrome.sidePanel.open({ windowId: activeTab.windowId });
    await chrome.storage.local.set({
      learnflow_pending_query: {
        prompt: text,
        source: activeTab.url
      }
    });
  }
});

// Keyboard Shortcuts (Alt+L, Alt+Shift+L, Alt+G)
chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  if (command === 'toggle-play') {
    chrome.tabs.sendMessage(activeTab.id, { action: 'TOGGLE_PLAY' });
  } else if (command === 'open-sidepanel') {
    chrome.sidePanel.open({ windowId: activeTab.windowId });
  } else if (command === 'ask-gemini') {
    chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_GEMINI_AUDIO_BRIEF' });
  }
});

// Learning history is recorded only after an explicit reader action.
function detectSiteTypeFromUrl(url) {
  if (!url) return 'generic';
  if (url.includes('oreilly.com')) return 'oreilly';
  if (url.includes('skills.google') || url.includes('cloudskillsboost.google')) return 'google_skills';
  if (url.includes('youtube.com')) return 'youtube';
  return 'generic';
}

/**
 * Windows/Chrome-safe filename sanitizer (removes emojis, invalid chars, leading/trailing dots)
 */
function sanitize(name, maxLen = 65) {
  const cleaned = (name || 'General')
    // Strip non-ASCII / emojis that can break Chrome Downloads API path validation on Windows
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .substring(0, maxLen)
    .replace(/^[\s._-]+|[\s._-]+$/g, '');
  return cleaned || 'Document';
}

function downloadFile(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[LearnFlow] Download error for', filename, ':', chrome.runtime.lastError.message);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, downloadId, filename });
      }
    });
  });
}

/**
 * Save clean Markdown document + separate image assets into a structured local folder
 */
async function saveToLocalDisk(payload) {
  const settings = await chrome.storage.local.get(['obsidian_vault_folder']);
  const rawBase = (settings.obsidian_vault_folder || 'LearnFlow_Vault').replace(/^\/+|\/+$/g, '');
  const baseFolder = rawBase.split('/').map(p => sanitize(p, 45)).filter(Boolean).join('/') || 'LearnFlow_Vault';

  const category = sanitize(payload.category || 'General', 35);
  const book = sanitize(payload.bookTitle || 'Tutorials', 55);
  const chapter = sanitize(payload.chapterTitle || payload.title || 'Note', 55);

  const folderPrefix = `${baseFolder}/${category}/${book}`;
  const mdFilename = `${folderPrefix}/${chapter}.md`;

  // 1. Save clean UTF-8 Markdown file (zero base64 gibberish!)
  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(payload.markdown || '');
  const mdResult = await downloadFile(mdDataUrl, mdFilename);

  // 2. Save extracted figure/diagram/screenshot images into images/ subfolder
  const savedImages = [];
  if (Array.isArray(payload.images) && payload.images.length > 0) {
    for (const img of payload.images) {
      if (!img?.dataUrl || !img?.filename) continue;
      const safeImgName = sanitize(img.filename, 55);
      const imgPath = `${folderPrefix}/images/${safeImgName}`;
      const imgRes = await downloadFile(img.dataUrl, imgPath);
      if (imgRes.success) {
        savedImages.push(imgPath);
      }
    }
  }

  return {
    ...mdResult,
    imagesSaved: savedImages.length
  };
}

/**
 * Advance Multi-Tab Playlist Queue
 */
let playlistAdvanceInFlight = null;

async function startReadingUrl(url, passage = null) {
  const destination = new URL(url);
  if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Open a web article or video to read.');
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find(t => {
    if (t.url === url) return true;
    if (!passage || !t.url) return false;
    try { const candidate = new URL(t.url); candidate.hash = ''; return candidate.href === url; }
    catch { return false; }
  });
  tab = tab ? await chrome.tabs.update(tab.id, { active: true }) : await chrome.tabs.create({ url, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  // Wait for the destination content script to acknowledge playback. A failed
  // handoff leaves the queued item intact and is safe to retry.
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = await chrome.tabs.get(tab.id);
    if (current.status === 'complete') {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, passage
          ? { action: 'STUDY_JUMP', url, index: passage.index, text: passage.text }
          : { action: 'AUTO_START_READING' });
        if (result?.success) return { success: true };
        if (result?.error) throw new Error(result.error);
      } catch (error) {
        if (!/Receiving end|connection|port closed/i.test(error.message)) throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Reader could not start. Refresh the destination page and try again.');
}

function advancePlaylist() {
  if (playlistAdvanceInFlight) return playlistAdvanceInFlight;
  playlistAdvanceInFlight = (async () => {
    const data = await chrome.storage.local.get(['learnflow_playlist']);
    const nextItem = (data.learnflow_playlist || [])[0];
    if (!nextItem) throw new Error('Your queue is empty.');
    await startReadingUrl(nextItem.url);
    const latest = await chrome.storage.local.get(['learnflow_playlist']);
    const remaining = latest.learnflow_playlist || [];
    const index = remaining.findIndex(item => item.url === nextItem.url && item.addedAt === nextItem.addedAt);
    if (index >= 0) remaining.splice(index, 1);
    await chrome.storage.local.set({ learnflow_playlist: remaining });
    return { success: true };
  })().finally(() => { playlistAdvanceInFlight = null; });
  return playlistAdvanceInFlight;
}

/**
 * Extract canonical key for deduplicating exact URLs (e.g. YouTube videoId)
 */
function getHistoryKey(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('youtube.com')) {
      const vid = u.searchParams.get('v');
      if (vid) return `yt:${vid}`;
    }
    // Strip hash fragments for normal articles/chapters
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return urlStr;
  }
}

/**
 * Determine whether a URL is a real content page vs noisy homepage/search clutter
 */
function isTrackableUrl(urlStr) {
  if (!urlStr || !urlStr.startsWith('http')) return false;
  try {
    const u = new URL(urlStr);
    // Ignore search engines & blank utility pages
    if (u.hostname.includes('google.com') && u.pathname.startsWith('/search')) return false;
    // On YouTube, ONLY track actual videos, shorts, or playlists (NOT bare youtube.com/ homepage!)
    if (u.hostname.includes('youtube.com')) {
      const isVideo = u.pathname === '/watch' && u.searchParams.has('v');
      const isShort = u.pathname.startsWith('/shorts/');
      const isPlaylist = u.pathname === '/playlist' && u.searchParams.has('list');
      return isVideo || isShort || isPlaylist;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Log exact page/video visit into history (with YouTube videoId deduplication & timestamp retention)
 */
async function logPageVisit(payload) {
  if (!isTrackableUrl(payload.url)) return;

  const cleanTitle = (payload.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/i, '').trim();
  if (!cleanTitle || cleanTitle.toLowerCase() === 'youtube') return;

  const data = await chrome.storage.local.get(['learnflow_history']);
  let history = data.learnflow_history || [];

  // Also clean out any legacy bare youtube.com/ entries
  history = history.filter(item => isTrackableUrl(item.url));

  const newKey = getHistoryKey(payload.url);
  history = history.filter(item => getHistoryKey(item.url) !== newKey);

  history.unshift({
    title: cleanTitle,
    url: payload.url,
    siteType: payload.siteType || detectSiteTypeFromUrl(payload.url),
    timestamp: payload.timestamp || Date.now()
  });

  if (history.length > 1000) {
    history = history.slice(0, 1000);
  }

  await chrome.storage.local.set({ learnflow_history: history });
}

/**
 * Save item into vault index (stores downloadId so user can click "Show in Folder"!)
 */
async function recordArchivedItem(payload, localResult, gdriveResult) {
  const data = await chrome.storage.local.get(['learnflow_vault_items']);
  let items = data.learnflow_vault_items || [];

  items.unshift({
    title: payload.title,
    category: payload.category,
    bookTitle: payload.bookTitle,
    chapterTitle: payload.chapterTitle,
    url: payload.url,
    timestamp: Date.now(),
    downloadId: localResult?.downloadId || null,
    localFile: localResult?.filename || null,
    imagesSaved: localResult?.imagesSaved || 0,
    transcriptCount: payload.transcriptCount || 0,
    gdriveSynced: !!gdriveResult?.success,
    gdriveError: gdriveResult?.skipped ? null : (gdriveResult?.error || null)
  });

  if (items.length > 500) {
    items = items.slice(0, 500);
  }

  await chrome.storage.local.set({ learnflow_vault_items: items });
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FETCH_FIGURE_IMAGE') {
    (async () => {
      try {
        const url = new URL(message.url);
        if (!sender.tab || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid image request');
        const response = await fetch(url.href, {credentials: 'include', signal: AbortSignal.timeout(10000)});
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!response.ok || !mime.startsWith('image/')) throw new Error('Image download failed');
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        sendResponse({dataUrl: `data:${mime};base64,${btoa(binary)}`});
      } catch (error) { sendResponse({error: error.message}); }
    })();
    return true;
  }

  if (message.action === 'ARCHIVE_PAGE') {
    (async () => {
      try {
        const payload = message.payload;
        const localResult = await saveToLocalDisk(payload);
        const gdriveResult = await GDriveSync.upload(payload);
        await recordArchivedItem(payload, localResult, gdriveResult);

        sendResponse({
          success: localResult.success,
          local: localResult,
          gdrive: gdriveResult,
          error: localResult.error || null
        });
      } catch (err) {
        console.error('[LearnFlow] Archival failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'LOG_PAGE_VISIT') {
    logPageVisit(message.payload);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'SHOW_IN_FOLDER') {
    if (message.downloadId) {
      chrome.downloads.show(message.downloadId);
    } else {
      chrome.downloads.showDefaultFolder();
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'OPEN_DOWNLOAD') {
    if (message.downloadId) {
      chrome.downloads.open(message.downloadId);
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'OPEN_SIDEPANEL') {
    (async () => {
      try {
        const windowId = sender.tab?.windowId || (await chrome.windows.getLastFocused())?.id;
        if (!windowId) throw new Error('No active browser window found.');
        await chrome.sidePanel.open({ windowId });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'PLAYLIST_ADVANCE' || message.action === 'RESUME_READING') {
    const task = message.action === 'PLAYLIST_ADVANCE' ? advancePlaylist() : startReadingUrl(message.url, message.passage);
    task.then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
