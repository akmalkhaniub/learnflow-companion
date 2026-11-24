/**
 * sidepanel.js - Interactive Side Panel controller for LearnFlow & Ask Gemini
 * Supports Light/Dark Theme toggle, Gemini Q&A, Multi-Tab Queue, Vault with Show-in-Folder,
 * exact-URL History tracking, Anki CSV export, and Settings.
 */

let currentTabInfo = null;
let lastGeminiResponse = '';
let cachedPlaylist = [];
let cachedVaultItems = [];
let cachedHistoryItems = [];

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('app-version').textContent = `v${chrome.runtime.getManifest().version}`;
  // 1. Initialize Light/Dark Theme (Defaults to Light Mode)
  await initTheme();

  // Toggle Player Bar on active tab
  const togglePlayerBtn = document.getElementById('btn-toggle-page-player');
  togglePlayerBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_PLAYER' }, (resp) => {
        if (chrome.runtime.lastError) {
          alert('Refresh this tab once to use the LearnFlow reader here.');
        } else if (resp && typeof resp.visible === 'boolean') {
          togglePlayerBtn.textContent = resp.visible ? '✕ Hide Reader' : '▶ Read Page';
        }
      });
    }
  });

  // 2. Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');

      if (target === 'playlist') loadPlaylist();
      if (target === 'vault') loadVaultItems();
      if (target === 'history') loadHistoryItems();
    });
  });

  // 3. Detect Active Browser Tab & Keep It Live
  await detectActiveTab();
  chrome.tabs.onActivated?.addListener(detectActiveTab);
  chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.status === 'complete') {
      detectActiveTab();
    }
  });

  // 4. Initialize Feature Tabs
  initGeminiTab();
  initPlaylistTab();
  initHome();

  // 5. Load Initial Data
  await loadPlaylist();
  await loadVaultItems();
  await loadHistoryItems();
  await initSettings();

  // 6. Search, Filter & Folder Listeners
  document.getElementById('vault-search')?.addEventListener('input', filterVaultItems);
  document.getElementById('vault-filter')?.addEventListener('change', filterVaultItems);
  document.getElementById('btn-open-downloads-folder')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'SHOW_IN_FOLDER', downloadId: null });
  });
  document.getElementById('history-search')?.addEventListener('input', filterHistoryItems);
  document.getElementById('btn-clear-history')?.addEventListener('click', clearHistory);

  // 7. Check for pending omnibox query or context menu action
  checkPendingQuery();

  // 8. Real-time storage change listener
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.learnflow_vault_items) loadVaultItems();
    if (changes.learnflow_history) loadHistoryItems();
    if (changes.learnflow_playlist) loadPlaylist();
    if (changes.learnflow_pending_query) checkPendingQuery();
    if (changes.learnflow_play_progress || changes.learnflow_playlist) renderHome();
    if (changes.learnflow_theme) applyTheme(changes.learnflow_theme.newValue || 'light');
  });
});

/**
 * Light / Dark Theme Switcher (Default: Light Mode)
 */
async function initTheme() {
  const data = await chrome.storage.local.get(['learnflow_theme']);
  const theme = data.learnflow_theme || 'light';
  applyTheme(theme);

  document.getElementById('btn-theme-toggle')?.addEventListener('click', async () => {
    const isDark = document.body.classList.contains('dark-theme');
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme);
    await chrome.storage.local.set({ learnflow_theme: nextTheme });
  });
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-theme', isDark);
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
    toggleBtn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }
}

/**
 * Detect what page user is currently viewing in Chrome
 */
