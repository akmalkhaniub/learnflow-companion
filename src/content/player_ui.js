/**
 * PlayerUI - Ultra-compact, dockable floating/edge player with expandable controls popover,
 * Soundwave Equalizer, Ask Gemini Audio Briefings, Code Whisperer, Figure Vision toggle,
 * Sleep Timer, Multi-Tab Queue, and 4 persistent Dock Modes (Float, Right, Left, Bottom).
 */
class PlayerUI {
  constructor(audioPlayer, handlers = {}) {
    this.audioPlayer = audioPlayer;
    this.onArchiveRequest = handlers.onArchiveRequest || null;
    this.onGeminiBriefRequest = handlers.onGeminiBriefRequest || null;
    this.onAddToQueueRequest = handlers.onAddToQueueRequest || null;
    this.onPlayRequest = handlers.onPlayRequest || null;
    this.onRestartRequest = handlers.onRestartRequest || null;
    this.onCloseRequest = handlers.onCloseRequest || null;

    this.root = null;
    this.autoAdvance = true;
    this.dockMode = 'dock-right'; // Default to sleek right-edge dock (zero book overlap!)
    this.siteType = ContentExtractor.getSiteType();
  }

  init() {
    if (document.getElementById('learnflow-player-root')) {
      return;
    }

    this.root = document.createElement('div');
    this.root.id = 'learnflow-player-root';

    if (this.siteType === 'youtube') {
      this._renderYouTubeWidget();
    } else {
      this._renderReaderWidget();
    }

    document.body.appendChild(this.root);
    this.root.querySelector('#lf-btn-close')?.addEventListener('click', () => {
      if (this.onCloseRequest) this.onCloseRequest();
    });
    this._makeDraggable(this.root.querySelector('.learnflow-bar'));
    this._loadSettings();
  }

