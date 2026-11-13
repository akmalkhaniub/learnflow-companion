/**
 * sidepanel.js - Interactive Side Panel controller for LearnFlow & Ask Gemini
 * Manages Gemini Q&A, Audio Briefs, Vault items, Auto-Tracked history, and Settings.
 */

let currentTabInfo = null;
let lastGeminiResponse = '';

document.addEventListener('DOMContentLoaded', async () => {
  // Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');

      if (target === 'vault') loadVaultItems();
      if (target === 'history') loadHistoryItems();
    });
  });

  // Detect Active Browser Tab
  await detectActiveTab();

  // Initialize Gemini Tab
  initGeminiTab();

  // Load Vault, History, and Settings
  await loadVaultItems();
  await loadHistoryItems();
  await initSettings();

  // Search & Filter listeners
  document.getElementById('vault-search')?.addEventListener('input', filterVaultItems);
  document.getElementById('vault-filter')?.addEventListener('change', filterVaultItems);
  document.getElementById('history-search')?.addEventListener('input', filterHistoryItems);
  document.getElementById('btn-clear-history')?.addEventListener('click', clearHistory);

  // Check for pending omnibox query or context menu action
  checkPendingQuery();

  // Real-time storage change listener
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.learnflow_vault_items) loadVaultItems();
    if (changes.learnflow_history) loadHistoryItems();
    if (changes.learnflow_pending_query) checkPendingQuery();
  });
});

/**
 * Detect what page user is currently viewing in Chrome
 */
async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabInfo = tab;
      const banner = document.getElementById('active-tab-title');
      if (banner) {
        banner.textContent = tab.title || tab.url;
        banner.title = tab.url;
      }
    }
  } catch (e) {
    console.warn('[LearnFlow] Active tab detect error:', e);
  }
}

/**
 * Handle Ask Gemini Tab
 */
function initGeminiTab() {
  const queryInput = document.getElementById('gemini-user-prompt');
  const sendBtn = document.getElementById('btn-send-gemini-query');
  const responseBox = document.getElementById('gemini-response-box');
  const actionBar = document.getElementById('gemini-action-bar');
  const speakBtn = document.getElementById('btn-speak-gemini-response');
  const saveBtn = document.getElementById('btn-save-gemini-to-vault');

  // Quick Action Chips
  document.getElementById('chip-audio-brief')?.addEventListener('click', () => {
    executeGeminiQuery('Generate a 2-minute executive spoken audio brief of this page covering the main problem and core concepts.');
  });

  document.getElementById('chip-takeaways')?.addEventListener('click', () => {
    executeGeminiQuery('Provide a structured cheat sheet of the 5 most critical technical takeaways from this content.');
  });

  document.getElementById('chip-explain-code')?.addEventListener('click', () => {
    executeGeminiQuery('Find the key code blocks or technical procedures on this page and explain what they do in simple, clear spoken language.');
  });

  // Query Submit
  sendBtn?.addEventListener('click', () => {
    const text = queryInput.value.trim();
    if (text) {
      executeGeminiQuery(text);
      queryInput.value = '';
    }
  });

  queryInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = queryInput.value.trim();
      if (text) {
        executeGeminiQuery(text);
        queryInput.value = '';
      }
    }
  });

  // Speak Response with Native TTS
  speakBtn?.addEventListener('click', () => {
    if (!lastGeminiResponse) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(lastGeminiResponse);
    window.speechSynthesis.speak(utter);
  });

  // Save Gemini Response into Vault
  saveBtn?.addEventListener('click', async () => {
    if (!lastGeminiResponse || !currentTabInfo) return;
    const title = `Gemini Notes - ${currentTabInfo.title || 'Summary'}`;
    const md = `# ✨ Gemini Study Notes: ${currentTabInfo.title}\n\n` +
      `**Source:** [${currentTabInfo.url}](${currentTabInfo.url})\n` +
      `**Generated:** ${new Date().toLocaleString()}\n\n---\n\n` +
      lastGeminiResponse;

    chrome.runtime.sendMessage({
      action: 'ARCHIVE_PAGE',
      payload: {
        title,
        category: 'GeminiNotes',
        bookTitle: 'AI Summaries',
        chapterTitle: currentTabInfo.title,
        url: currentTabInfo.url,
        markdown: md
      }
    }, () => {
      alert('✓ Saved Gemini summary to Local Vault & Google Drive!');
    });
  });
}

/**
 * Execute query to Gemini with active tab context
 */
