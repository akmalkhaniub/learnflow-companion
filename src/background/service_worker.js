/**
 * service_worker.js - Background coordinator for LearnFlow & Ask Gemini Companion
 * Handles clean local disk downloads (Markdown + separate images/ folder),
 * Google Drive sync, Multi-Tab Queue Playlist, Omnibox, and Shortcuts.
 */

import { GDriveSync } from '../utils/gdrive.js';

// Configure side panel to open on toolbar icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[LearnFlow] Side panel config error:', error));

// Register Context Menus on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
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

  if (info.menuItemId === 'lf-read-selection') {
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
      siteType: 'generic',
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

function sanitize(name, maxLen = 70) {
  return (name || 'General')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .substring(0, maxLen)
    .trim() || 'Document';
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
 * Example:
 *   Downloads/LearnFlow_Vault/OReilly/AI Agents in Action/4 Architecting multi-agent systems.md
 *   Downloads/LearnFlow_Vault/OReilly/AI Agents in Action/images/4_architecting_fig_1.png
 */
async function saveToLocalDisk(payload) {
  const settings = await chrome.storage.local.get(['obsidian_vault_folder']);
  const rawBase = (settings.obsidian_vault_folder || 'LearnFlow_Vault').replace(/^\/+|\/+$/g, '');
  const baseFolder = rawBase.split('/').map(p => sanitize(p, 50)).join('/');

  const category = sanitize(payload.category || 'General', 40);
  const book = sanitize(payload.bookTitle || 'Tutorials', 65);
  const chapter = sanitize(payload.chapterTitle || payload.title || 'Note', 65);

  const folderPrefix = `${baseFolder}/${category}/${book}`;
  const mdFilename = `${folderPrefix}/${chapter}.md`;

  // 1. Save clean UTF-8 Markdown file (zero base64 gibberish!)
  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(payload.markdown || '');
  const mdResult = await downloadFile(mdDataUrl, mdFilename);

  // 2. Save extracted figure/diagram images into images/ subfolder
  const savedImages = [];
  if (Array.isArray(payload.images) && payload.images.length > 0) {
    for (const img of payload.images) {
      if (!img?.dataUrl || !img?.filename) continue;
      const safeImgName = sanitize(img.filename, 60);
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
async function advancePlaylist() {
  const data = await chrome.storage.local.get(['learnflow_playlist']);
  let playlist = data.learnflow_playlist || [];

  if (!playlist.length) return;

  const nextItem = playlist.shift();
  await chrome.storage.local.set({
    learnflow_playlist: playlist,
    learnflow_auto_play_next: true
  });

  const tabs = await chrome.tabs.query({ url: nextItem.url });
  if (tabs.length > 0) {
    const targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
    chrome.tabs.sendMessage(targetTab.id, { action: 'AUTO_START_READING' });
  } else {
    await chrome.tabs.create({ url: nextItem.url, active: true });
  }
}

/**
 * Log page visit into history
 */
async function logPageVisit(payload) {
  const data = await chrome.storage.local.get(['learnflow_history']);
  let history = data.learnflow_history || [];

  if (!payload.url || payload.url.startsWith('chrome://') || payload.url.includes('google.com/search')) {
    return;
  }

  history = history.filter(item => item.url !== payload.url);
  history.unshift({
    title: payload.title || 'Untitled',
    url: payload.url,
    siteType: payload.siteType || 'generic',
    timestamp: payload.timestamp || Date.now()
  });

  if (history.length > 1000) {
    history = history.slice(0, 1000);
  }

  await chrome.storage.local.set({ learnflow_history: history });
}

/**
 * Save item into vault index
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
    localFile: localResult?.filename || null,
    imagesSaved: localResult?.imagesSaved || 0,
    gdriveSynced: !!gdriveResult?.success
  });

  if (items.length > 500) {
    items = items.slice(0, 500);
  }

  await chrome.storage.local.set({ learnflow_vault_items: items });
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ARCHIVE_PAGE') {
    (async () => {
      try {
        const payload = message.payload;
        const localResult = await saveToLocalDisk(payload);
        const gdriveResult = await GDriveSync.upload(payload);
        await recordArchivedItem(payload, localResult, gdriveResult);

        sendResponse({
          success: true,
          local: localResult,
          gdrive: gdriveResult
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

  if (message.action === 'PLAYLIST_ADVANCE') {
    advancePlaylist();
    sendResponse({ success: true });
    return false;
  }
});