async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabInfo = tab;
      renderHome();
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
async function updateRouteBadge() {
  const badge = document.getElementById('gemini-route-badge');
  if (!badge) return;
  try {
    const data = await chrome.storage.local.get(['learnflow_ai_provider', 'learnflow_last_ai_meta']);
    const provider = data.learnflow_ai_provider || 'firebase_ai_logic';
    const meta = data.learnflow_last_ai_meta;
    if (meta && meta.provider === provider) {
      const icon = meta.route === 'on-device' ? '⚡ On-Device' : '☁️ Cloud';
      const ms = meta.latencyMs ? ` · ${meta.latencyMs}ms` : '';
      badge.textContent = `${icon} (${meta.model || 'AI'})${ms}`;
      badge.title = `Active provider: ${provider}`;
    } else {
      badge.textContent = provider === 'firebase_ai_logic' ? '🔥 Firebase AI Logic' : '✨ Direct Gemini';
    }
  } catch {}
}

async function initGeminiTab() {
  const setupBanner = document.getElementById('gemini-setup-banner');
  const inlineKeyInput = document.getElementById('inline-gemini-key');
  const inlineSaveBtn = document.getElementById('btn-inline-save-gemini');

  const refreshSetupBanner = async () => {
    const status = await AIRouter.isAvailable();
    if (setupBanner) {
      setupBanner.style.display = status.available ? 'none' : 'block';
    }
    await updateRouteBadge();
  };
  await refreshSetupBanner();

  inlineSaveBtn?.addEventListener('click', async () => {
    const key = (inlineKeyInput?.value || '').trim();
    if (!key) return;
    await chrome.storage.local.set({ gemini_api_key: key, learnflow_ai_provider: 'direct_gemini' });
    const providerSelect = document.getElementById('setting-ai-provider');
    if (providerSelect) providerSelect.value = 'direct_gemini';
    const settingsInput = document.getElementById('setting-gemini-key');
    if (settingsInput) settingsInput.value = key;
    await refreshSetupBanner();
    const responseBox = document.getElementById('gemini-response-box');
    if (responseBox) responseBox.innerHTML = '<span style="color: var(--success); font-weight: 600;">✓ Gemini AI enabled! Click any chip above or ask a question below.</span>';
  });
  const queryInput = document.getElementById('gemini-user-prompt');
  const sendBtn = document.getElementById('btn-send-gemini-query');
  const responseBox = document.getElementById('gemini-response-box');
  const actionBar = document.getElementById('gemini-action-bar');
  const speakBtn = document.getElementById('btn-speak-gemini-response');
  const saveBtn = document.getElementById('btn-save-gemini-to-vault');
  const exportAnkiBtn = document.getElementById('btn-export-anki-csv');

  document.getElementById('chip-audio-brief')?.addEventListener('click', () => {
    executeGeminiQuery('Generate a 2-minute executive spoken audio brief of this page covering the main problem and core concepts.');
  });

  document.getElementById('chip-takeaways')?.addEventListener('click', () => {
    executeGeminiQuery('Provide a structured cheat sheet of the 5 most critical technical takeaways from this content.');
  });

  document.getElementById('chip-explain-code')?.addEventListener('click', () => {
    executeGeminiQuery('Find the key code blocks or technical procedures on this page and explain what they do in simple, clear spoken language.');
  });

  document.getElementById('chip-anki-cards')?.addEventListener('click', async () => {
    if (exportAnkiBtn) exportAnkiBtn.style.display = 'inline-block';
    executeGeminiQuery('Generate 5 high-yield active-recall Anki flashcards from this content formatted as Q: and A:');
  });

  document.getElementById('chip-search-vault')?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['learnflow_vault_items']);
    const items = data.learnflow_vault_items || [];
    responseBox.innerHTML = `<em>🔍 Searching across ${items.length} saved vault items with AI...</em>`;
    const ans = await AIRouter.searchVault(items, queryInput.value.trim() || 'Summarize the technical topics I have been studying recently');
    lastGeminiResponse = ans;
    responseBox.textContent = ans;
    await updateRouteBadge();
    if (actionBar) actionBar.style.display = 'flex';
  });

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

  speakBtn?.addEventListener('click', () => {
    if (!lastGeminiResponse) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(lastGeminiResponse);
    window.speechSynthesis.speak(utter);
  });

  exportAnkiBtn?.addEventListener('click', () => {
    if (!lastGeminiResponse) return;
    const cards = [];
    const lines = lastGeminiResponse.split('\n');
    let q = '', a = '';
    for (const line of lines) {
      if (line.startsWith('Q:') || line.startsWith('**Q:')) {
        q = line.replace(/^\*?\*?Q:\*?\*?\s*/i, '').trim();
      } else if (line.startsWith('A:') || line.startsWith('**A:')) {
        a = line.replace(/^\*?\*?A:\*?\*?\s*/i, '').trim();
        if (q && a) {
          cards.push(`"${q.replace(/"/g, '""')}","${a.replace(/"/g, '""')}"`);
          q = ''; a = '';
        }
      }
    }

    if (!cards.length) {
      alert('Could not parse Q&A format. Try clicking "Make Anki Cards" first.');
      return;
    }

    const csvContent = cards.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anki_flashcards_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

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
        markdown: md,
        images: []
      }
    }, (result) => {
      const error = chrome.runtime.lastError;
      alert(error ? error.message : !result?.success ? (result?.error || 'Save failed') : result.gdrive?.success ? 'Saved locally and to Google Drive.' : result.gdrive?.error ? 'Saved locally. Drive sync failed: ' + result.gdrive.error : 'Saved locally.');
    });
  });
}

