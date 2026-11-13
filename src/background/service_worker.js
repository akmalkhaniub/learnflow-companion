/**
 * service_worker.js - Background coordinator for LearnFlow & Ask Gemini Companion
 * Handles file downloads to local disk, Google Drive sync, Omnibox, Context Menus, and Shortcuts.
 */

import { GDriveSync } from '../utils/gdrive.js';

// Configure side panel to open on toolbar icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[LearnFlow] Side panel config error:', error));

// Register Context Menus on install
chrome.runtime.onInstalled.addListener(() => {
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
    // Open side panel and query Gemini
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
  }
});

// Omnibox Support: Type "lf <query>" in Chrome address bar
chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
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

// Sanitize string for folder / file paths
function sanitize(name) {
  return (name || 'General').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80).trim();
}

/**
 * Save Markdown document directly to local disk in a structured folder
 */
async function saveToLocalDisk(payload) {
  const category = sanitize(payload.category || 'General');
  const book = sanitize(payload.bookTitle || 'Tutorials');
  const chapter = sanitize(payload.chapterTitle || payload.title || 'Note');

  const filename = `LearnFlow_Vault/${category}/${book}/${chapter}.md`;

  const blob = new Blob([payload.markdown], { type: 'text/markdown;charset=utf-8' });
  const reader = new FileReader();

  return new Promise((resolve) => {
    reader.onloadend = () => {
      const dataUrl = reader.result;
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false,
        conflictAction: 'overwrite'
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn('[LearnFlow] Download error:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[LearnFlow] Saved to local vault file:', filename, 'ID:', downloadId);
          resolve({ success: true, downloadId, filename });
        }
      });
    };
    reader.readAsDataURL(blob);
  });
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
    gdriveSynced: !!gdriveResult?.success
  });

  if (items.length > 500) {
    items = items.slice(0, 500);
  }

  await chrome.storage.local.set({ learnflow_vault_items: items });
}

// Handle runtime messages from content script & sidepanel
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
});