async function executeGeminiQuery(prompt) {
  const responseBox = document.getElementById('gemini-response-box');
  const actionBar = document.getElementById('gemini-action-bar');
  if (!responseBox) return;

  responseBox.innerHTML = `<em>✨ Asking Gemini... Thinking...</em>`;
  if (actionBar) actionBar.style.display = 'none';

  try {
    // Attempt to extract page text from active tab
    let pageContext = '';
    if (currentTabInfo?.id) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: currentTabInfo.id },
          func: () => document.body.innerText.substring(0, 25000)
        });
        if (result && result.result) {
          pageContext = result.result;
        }
      } catch (err) {
        console.log('[LearnFlow] Script injection skipped for context:', err);
      }
    }

    const answer = await GeminiAI.query(prompt, pageContext);
    lastGeminiResponse = answer;
    responseBox.textContent = answer;
    if (actionBar) actionBar.style.display = 'flex';
  } catch (e) {
    responseBox.innerHTML = `<span style="color: #f87171;">Error: ${escapeHtml(e.message)}</span>`;
  }
}

/**
 * Check if an omnibox or context-menu query is pending
 */
async function checkPendingQuery() {
  const data = await chrome.storage.local.get(['learnflow_pending_query']);
  if (data.learnflow_pending_query) {
    const { prompt } = data.learnflow_pending_query;
    await chrome.storage.local.remove(['learnflow_pending_query']);

    // Switch to Gemini tab
    document.querySelector('.tab-btn[data-tab="gemini"]')?.click();
    executeGeminiQuery(prompt);
  }
}

let cachedVaultItems = [];
let cachedHistoryItems = [];

/**
 * Load and render saved Vault items
 */
async function loadVaultItems() {
  const data = await chrome.storage.local.get(['learnflow_vault_items']);
  cachedVaultItems = data.learnflow_vault_items || [];

  const countBadge = document.getElementById('vault-count');
  if (countBadge) countBadge.textContent = cachedVaultItems.length;

  renderVaultList(cachedVaultItems);
}

function renderVaultList(items) {
  const container = document.getElementById('vault-items-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No archived content yet.</p>
        <span>Open O'Reilly, Google Skills, or YouTube and click 💾 Archive on the floating bar!</span>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item-card">
      <span class="item-badge">${escapeHtml(item.category || 'NOTE')}</span>
      <a href="${escapeHtml(item.url)}" target="_blank" class="item-title">${escapeHtml(item.title)}</a>
      <div class="item-meta">
        <span>💾 Local: ${escapeHtml(item.localFile ? item.localFile.split('/').pop() : 'Saved')}</span>
        <span>${item.gdriveSynced ? '☁️ Drive' : '🕒 Pending'} • ${new Date(item.timestamp).toLocaleDateString()}</span>
      </div>
    </div>
  `).join('');
}

function filterVaultItems() {
  const query = (document.getElementById('vault-search')?.value || '').toLowerCase();
  const filter = document.getElementById('vault-filter')?.value || 'all';

  const filtered = cachedVaultItems.filter(item => {
    const matchesQuery = item.title.toLowerCase().includes(query) ||
                         (item.bookTitle && item.bookTitle.toLowerCase().includes(query));
    const matchesCategory = filter === 'all' || item.category === filter;
    return matchesQuery && matchesCategory;
  });

  renderVaultList(filtered);
}

/**
 * Load and render auto-tracked history
 */
async function loadHistoryItems() {
  const data = await chrome.storage.local.get(['learnflow_history']);
  cachedHistoryItems = data.learnflow_history || [];

  const countBadge = document.getElementById('history-count');
  if (countBadge) countBadge.textContent = cachedHistoryItems.length;

  renderHistoryList(cachedHistoryItems);
}

function renderHistoryList(items) {
  const container = document.getElementById('history-items-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No history logged yet.</p>
        <span>Pages and tutorials you visit will automatically appear here.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item-card">
      <span class="item-badge">${escapeHtml(item.siteType || 'WEB')}</span>
      <a href="${escapeHtml(item.url)}" target="_blank" class="item-title">${escapeHtml(item.title)}</a>
      <div class="item-meta">
        <span>${new URL(item.url).hostname}</span>
        <span>${formatTimeAgo(item.timestamp)}</span>
      </div>
    </div>
  `).join('');
}

function filterHistoryItems() {
  const query = (document.getElementById('history-search')?.value || '').toLowerCase();
  const filtered = cachedHistoryItems.filter(item => {
    return item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query);
  });
  renderHistoryList(filtered);
}

async function clearHistory() {
  if (confirm('Clear your tracked learning history?')) {
    await chrome.storage.local.set({ learnflow_history: [] });
    loadHistoryItems();
  }
}

/**
 * Settings tab logic
 */