/**
 * Multi-Tab Playlist Queue Logic
 */
function initPlaylistTab() {
  document.getElementById('btn-play-queue-now')?.addEventListener('click', async () => {
    if (!cachedPlaylist.length) {
      alert('Your playlist queue is empty. Add pages with ➕ Queue on the floating bar!');
      return;
    }
    chrome.runtime.sendMessage({ action: 'PLAYLIST_ADVANCE' }).then(result => {
      if (!result?.success) alert(result?.error || 'Could not start queue');
    }).catch(error => alert(error.message));
  });

  document.getElementById('btn-clear-playlist')?.addEventListener('click', async () => {
    if (confirm('Clear your playlist queue?')) {
      await chrome.storage.local.set({ learnflow_playlist: [] });
      loadPlaylist();
    }
  });
}

async function loadPlaylist() {
  const data = await chrome.storage.local.get(['learnflow_playlist']);
  cachedPlaylist = data.learnflow_playlist || [];

  const countEl = document.getElementById('playlist-count');
  if (countEl) countEl.textContent = cachedPlaylist.length;

  const container = document.getElementById('playlist-items-list');
  if (!container) return;

  if (!cachedPlaylist.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Your Playlist Queue is empty.</p>
        <span>Click ➕ Queue on the player bar to line up chapters, tutorials, and YouTube videos!</span>
      </div>
    `;
    return;
  }

  container.innerHTML = cachedPlaylist.map((item, idx) => `
    <div class="item-card" style="display: flex; justify-content: space-between; align-items: center;">
      <div style="flex: 1; min-width: 0; padding-right: 8px;">
        <span class="item-badge">#${idx + 1} ${escapeHtml(item.siteType || 'QUEUE')}</span>
        <a href="${escapeHtml(item.url)}" target="_blank" class="item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title)}</a>
      </div>
      <button class="tiny-del-btn btn-remove-queue-item" data-index="${idx}" title="Remove item">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      cachedPlaylist.splice(idx, 1);
      await chrome.storage.local.set({ learnflow_playlist: cachedPlaylist });
      loadPlaylist();
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

    const answer = await AIRouter.query(prompt, pageContext);
    lastGeminiResponse = answer;
    responseBox.textContent = answer;
    await updateRouteBadge();
    if (actionBar) actionBar.style.display = 'flex';
  } catch (e) {
    responseBox.innerHTML = `<span style="color: #dc2626;">Error: ${escapeHtml(e.message)}</span>`;
  }
}

