/**
 * PlayerUI - Injected draggable floating widget with audio playback,
 * Soundwave Equalizer, Ask Gemini Audio Briefings, Code Whisperer, Sleep Timer, Multi-Tab Queue, and Cloud Sync.
 */
class PlayerUI {
  constructor(audioPlayer, onArchiveRequest, onGeminiBriefRequest, onAddToQueueRequest) {
    this.audioPlayer = audioPlayer;
    this.onArchiveRequest = onArchiveRequest;
    this.onGeminiBriefRequest = onGeminiBriefRequest;
    this.onAddToQueueRequest = onAddToQueueRequest;
    this.root = null;
    this.autoAdvance = true;
    this.isMinimized = false;
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
    this._makeDraggable(this.root.querySelector('.learnflow-bar'));
    this._loadSettings();
  }

  _renderReaderWidget() {
    this.root.innerHTML = `
      <div class="learnflow-bar" title="Drag to move, click badge to minimize">
        <button class="learnflow-btn learnflow-logo-btn" id="lf-btn-minimize" title="Minimize / Expand">
          <span class="learnflow-badge">${this.siteType === 'oreilly' ? 'O\'REILLY' : (this.siteType === 'google_skills' ? 'SKILLS' : 'READER')}</span>
        </button>

        <div class="learnflow-controls">
          <button class="learnflow-btn" id="lf-btn-prev" title="Previous sentence">⏮</button>
          <button class="learnflow-btn learnflow-btn-primary" id="lf-btn-play" title="Play / Pause (Alt+L)">▶</button>
          
          <div class="lf-equalizer" id="lf-sound-equalizer" title="Speaking">
            <div class="lf-bar-line"></div>
            <div class="lf-bar-line"></div>
            <div class="lf-bar-line"></div>
          </div>

          <button class="learnflow-btn" id="lf-btn-next" title="Next sentence">⏭</button>
          <button class="learnflow-btn" id="lf-btn-stop" title="Stop">⏹</button>
        </div>

        <div class="learnflow-info">
          <div class="learnflow-progress-text" id="lf-progress-text">Ready to play</div>
          <div class="learnflow-progress-bar">
            <div class="learnflow-progress-fill" id="lf-progress-fill"></div>
          </div>
        </div>

        <select class="learnflow-speed-select" id="lf-speed-select" title="Speech Speed">
          <option value="0.8">0.8x</option>
          <option value="1.0" selected>1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="1.75">1.75x</option>
          <option value="2.0">2.0x</option>
        </select>

        <select class="learnflow-speed-select" id="lf-sleep-select" title="Sleep / Pomodoro Timer">
          <option value="0">⏱️ Off</option>
          <option value="15">⏱️ 15m</option>
          <option value="25">⏱️ 25m (Pomo)</option>
          <option value="45">⏱️ 45m</option>
        </select>

        <div class="learnflow-toggle active" id="lf-toggle-autonav" title="Auto-advance to next chapter/step when done">
          <span>🔄</span>
          <span>Auto-Next</span>
        </div>

        <div class="learnflow-toggle active" id="lf-toggle-codewhisperer" title="Code Whisperer: summarize code blocks aloud">
          <span>💻</span>
          <span>Code AI</span>
        </div>

        <button class="learnflow-btn lf-gemini-btn" id="lf-btn-gemini" title="✨ Ask Gemini: 2-Min Audio Briefing (Alt+G)">
          ✨
        </button>

        <button class="learnflow-btn" id="lf-btn-add-queue" title="📑 Add to Multi-Tab Playlist Queue">
          ➕
        </button>

        <button class="learnflow-btn" id="lf-btn-archive" title="Archive page (Markdown + Figures + Tables) to Local Drive & Google Drive">
          💾
        </button>
      </div>
    `;

    // Event Handlers
    const playBtn = this.root.querySelector('#lf-btn-play');
    const stopBtn = this.root.querySelector('#lf-btn-stop');
    const prevBtn = this.root.querySelector('#lf-btn-prev');
    const nextBtn = this.root.querySelector('#lf-btn-next');
    const speedSelect = this.root.querySelector('#lf-speed-select');
    const sleepSelect = this.root.querySelector('#lf-sleep-select');
    const autoNavToggle = this.root.querySelector('#lf-toggle-autonav');
    const codeWhisperToggle = this.root.querySelector('#lf-toggle-codewhisperer');
    const archiveBtn = this.root.querySelector('#lf-btn-archive');
    const geminiBtn = this.root.querySelector('#lf-btn-gemini');
    const addQueueBtn = this.root.querySelector('#lf-btn-add-queue');
    const minimizeBtn = this.root.querySelector('#lf-btn-minimize');
    const equalizer = this.root.querySelector('#lf-sound-equalizer');

    playBtn.addEventListener('click', () => {
      if (this.audioPlayer.isPlaying) {
        this.audioPlayer.pause();
      } else {
        this.audioPlayer.play();
      }
    });

    stopBtn.addEventListener('click', () => this.audioPlayer.stop());
    prevBtn.addEventListener('click', () => this.audioPlayer.previous());
    nextBtn.addEventListener('click', () => this.audioPlayer.next());

    speedSelect.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value);
      this.audioPlayer.setRate(rate);
      chrome.storage.local.set({ learnflow_preferred_rate: rate });
    });

    sleepSelect.addEventListener('change', (e) => {
      const mins = parseInt(e.target.value, 10);
      this.audioPlayer.setSleepTimer(mins);
      this.showToast(mins > 0 ? `Sleep timer set for ${mins} minutes` : 'Sleep timer disabled');
    });

    autoNavToggle.addEventListener('click', () => {
      this.autoAdvance = !this.autoAdvance;
      autoNavToggle.classList.toggle('active', this.autoAdvance);
      chrome.storage.local.set({ learnflow_auto_advance_enabled: this.autoAdvance });
      this.showToast(this.autoAdvance ? 'Auto-Advance enabled' : 'Auto-Advance disabled');
    });

    codeWhisperToggle.addEventListener('click', () => {
      this.audioPlayer.codeWhispererEnabled = !this.audioPlayer.codeWhispererEnabled;
      codeWhisperToggle.classList.toggle('active', this.audioPlayer.codeWhispererEnabled);
      this.showToast(this.audioPlayer.codeWhispererEnabled ? 'Code Whisperer ON (summarizes code)' : 'Code Whisperer OFF (skips code)');
    });

    archiveBtn.addEventListener('click', () => {
      if (this.onArchiveRequest) this.onArchiveRequest();
    });

    geminiBtn.addEventListener('click', () => {
      if (this.onGeminiBriefRequest) this.onGeminiBriefRequest();
    });

    addQueueBtn.addEventListener('click', () => {
      if (this.onAddToQueueRequest) this.onAddToQueueRequest();
    });

    minimizeBtn.addEventListener('click', () => {
      const bar = this.root.querySelector('.learnflow-bar');
      bar.classList.toggle('minimized');
    });

    this.audioPlayer.onStateChange = (state) => {
      playBtn.textContent = state.isPlaying ? '⏸' : '▶';
      if (equalizer) {
        equalizer.classList.toggle('active', state.isPlaying);
      }
    };

    this.audioPlayer.onProgress = (prog) => {
      const text = this.root.querySelector('#lf-progress-text');
      const fill = this.root.querySelector('#lf-progress-fill');
      if (text) text.textContent = `${prog.percent}% (${prog.current}/${prog.total})`;
      if (fill) fill.style.width = `${prog.percent}%`;
    };

    this.audioPlayer.onSleepTick = (remainingSec) => {
      if (remainingSec > 0 && remainingSec % 60 === 0) {
        this.showToast(`⏱️ ${Math.ceil(remainingSec / 60)}m until sleep pause`);
      }
    };
  }

  _renderYouTubeWidget() {
    this.root.innerHTML = `
      <div class="learnflow-bar" title="YouTube Companion Bar">
        <span class="learnflow-badge">YOUTUBE</span>
        <button class="learnflow-btn learnflow-btn-primary" id="lf-yt-snapshot" title="Capture current frame screenshot + transcript to local & Google Drive">
          📸 Save Note & Transcript
        </button>
        <button class="learnflow-btn lf-gemini-btn" id="lf-yt-gemini" title="✨ Ask Gemini to summarize this video">
          ✨ Ask Gemini
        </button>
        <button class="learnflow-btn" id="lf-yt-add-queue" title="📑 Add video to Playlist Queue">
          ➕ Queue
        </button>
        <button class="learnflow-btn" id="lf-btn-minimize" title="Minimize">─</button>
      </div>
    `;

    const snapshotBtn = this.root.querySelector('#lf-yt-snapshot');
    const geminiBtn = this.root.querySelector('#lf-yt-gemini');
    const queueBtn = this.root.querySelector('#lf-yt-add-queue');
    const minimizeBtn = this.root.querySelector('#lf-btn-minimize');

    snapshotBtn.addEventListener('click', async () => {
      snapshotBtn.textContent = '⏳ Saving...';
      if (this.onArchiveRequest) await this.onArchiveRequest();
      snapshotBtn.textContent = '📸 Save Note & Transcript';
    });

    geminiBtn.addEventListener('click', () => {
      if (this.onGeminiBriefRequest) this.onGeminiBriefRequest();
    });

    queueBtn.addEventListener('click', () => {
      if (this.onAddToQueueRequest) this.onAddToQueueRequest();
    });

    minimizeBtn.addEventListener('click', () => {
      this.root.querySelector('.learnflow-bar').classList.toggle('minimized');
    });
  }

  showToast(message, duration = 3000) {
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

  async _loadSettings() {
    const data = await chrome.storage.local.get(['learnflow_preferred_rate', 'learnflow_auto_advance_enabled']);
    if (data.learnflow_preferred_rate) {
      const select = this.root.querySelector('#lf-speed-select');
      if (select) {
        select.value = data.learnflow_preferred_rate.toString();
        this.audioPlayer.setRate(data.learnflow_preferred_rate);
      }
    }
    if (data.learnflow_auto_advance_enabled !== undefined) {
      this.autoAdvance = data.learnflow_auto_advance_enabled;
      const toggle = this.root.querySelector('#lf-toggle-autonav');
      if (toggle) toggle.classList.toggle('active', this.autoAdvance);
    }
  }

  _makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    element.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, select, .learnflow-toggle')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
        this.root.style.left = `${initialX + dx}px`;
        this.root.style.top = `${initialY + dy}px`;
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