  _renderReaderWidget() {
    const siteLabel = this.siteType === 'oreilly' ? "O'REILLY" : (this.siteType === 'google_skills' ? 'SKILLS' : 'READER');

    this.root.innerHTML = `
      <div class="lf-popover" id="lf-popover">
        <div class="lf-pop-header">
          <span class="lf-pop-title">🎧 LearnFlow • ${siteLabel}</span>
          <span id="lf-pop-status" style="font-size: 11px; color: #94a3b8;">Ready</span>
        </div>

        <div class="learnflow-progress-bar">
          <div class="learnflow-progress-fill" id="lf-progress-fill"></div>
        </div>

        <div class="lf-pop-row">
          <span class="lf-pop-label">Speed</span>
          <select class="lf-pop-select" id="lf-speed-select">
            <option value="0.75">0.75x</option>
            <option value="0.9">0.9x</option>
            <option value="1.0" selected>1.0x (Normal)</option>
            <option value="1.1">1.1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.4">1.4x</option>
            <option value="1.5">1.5x</option>
          </select>
        </div>

        <div class="lf-pop-row">
          <span class="lf-pop-label">Sleep Timer</span>
          <select class="lf-pop-select" id="lf-sleep-select">
            <option value="0">Off</option>
            <option value="15">15 min</option>
            <option value="25">25 min (Pomo)</option>
            <option value="45">45 min</option>
          </select>
        </div>

        <div class="lf-toggle-grid">
          <div class="lf-chip-toggle active" id="lf-toggle-autonav" title="Auto-flip to next chapter when finished">
            <span>🔄</span><span>Auto-Next</span>
          </div>
          <div class="lf-chip-toggle active" id="lf-toggle-codewhisperer" title="Summarize code blocks aloud">
            <span>💻</span><span>Code AI</span>
          </div>
          <div class="lf-chip-toggle active" id="lf-toggle-figures" title="Read figure captions & Gemini Vision descriptions">
            <span>🖼️</span><span>Figure AI</span>
          </div>
          <div class="lf-chip-toggle" id="lf-btn-add-queue" title="Add page to Multi-Tab Playlist Queue">
            <span>➕</span><span>+Queue</span>
          </div>
        </div>

        <div>
          <div class="lf-pop-label" style="margin-bottom: 5px;">Dock Position</div>
          <div class="lf-dock-grid">
            <button class="lf-dock-btn" data-dock="dock-left" title="Dock to Left Edge">◧ Left</button>
            <button class="lf-dock-btn" data-dock="dock-bottom" title="Dock to Bottom Edge">⬓ Bot</button>
            <button class="lf-dock-btn" data-dock="dock-right" title="Dock to Right Edge">◨ Right</button>
            <button class="lf-dock-btn" data-dock="float" title="Free Floating Pill">✥ Float</button>
          </div>
        </div>

        <div class="lf-pop-actions">
          <button class="lf-pop-action-btn" id="lf-btn-restart" title="Restart from top of page">↺ Top</button>
          <button class="lf-pop-action-btn" id="lf-btn-stop">⏹ Stop</button>
          <button class="lf-pop-action-btn" id="lf-btn-pop-archive">💾 Save</button>
        </div>

        <div class="lf-pop-hint">Tip: <b>Alt + Click</b> any paragraph to read from there</div>
      </div>

      <div class="learnflow-bar" id="lf-main-bar" title="LearnFlow Player (Drag when floating)">
        <button class="learnflow-btn lf-collapse-btn" id="lf-btn-minimize" title="Collapse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        <button class="learnflow-btn learnflow-btn-primary" id="lf-btn-play" title="Play / Pause (Alt+L)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
        </button>

        <div class="lf-equalizer" id="lf-sound-equalizer" title="Speaking">
          <div class="lf-bar-line"></div>
          <div class="lf-bar-line"></div>
          <div class="lf-bar-line"></div>
        </div>

        <span class="lf-mini-progress" id="lf-progress-text" title="Reading progress">0%</span>

        <button class="learnflow-btn lf-step-btn" id="lf-btn-prev" title="Previous sentence (Back)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
        </button>
        <button class="learnflow-btn lf-step-btn" id="lf-btn-next" title="Next sentence (Forward)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
        </button>
        <button class="learnflow-btn lf-gemini-btn" id="lf-btn-gemini" title="Ask Gemini: 2-Min Audio Brief (Alt+G)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"></path></svg>
        </button>
        <button class="learnflow-btn" id="lf-btn-archive" title="Save clean Markdown + Figures + Tables">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        </button>
        <button class="learnflow-btn" id="lf-btn-settings" title="Settings & Dock Options">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <button class="learnflow-btn lf-close-btn" id="lf-btn-close" title="Close reader on this page (Alt+L to reopen)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;

    // Element Refs
    const bar = this.root.querySelector('#lf-main-bar');
    const popover = this.root.querySelector('#lf-popover');
    const playBtn = this.root.querySelector('#lf-btn-play');
    const stopBtn = this.root.querySelector('#lf-btn-stop');
    const prevBtn = this.root.querySelector('#lf-btn-prev');
    const nextBtn = this.root.querySelector('#lf-btn-next');
    const speedSelect = this.root.querySelector('#lf-speed-select');
    const sleepSelect = this.root.querySelector('#lf-sleep-select');
    const autoNavToggle = this.root.querySelector('#lf-toggle-autonav');
    const codeWhisperToggle = this.root.querySelector('#lf-toggle-codewhisperer');
    const figureToggle = this.root.querySelector('#lf-toggle-figures');
    const archiveBtn = this.root.querySelector('#lf-btn-archive');
    const popArchiveBtn = this.root.querySelector('#lf-btn-pop-archive');
    const geminiBtn = this.root.querySelector('#lf-btn-gemini');
    const addQueueBtn = this.root.querySelector('#lf-btn-add-queue');
    const settingsBtn = this.root.querySelector('#lf-btn-settings');
    const minimizeBtn = this.root.querySelector('#lf-btn-minimize');
    const equalizer = this.root.querySelector('#lf-sound-equalizer');
    const dockBtns = this.root.querySelectorAll('.lf-dock-btn');

    // Play / Pause
    playBtn.addEventListener('click', () => {
      if (this.audioPlayer.isPlaying) {
        this.audioPlayer.pause();
      } else if (this.onPlayRequest) {
        this.onPlayRequest();
      } else {
        this.audioPlayer.play();
      }
    });

    stopBtn.addEventListener('click', () => {
      this.audioPlayer.stop();
      popover.classList.remove('open');
    });

    this.root.querySelector('#lf-btn-restart')?.addEventListener('click', () => {
      popover.classList.remove('open');
      if (this.onRestartRequest) this.onRestartRequest();
    });

    prevBtn.addEventListener('click', () => this.audioPlayer.previous());
    nextBtn.addEventListener('click', () => this.audioPlayer.next());

    // Settings Popover toggle
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (this.root && !this.root.contains(e.target)) {
        popover.classList.remove('open');
      }
    });

    // Minimize / Expand with standard chevron orientation
    const updateCollapseIcon = () => {
      const collapsed = bar.classList.contains('minimized');
      minimizeBtn.title = collapsed ? 'Expand LearnFlow' : 'Collapse';
      minimizeBtn.innerHTML = collapsed
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    };

    minimizeBtn.addEventListener('click', () => {
      bar.classList.toggle('minimized');
      if (bar.classList.contains('minimized')) {
        popover.classList.remove('open');
      }
      updateCollapseIcon();
    });

    // Speed
    speedSelect.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value);
      this.audioPlayer.setRate(rate);
      chrome.storage.local.set({ learnflow_preferred_rate: rate });
    });

    // Sleep Timer
    sleepSelect.addEventListener('change', (e) => {
      const mins = parseInt(e.target.value, 10);
      this.audioPlayer.setSleepTimer(mins);
      this.showToast(mins > 0 ? `Sleep timer: ${mins}m` : 'Sleep timer off');
    });

    // Toggles
    autoNavToggle.addEventListener('click', () => {
      this.autoAdvance = !this.autoAdvance;
      autoNavToggle.classList.toggle('active', this.autoAdvance);
      chrome.storage.local.set({ learnflow_auto_advance_enabled: this.autoAdvance });
      this.showToast(this.autoAdvance ? 'Auto-Next ON' : 'Auto-Next OFF');
    });

    codeWhisperToggle.addEventListener('click', () => {
      this.audioPlayer.codeWhispererEnabled = !this.audioPlayer.codeWhispererEnabled;
      codeWhisperToggle.classList.toggle('active', this.audioPlayer.codeWhispererEnabled);
      this.showToast(this.audioPlayer.codeWhispererEnabled ? 'Code Whisperer ON' : 'Code Whisperer OFF');
    });

    figureToggle.addEventListener('click', () => {
      this.audioPlayer.figureNarrationEnabled = !this.audioPlayer.figureNarrationEnabled;
      figureToggle.classList.toggle('active', this.audioPlayer.figureNarrationEnabled);
      this.showToast(this.audioPlayer.figureNarrationEnabled ? 'Figure Narration ON' : 'Figure Narration OFF');
    });

    // Dock Buttons
    dockBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.dock;
        this.applyDockMode(mode);
        chrome.storage.local.set({ learnflow_dock_mode: mode });
      });
    });

    // Actions
    const triggerArchive = () => {
      popover.classList.remove('open');
      if (this.onArchiveRequest) this.onArchiveRequest();
    };
    archiveBtn.addEventListener('click', triggerArchive);
    popArchiveBtn.addEventListener('click', triggerArchive);

    geminiBtn.addEventListener('click', () => {
      if (this.onGeminiBriefRequest) this.onGeminiBriefRequest();
    });

    addQueueBtn.addEventListener('click', () => {
      if (this.onAddToQueueRequest) this.onAddToQueueRequest();
    });

    // AudioPlayer callbacks -> UI updates
    this.audioPlayer.onStateChange = (state) => {
      playBtn.innerHTML = state.isPlaying
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
      if (equalizer) equalizer.classList.toggle('active', state.isPlaying);
      const popStatus = this.root.querySelector('#lf-pop-status');
      if (popStatus) popStatus.textContent = state.isPlaying ? 'Speaking...' : (state.isPaused ? 'Paused' : 'Ready');
    };

    this.audioPlayer.onProgress = (prog) => {
      const text = this.root.querySelector('#lf-progress-text');
      const fill = this.root.querySelector('#lf-progress-fill');
      const popStatus = this.root.querySelector('#lf-pop-status');
      if (text) {
        text.textContent = `${prog.percent}%`;
        text.title = `Segment ${prog.current} of ${prog.total}`;
      }
      if (fill) fill.style.width = `${prog.percent}%`;
      if (popStatus) popStatus.textContent = `${prog.current} / ${prog.total} (${prog.percent}%)`;
    };

    this.audioPlayer.onStatusMessage = (msg) => {
      const popStatus = this.root.querySelector('#lf-pop-status');
      if (popStatus) popStatus.textContent = msg;
      this.showToast(msg, 2200);
    };

    this.audioPlayer.onSleepTick = (remainingSec) => {
      if (remainingSec > 0 && remainingSec % 60 === 0) {
        this.showToast(`⏱️ ${Math.ceil(remainingSec / 60)}m left`);
      }
    };
  }

  _renderYouTubeWidget() {
    this.root.innerHTML = `
      <div class="lf-popover" id="lf-popover">
        <div class="lf-pop-header">
          <span class="lf-pop-title">🎬 LearnFlow • YOUTUBE</span>
        </div>
        <div>
          <div class="lf-pop-label" style="margin-bottom: 5px;">Dock Position</div>
          <div class="lf-dock-grid">
            <button class="lf-dock-btn" data-dock="dock-left">◧ Left</button>
            <button class="lf-dock-btn" data-dock="dock-bottom">⬓ Bot</button>
            <button class="lf-dock-btn" data-dock="dock-right">◨ Right</button>
            <button class="lf-dock-btn" data-dock="float">✥ Float</button>
          </div>
        </div>
      </div>

      <div class="learnflow-bar" id="lf-main-bar" title="YouTube Companion">
        <button class="learnflow-btn lf-collapse-btn" id="lf-btn-minimize" title="Collapse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        <button class="learnflow-btn learnflow-btn-primary" id="lf-yt-snapshot" title="Capture video screenshot + transcript">📸</button>
        <button class="learnflow-btn lf-gemini-btn" id="lf-yt-gemini" title="✨ Ask Gemini to summarize this video">✨</button>
        <button class="learnflow-btn" id="lf-yt-add-queue" title="➕ Add video to Playlist Queue">➕</button>
        <button class="learnflow-btn" id="lf-btn-settings" title="Dock Options">⚙</button>
        <button class="learnflow-btn lf-close-btn" id="lf-btn-close" title="Close">✕</button>
      </div>
    `;

    const bar = this.root.querySelector('#lf-main-bar');
    const popover = this.root.querySelector('#lf-popover');
    const snapshotBtn = this.root.querySelector('#lf-yt-snapshot');
    const geminiBtn = this.root.querySelector('#lf-yt-gemini');
    const queueBtn = this.root.querySelector('#lf-yt-add-queue');
    const minimizeBtn = this.root.querySelector('#lf-btn-minimize');
    const settingsBtn = this.root.querySelector('#lf-btn-settings');

    snapshotBtn.addEventListener('click', async () => {
      snapshotBtn.textContent = '⏳';
      if (this.onArchiveRequest) await this.onArchiveRequest();
      snapshotBtn.textContent = '📸';
    });

    geminiBtn.addEventListener('click', () => {
      if (this.onGeminiBriefRequest) this.onGeminiBriefRequest();
    });

    queueBtn.addEventListener('click', () => {
      if (this.onAddToQueueRequest) this.onAddToQueueRequest();
    });

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (this.root && !this.root.contains(e.target)) {
        popover.classList.remove('open');
      }
    });

    minimizeBtn.addEventListener('click', () => {
      bar.classList.toggle('minimized');
      if (bar.classList.contains('minimized')) popover.classList.remove('open');
    });

    this.root.querySelectorAll('.lf-dock-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.dock;
        this.applyDockMode(mode);
        chrome.storage.local.set({ learnflow_dock_mode: mode });
      });
    });
  }

  destroy() {
    if (this.root) this.root.remove();
    this.root = null;
  }

  isVisible() {
    return !!(this.root && document.body.contains(this.root));
  }

  applyDockMode(mode) {
    this.dockMode = mode || 'dock-right';
    this.root.classList.remove('dock-right', 'dock-left', 'dock-bottom', 'float');
    this.root.style.left = '';
    this.root.style.top = '';
    this.root.style.right = '';
    this.root.style.bottom = '';

    if (this.dockMode !== 'float') {
      this.root.classList.add(this.dockMode);
    }

    this.root.querySelectorAll('.lf-dock-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.dock === this.dockMode);
    });
  }

  showToast(message, duration = 2800) {
    if (!this.root) return;
    const existing = this.root.querySelector('.learnflow-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'learnflow-toast';
    toast.textContent = message;
    this.root.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, duration);
  }

  applyTheme(theme) {
    if (!this.root) return;
    this.root.classList.toggle('lf-light', (theme || 'light') === 'light');
  }

  async _loadSettings() {
    const data = await chrome.storage.local.get([
      'learnflow_preferred_rate',
      'learnflow_auto_advance_enabled',
      'learnflow_dock_mode',
      'learnflow_theme'
    ]);

    if (data.learnflow_preferred_rate) {
      const clamped = Math.min(1.5, Math.max(0.75, parseFloat(data.learnflow_preferred_rate)));
      const select = this.root.querySelector('#lf-speed-select');
      if (select) {
        // Pick closest option in dropdown
        const opts = Array.from(select.options).map(o => parseFloat(o.value));
        const closest = opts.reduce((a, b) => Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a);
        select.value = closest.toString();
        this.audioPlayer.setRate(clamped);
      }
    }

    if (data.learnflow_auto_advance_enabled !== undefined) {
      this.autoAdvance = data.learnflow_auto_advance_enabled;
      const toggle = this.root.querySelector('#lf-toggle-autonav');
      if (toggle) toggle.classList.toggle('active', this.autoAdvance);
    }

    // Apply saved dock mode (defaults to sleek right edge dock!) & theme (defaults to light!)
    this.applyDockMode(data.learnflow_dock_mode || 'dock-right');
    this.applyTheme(data.learnflow_theme || 'light');

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.learnflow_theme) {
        this.applyTheme(changes.learnflow_theme.newValue || 'light');
      }
    });
  }

  _makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    element.addEventListener('mousedown', (e) => {
      if (this.dockMode !== 'float') return; // Only drag when in Float mode
      if (e.target.closest('button, select, .lf-chip-toggle')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.root.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
        this.root.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, initialX + dx))}px`;
        this.root.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, initialY + dy))}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

if (typeof window !== 'undefined') {
  window.PlayerUI = PlayerUI;
}