async function checkPendingQuery() {
  const data = await chrome.storage.local.get(['learnflow_pending_query']);
  if (data.learnflow_pending_query) {
    const { prompt } = data.learnflow_pending_query;
    await chrome.storage.local.remove(['learnflow_pending_query']);

    document.querySelector('.tab-btn[data-tab="gemini"]')?.click();
    executeGeminiQuery(prompt);
  }
}

/**
 * Vault Items (with Exact Local Path + Show-in-Folder & Open File buttons!)
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
        <span>Open O'Reilly, Google Skills, or YouTube and click 💾 Archive (or 📸 on YouTube)!</span>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const details = [];
    if (item.transcriptCount > 0) details.push(`📝 ${item.transcriptCount} cues`);
    if (item.imagesSaved > 0) details.push(`🖼️ ${item.imagesSaved} img`);
    details.push(item.gdriveSynced ? '☁️ Drive synced' : item.gdriveError ? '⚠ Drive sync failed' : '💾 Local');

    const localDisplay = item.localFile ? `Downloads/${item.localFile}` : 'Downloads/LearnFlow_Vault/';

    return `
      <div class="item-card">
        <div class="item-card-top">
          <span class="item-badge">${escapeHtml(item.category || 'NOTE')}</span>
          <span style="font-size: 10.5px; color: var(--text-muted);">${new Date(item.timestamp).toLocaleString()}</span>
        </div>
        <a href="${escapeHtml(item.url)}" target="_blank" class="item-title">${escapeHtml(item.title)}</a>
        <div class="vault-path-pill" title="${escapeHtml(localDisplay)}">📁 ${escapeHtml(localDisplay)}</div>
        <p class="sync-error">${escapeHtml(item.gdriveError || "")}</p>
        <div class="item-meta">
          <span>${details.join(' • ')}</span>
          <div class="vault-card-actions">
            <button class="mini-btn btn-show-folder" data-download-id="${item.downloadId || ''}" title="Highlight file in Windows Explorer">📂 Show in Folder</button>
            ${item.downloadId ? `<button class="mini-btn btn-open-file" data-download-id="${item.downloadId}" title="Open Markdown file">📄 Open</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-show-folder').forEach(btn => {
    btn.addEventListener('click', () => {
      const dlId = parseInt(btn.dataset.downloadId, 10) || null;
      chrome.runtime.sendMessage({ action: 'SHOW_IN_FOLDER', downloadId: dlId });
    });
  });

  container.querySelectorAll('.btn-open-file').forEach(btn => {
    btn.addEventListener('click', () => {
      const dlId = parseInt(btn.dataset.downloadId, 10) || null;
      if (dlId) chrome.runtime.sendMessage({ action: 'OPEN_DOWNLOAD', downloadId: dlId });
    });
  });
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
 * Exact-URL Auto-Tracked History
 */
async function loadHistoryItems() {
  const data = await chrome.storage.local.get(['learnflow_history']);
  cachedHistoryItems = data.learnflow_history || [];

  const countBadge = document.getElementById('history-count');
  if (countBadge) countBadge.textContent = cachedHistoryItems.length;

  renderHistoryList(cachedHistoryItems);
}

function formatReadableUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '');
    const pathAndQuery = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return `${host}${pathAndQuery}`;
  } catch {
    return urlStr;
  }
}