async function initSettings() {
  const data = await chrome.storage.local.get([
    'gdrive_webhook_url',
    'learnflow_preferred_rate',
    'learnflow_nav_delay',
    'learnflow_preferred_voice',
    'gemini_api_key'
  ]);

  // Gemini Settings
  const geminiInput = document.getElementById('setting-gemini-key');
  if (geminiInput && data.gemini_api_key) {
    geminiInput.value = data.gemini_api_key;
  }

  document.getElementById('btn-save-gemini-key')?.addEventListener('click', async () => {
    const key = geminiInput.value.trim();
    await chrome.storage.local.set({ gemini_api_key: key });
    showSettingsMsg('Gemini API Key saved!');
  });

  // Check Nano availability
  const nanoStatus = document.getElementById('nano-status-label');
  const nanoAvailable = await GeminiAI.checkNanoAvailability();
  if (nanoStatus) {
    nanoStatus.textContent = nanoAvailable
      ? '✓ Chrome Built-in Gemini Nano detected and ready!'
      : 'ℹ️ On-device Gemini Nano not active (Enter free API key above for Gemini 2.0 Flash).';
  }

  // Webhook
  const webhookInput = document.getElementById('setting-gdrive-webhook');
  if (webhookInput && data.gdrive_webhook_url) {
    webhookInput.value = data.gdrive_webhook_url;
  }

  document.getElementById('btn-save-gdrive-settings')?.addEventListener('click', async () => {
    const url = webhookInput.value.trim();
    await chrome.storage.local.set({ gdrive_webhook_url: url });
    showSettingsMsg('Google Drive settings saved!');
  });

  // Copy Google Apps Script template
  document.getElementById('btn-copy-script-code')?.addEventListener('click', () => {
    const scriptCode = `// Google Apps Script to auto-save LearnFlow notes to Google Drive
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var rootFolder = getOrCreateFolder("LearnFlow Vault");
    var categoryFolder = getOrCreateFolder(data.category || "General", rootFolder);
    var targetFolder = data.bookTitle ? getOrCreateFolder(data.bookTitle, categoryFolder) : categoryFolder;
    
    var fileName = (data.chapterTitle || data.title) + ".md";
    targetFolder.createFile(fileName, data.content, MimeType.PLAIN_TEXT);
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateFolder(name, parent) {
  var iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}`;

    navigator.clipboard.writeText(scriptCode);
    showSettingsMsg('Google Apps Script copied to clipboard!');
  });

  // Voice Selection
  const voiceSelect = document.getElementById('setting-voice-select');
  const populateVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length || !voiceSelect) return;

    voiceSelect.innerHTML = voices.map(v => 
      `<option value="${escapeHtml(v.name)}" ${v.name === data.learnflow_preferred_voice ? 'selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`
    ).join('');
  };

  window.speechSynthesis.onvoiceschanged = populateVoices;
  populateVoices();

  voiceSelect?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ learnflow_preferred_voice: e.target.value });
  });

  // Speed Slider
  const speedSlider = document.getElementById('setting-speed-slider');
  const speedLabel = document.getElementById('speed-slider-label');
  if (speedSlider) {
    if (data.learnflow_preferred_rate) {
      speedSlider.value = data.learnflow_preferred_rate;
      speedLabel.textContent = `${data.learnflow_preferred_rate}x`;
    }
    speedSlider.addEventListener('input', async (e) => {
      const val = parseFloat(e.target.value);
      speedLabel.textContent = `${val.toFixed(1)}x`;
      await chrome.storage.local.set({ learnflow_preferred_rate: val });
    });
  }

  // Delay
  const delayInput = document.getElementById('setting-nav-delay');
  if (delayInput) {
    if (data.learnflow_nav_delay) delayInput.value = data.learnflow_nav_delay;
    delayInput.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ learnflow_nav_delay: parseInt(e.target.value, 10) });
    });
  }

  // File System Access Picker
  document.getElementById('btn-pick-local-folder')?.addEventListener('click', async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker();
        document.getElementById('custom-folder-label').textContent = `Target: ${handle.name} (Direct Access)`;
        showSettingsMsg(`Connected to local folder: ${handle.name}`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[LearnFlow]', err);
        }
      }
    } else {
      alert('Your browser saves automatically to Downloads/LearnFlow_Vault/');
    }
  });

  // Export functions
  document.getElementById('btn-export-history')?.addEventListener('click', () => {
    exportJson(cachedHistoryItems, 'learnflow_history.json');
  });

  document.getElementById('btn-export-vault')?.addEventListener('click', () => {
    exportJson(cachedVaultItems, 'learnflow_vault.json');
  });
}

function showSettingsMsg(msg) {
  const el = document.getElementById('gdrive-status-msg');
  if (el) {
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3500);
  }
}

function exportJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diffSecs = Math.floor((Date.now() - ts) / 1000);
  if (diffSecs < 60) return 'Just now';
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