function renderHistoryList(items) {
  const container = document.getElementById('history-items-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No history logged yet.</p>
        <span>Exact videos, book chapters, and tutorials you visit appear here automatically.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, idx) => `
    <div class="item-card">
      <div class="item-card-top">
        <span class="item-badge">${escapeHtml(item.siteType || 'WEB')}</span>
        <button class="tiny-del-btn btn-del-history" data-url="${escapeHtml(item.url)}" title="Remove from history">✕</button>
      </div>
      <a href="${escapeHtml(item.url)}" target="_blank" class="item-title">${escapeHtml(item.title)}</a>
      <div class="item-url-preview" title="${escapeHtml(item.url)}">🔗 ${escapeHtml(formatReadableUrl(item.url))}</div>
      <div class="item-meta">
        <span>${formatTimeAgo(item.timestamp)}</span>
        <a href="${escapeHtml(item.url)}" target="_blank" class="accent-link" style="font-size: 11px; font-weight: 500;">Open exact link ↗</a>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-history').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetUrl = btn.dataset.url;
      const updated = cachedHistoryItems.filter(h => h.url !== targetUrl);
      await chrome.storage.local.set({ learnflow_history: updated });
      loadHistoryItems();
    });
  });
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
    'learnflow_ai_provider',
    'learnflow_firebase_config',
    'learnflow_appcheck_debug_token',
    'learnflow_firebase_mode',
    'learnflow_firebase_model',
    'gemini_api_key', 'gemini_model',
    'obsidian_vault_folder'
  ]);

  const obsidianInput = document.getElementById('setting-obsidian-folder');
  if (obsidianInput && data.obsidian_vault_folder) {
    obsidianInput.value = data.obsidian_vault_folder;
  }

  document.getElementById('btn-save-obsidian-folder')?.addEventListener('click', async () => {
    const val = obsidianInput.value.trim() || 'LearnFlow_Vault';
    await chrome.storage.local.set({ obsidian_vault_folder: val });
    showSettingsMsg(`Obsidian/Local folder set to: Downloads/${val}`);
  });

  // AI Provider Switcher (Firebase AI Logic vs Direct Gemini vs future providers)
  const providerSelect = document.getElementById('setting-ai-provider');
  const firebasePanel = document.getElementById('firebase-settings-panel');
  const directPanel = document.getElementById('direct-gemini-settings-panel');
  const toggleProviderPanels = (providerId) => {
    const isFirebase = providerId === 'firebase_ai_logic';
    if (firebasePanel) firebasePanel.style.display = isFirebase ? 'block' : 'none';
    if (directPanel) directPanel.style.display = isFirebase ? 'none' : 'block';
  };

  const activeProvider = data.learnflow_ai_provider || 'firebase_ai_logic';
  if (providerSelect) {
    providerSelect.value = activeProvider;
    toggleProviderPanels(activeProvider);
    providerSelect.addEventListener('change', async () => {
      const next = providerSelect.value;
      await AIRouter.setActiveProviderId(next);
      toggleProviderPanels(next);
      await updateRouteBadge();
      showSettingsMsg(`Switched AI provider to: ${next === 'firebase_ai_logic' ? 'Firebase AI Logic (Hybrid)' : 'Direct Gemini'}`);
    });
  }

  const fbConfigInput = document.getElementById('setting-firebase-config');
  const fbTokenInput = document.getElementById('setting-appcheck-token');
  const fbModeSelect = document.getElementById('setting-firebase-mode');
  const fbModelInput = document.getElementById('setting-firebase-model');
  if (fbConfigInput && data.learnflow_firebase_config) {
    fbConfigInput.value = typeof data.learnflow_firebase_config === 'string'
      ? data.learnflow_firebase_config
      : JSON.stringify(data.learnflow_firebase_config, null, 2);
  }
  if (fbTokenInput && data.learnflow_appcheck_debug_token) {
    fbTokenInput.value = data.learnflow_appcheck_debug_token;
  }
  if (fbModeSelect) fbModeSelect.value = data.learnflow_firebase_mode || 'prefer_on_device';
  if (fbModelInput) fbModelInput.value = data.learnflow_firebase_model || 'gemini-2.5-flash-lite';

  document.getElementById('btn-save-firebase-config')?.addEventListener('click', async () => {
    const rawCfg = (fbConfigInput?.value || '').trim();
    if (!rawCfg) {
      showSettingsMsg('Paste your Firebase Web Config JSON first.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(rawCfg);
    } catch {
      showSettingsMsg('Invalid JSON in Firebase Web Config.');
      return;
    }
    if (!parsed.apiKey || !parsed.projectId || !parsed.appId) {
      showSettingsMsg('Firebase Config must include apiKey, projectId, and appId.');
      return;
    }
    await chrome.storage.local.set({
      learnflow_ai_provider: 'firebase_ai_logic',
      learnflow_firebase_config: parsed,
      learnflow_appcheck_debug_token: (fbTokenInput?.value || '').trim(),
      learnflow_firebase_mode: fbModeSelect?.value || 'prefer_on_device',
      learnflow_firebase_model: (fbModelInput?.value || 'gemini-2.5-flash-lite').trim()
    });
    await updateRouteBadge();
    showSettingsMsg('Firebase AI Logic + App Check settings saved.');
  });

  const modelInput = document.getElementById('setting-gemini-model');
  modelInput.value = data.gemini_model || 'gemini-3.5-flash-lite';
  const geminiInput = document.getElementById('setting-gemini-key');
  if (geminiInput && data.gemini_api_key) {
    geminiInput.value = data.gemini_api_key;
  }

  document.getElementById('btn-save-gemini-key')?.addEventListener('click', async () => {
    const key = geminiInput.value.trim();
    await chrome.storage.local.set({ gemini_api_key: key });
    await chrome.storage.local.set({gemini_model: modelInput.value.trim() || 'gemini-3.5-flash-lite'});
    await updateRouteBadge();
    showSettingsMsg('Gemini API key and model saved.');
  });

  document.getElementById('btn-test-gemini').addEventListener('click', async event => {
    const label = document.getElementById('gemini-test-status');
    event.target.disabled = true;
    label.textContent = 'Testing active AI provider…';
    try {
      const status = await AIRouter.isAvailable();
      if (!status.available) {
        throw new Error(
          status.provider === 'firebase_ai_logic'
            ? 'Save your Firebase Web Config + App Check token first.'
            : 'Save your Gemini API key first.'
        );
      }
      await AIRouter.query('Reply with OK.');
      await updateRouteBadge();
      const meta = (await chrome.storage.local.get(['learnflow_last_ai_meta'])).learnflow_last_ai_meta;
      const routeInfo = meta ? ` (${meta.route === 'on-device' ? 'On-Device Nano' : 'Cloud'} · ${meta.model})` : '';
      label.textContent = `AI connection works${routeInfo}. Figure explanations also require an accessible image.`;
    } catch (error) { label.textContent = error.message; }
    finally { event.target.disabled = false; }
  });

  const nanoStatus = document.getElementById('nano-status-label');
  const nanoAvailable = await GeminiAI.checkNanoAvailability();
  if (nanoStatus) {
    nanoStatus.textContent = nanoAvailable
      ? '✓ Chrome Built-in Gemini Nano detected and ready!'
      : 'ℹ️ On-device Gemini Nano not active (Enter free API key above for cloud AI + figure explanations).';
  }

  const webhookInput = document.getElementById('setting-gdrive-webhook');
  if (webhookInput && data.gdrive_webhook_url) {
    webhookInput.value = data.gdrive_webhook_url;
  }

  document.getElementById('btn-save-gdrive-settings')?.addEventListener('click', async () => {
    const url = webhookInput.value.trim();
    await chrome.storage.local.set({ gdrive_webhook_url: url });
    showSettingsMsg('Google Drive settings saved!');
  });

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
    var images = data.images || [];
    var imagesSaved = 0;
    if (images.length) {
      var imageFolder = getOrCreateFolder("images", targetFolder);
      images.forEach(function(image) {
        var comma = image.dataUrl.indexOf(',');
        var mimeType = image.dataUrl.substring(5, image.dataUrl.indexOf(';'));
        var bytes = Utilities.base64Decode(image.dataUrl.substring(comma + 1));
        imageFolder.createFile(Utilities.newBlob(bytes, mimeType, image.filename));
        imagesSaved++;
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success", imagesSaved: imagesSaved}))
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

  const delayInput = document.getElementById('setting-nav-delay');
  if (delayInput) {
    if (data.learnflow_nav_delay) delayInput.value = data.learnflow_nav_delay;
    delayInput.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ learnflow_nav_delay: parseInt(e.target.value, 10) });
    });
  }

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

let homeResumeUrl = null;
let homeBusy = false;
let homeRenderVersion = 0;

function readableWebUrl(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

async function renderHome() {
  const version = ++homeRenderVersion;
  const data = await chrome.storage.local.get(['learnflow_play_progress', 'learnflow_playlist']);
  if (version !== homeRenderVersion) return;
  const saved = Object.entries(data.learnflow_play_progress || {})
    .filter(([url, item]) => readableWebUrl(url) && item.total > 0 && item.index >= 0 && item.index < item.total)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))[0];
  homeResumeUrl = saved?.[0] || (readableWebUrl(currentTabInfo?.url) ? currentTabInfo.url : null);
  const item = saved?.[1];
  document.getElementById('home-resume-label').textContent = saved ? 'LAST READING SESSION' : 'START SOMETHING NEW';
  document.getElementById('home-resume-title').textContent = item?.title || (homeResumeUrl ? currentTabInfo.title || homeResumeUrl : 'Start with a page you want to learn.');
  document.getElementById('home-resume-source').textContent = homeResumeUrl ? new URL(homeResumeUrl).hostname : '';
  const progress = document.getElementById('home-progress');
  progress.hidden = !saved;
  progress.value = item ? Math.round(item.index / item.total * 100) : 0;
  document.getElementById('home-resume-detail').textContent = saved ? `Resume at section ${item.index + 1} of ${item.total} · ${formatTimeAgo(item.updatedAt)}` : 'Open an article or video to begin. No AI setup needed for reading.';
  const resume = document.getElementById('btn-home-resume');
  resume.textContent = homeBusy ? 'Opening reader…' : saved ? '▶ Resume reading' : '▶ Read this page';
  resume.disabled = homeBusy || !homeResumeUrl;
  const current = document.getElementById('btn-home-current');
  current.hidden = !saved || !readableWebUrl(currentTabInfo?.url) || currentTabInfo.url === homeResumeUrl;
  current.disabled = homeBusy;
  const queue = data.learnflow_playlist || [];
  document.getElementById('home-queue-summary').textContent = queue.length ? `${queue.length} ${queue.length === 1 ? 'page' : 'pages'} waiting in your queue` : 'Add pages from the reader to build your next session.';
  const list = document.getElementById('home-queue-list');
  list.replaceChildren();
  for (const [index, queued] of queue.slice(0, 3).entries()) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.textContent = `${index + 1}. ${queued.title || queued.url}`;
    list.appendChild(card);
  }
}

function initHome() {
  const start = async url => {
    if (!url || homeBusy) return;
    homeBusy = true;
    document.getElementById('home-status').textContent = '';
    renderHome();
    try {
      const result = await chrome.runtime.sendMessage({ action: 'RESUME_READING', url });
      if (!result?.success) throw new Error(result?.error || 'Could not open the reader.');
      document.getElementById('home-status').textContent = 'Reader started. Your place will be saved as you listen.';
    } catch (error) {
      document.getElementById('home-status').textContent = error.message;
    } finally {
      homeBusy = false;
      renderHome();
    }
  };
  document.getElementById('btn-home-resume').addEventListener('click', () => start(homeResumeUrl));
  document.getElementById('btn-home-current').addEventListener('click', () => start(currentTabInfo?.url));
  document.getElementById('btn-home-queue').addEventListener('click', () => document.querySelector('[data-tab="playlist"]').click());
  renderHome();
}
