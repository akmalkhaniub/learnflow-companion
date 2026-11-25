/**
 * AudioPlayer - Browser-native Text-to-Speech Engine with sentence highlighting,
 * Smart Code Whisperer, Figure Vision Narration, Table Narration, Sleep/Pomodoro timer,
 * Alt+Click jump-to-paragraph, and auto-advance.
 */
class AudioPlayer {
  constructor() {
    this.synth = window.speechSynthesis;
    this.playbackGeneration = 0;
    this.chunks = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.selectedVoice = null;
    this.currentUtterance = null;
    this.completed = false;
    this.keepAliveTimer = null;
    this._useChromeTts = false;
    this._activeUttId = null;
    this._ttsHandler = null;
    this._highlightedElements = new Set();
    this._highlightedWindows = new Set();

    // Smart Narration Modes
    this.codeWhispererEnabled = true;
    this.figureNarrationEnabled = true;
    this.sleepRemainingSeconds = 0;
    this.sleepInterval = null;

    // Callbacks
    this.onStateChange = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onSleepTick = null;
    this.onStatusMessage = null;

    this._initVoices();
    this._initChromeTtsListener();
  }

  _initChromeTtsListener() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage || typeof window === 'undefined' || window !== window.top) return;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'TTS_EVENT' && msg.uttId && msg.uttId === this._activeUttId && this._ttsHandler) {
        this._ttsHandler(msg);
      }
    });
  }

  _cancelSpeech() {
    try { this.synth.cancel(); } catch {}
    if (this._activeUttId) {
      this._activeUttId = null;
      this._ttsHandler = null;
      try { chrome.runtime?.sendMessage?.({ action: 'TTS_STOP' }).catch?.(() => {}); } catch {}
    }
  }

  _initVoices() {
    const setVoice = async () => {
      const voices = this.synth.getVoices();
      if (!voices.length) return;

      let savedVoiceName = null;
      try {
        const data = await chrome.storage.local.get(['learnflow_preferred_voice']);
        savedVoiceName = data.learnflow_preferred_voice;
      } catch {
        // ignore
      }

      if (savedVoiceName) {
        const exact = voices.find(v => v.name === savedVoiceName);
        if (exact) {
          this.selectedVoice = exact;
          return;
        }
      }

      // Prefer fast, zero-latency local OS voices first to prevent network gaps/dropouts;
      // fall back to natural/online voices if no local English voice exists.
      const preferred =
        voices.find(v => v.lang.startsWith('en') && v.localService && (v.name.includes('Natural') || v.name.includes('Zira') || v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Samantha'))) ||
        voices.find(v => v.lang.startsWith('en') && v.localService) ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];

      this.selectedVoice = preferred;
    };

    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = setVoice;
    }
    setVoice();
  }

  setQueue(chunks) {
    this.stop();
    this.chunks = chunks || [];
    this.currentIndex = 0;
  }

  /**
   * Jump directly to the chunk belonging to a clicked DOM element and start speaking
   */
  jumpToElement(targetEl) {
    if (!targetEl || !this.chunks.length) return false;

    const idx = this.chunks.findIndex(c => c.element && (c.element === targetEl || c.element.contains(targetEl) || targetEl.contains(c.element)));
    if (idx === -1) return false;

    this.playbackGeneration++;
    this._cancelSpeech();
    this.currentIndex = idx;
    this.isPlaying = true;
    this.isPaused = false;
    this._startKeepAlive();
    this._notifyState();
    this._speakChunk(this.currentIndex);
    return true;
  }

  jumpToIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.chunks.length) return false;
    this.suppressAutoScrollUntil = 0;
    this.stop();
    this.currentIndex = index;
    this.play();
    return true;
  }

  visibleChunkIndex() {
    let best = -1, score = Infinity;
    this.chunks.forEach((chunk, index) => {
      const element = chunk.element;
      if (!element?.isConnected) return;
      const range = Number.isInteger(chunk.textStart) ? this._rangeForOffsets(element, chunk.textStart, chunk.textEnd) : null;
      const rect = range?.getBoundingClientRect() || element.getBoundingClientRect();
      if (!rect.width || rect.bottom <= 40 || rect.top >= window.innerHeight - 40) return;
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (/(auto|scroll|hidden)/.test(style.overflowY)) {
          const bounds = parent.getBoundingClientRect();
          if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
        }
        parent = parent.parentElement;
      }
      const distance = Math.abs(rect.top - 80);
      if (distance < score) { best = index; score = distance; }
    });
    return best;
  }

  jumpSection(direction) {
    const headings = this.chunks.map((chunk, index) => (chunk.headingLevel > 0 || /^H[1-6]$/.test(chunk.element?.tagName || '')) ? index : -1).filter(index => index >= 0);
    const index = direction > 0 ? headings.find(index => index > this.currentIndex) : headings.reverse().find(index => index < this.currentIndex);
    return index === undefined ? false : this.jumpToIndex(index);
  }

  /**
   * Move to a saved position without speaking (used to restore reading progress)
   */
  seekTo(index) {
    if (!this.chunks.length) return;
    this.completed = false;
    this.currentIndex = Math.max(0, Math.min(index, this.chunks.length - 1));
    this._highlightChunk(this.chunks[this.currentIndex]);
    if (this.onProgress) {
      this.onProgress({
        current: this.currentIndex + 1,
        total: this.chunks.length,
        percent: Math.min(99, Math.round((this.currentIndex / this.chunks.length) * 100))
      });
    }
  }

  play() {
    if (!this.chunks.length) return;

    if (this.isPaused) {
      this.isPaused = false;
      this.isPlaying = true;
      this._startKeepAlive();
      this._notifyState();
      this._speakChunk(this.currentIndex);
      return;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this._startKeepAlive();
    this._notifyState();
    this._speakChunk(this.currentIndex);
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.playbackGeneration++;
      this._cancelSpeech();
      this.isPaused = true;
      this.isPlaying = false;
      this._stopKeepAlive();
      this._notifyState();
    }
  }

  stop() {
    this.playbackGeneration++;
    this._cancelSpeech();
    this._stopKeepAlive();
    this._clearHighlight();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this.completed = false;
    this._notifyState();
  }

  next() {
    if (this.currentIndex < this.chunks.length - 1) {
      this.playbackGeneration++;
      this._cancelSpeech();
      this.currentIndex++;
      if (this.isPlaying) {
        this._speakChunk(this.currentIndex);
      } else {
        this._highlightChunk(this.chunks[this.currentIndex]);
        this._notifyProgress();
      }
    }
  }

  previous() {
    if (this.currentIndex > 0) {
      this.playbackGeneration++;
      this._cancelSpeech();
      this.completed = false;
      this.currentIndex--;
      if (this.isPlaying) {
        this._speakChunk(this.currentIndex);
      } else {
        this._highlightChunk(this.chunks[this.currentIndex]);
        this._notifyProgress();
      }
    }
  }

  setRate(newRate) {
    this.rate = Math.max(0.6, Math.min(1.6, newRate));
    if (this.isPlaying) {
      this.playbackGeneration++;
      this._cancelSpeech();
      this._speakChunk(this.currentIndex);
    }
  }

  /**
   * Sleep / Pomodoro Timer: Stops playback after N minutes
   */
  setSleepTimer(minutes) {
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }

    if (!minutes || minutes <= 0) {
      this.sleepRemainingSeconds = 0;
      if (this.onSleepTick) this.onSleepTick(0);
      return;
    }

    this.sleepRemainingSeconds = Math.round(minutes * 60);

    this.sleepInterval = setInterval(() => {
      this.sleepRemainingSeconds--;
      if (this.onSleepTick) {
        this.onSleepTick(this.sleepRemainingSeconds);
      }

      if (this.sleepRemainingSeconds <= 0) {
        clearInterval(this.sleepInterval);
        this.sleepInterval = null;
        this.stop();
        if (this.onSleepTick) this.onSleepTick(0);
      }
    }, 1000);
  }

  async _speakChunk(index) {
    const generation = ++this.playbackGeneration;
    this.completed = false;
    const isCurrent = () => this.isPlaying && generation === this.playbackGeneration;
    if (!isCurrent()) return;

    if (index >= this.chunks.length) {
      this.playbackGeneration++;
      this._stopKeepAlive();
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = Math.max(0, this.chunks.length - 1);
      this.completed = true;
      this._notifyState();
      this._notifyProgress();
      if (this.onComplete) {
        this.onComplete();
      }
      return;
    }

    const chunk = this.chunks[index];
    this._highlightChunk(chunk);
    this._notifyProgress();

    let textToSpeak = chunk.text;

    // 1. CODE BLOCK -> Smart Code Whisperer
    if (chunk.type === 'code') {
      if (!this.codeWhispererEnabled) {
        this.currentIndex++;
        this._speakChunk(this.currentIndex);
        return;
      }

      if (!chunk.spokenText) {
        if (this.onStatusMessage) this.onStatusMessage('Summarizing code...');
        let summary = null;
        if (typeof AIRouter !== 'undefined') {
          summary = await AIRouter.summarizeCodeBlock(chunk.text, chunk.lang);
        }
        if (!isCurrent()) return; // Ignore stale AI results after seeking or stopping
        chunk.spokenText = summary || `Code snippet${chunk.lang ? ' in ' + chunk.lang : ''} shown on screen.`;
      }
      textToSpeak = chunk.spokenText;
    }

    // 2. FIGURE / DIAGRAM -> Gemini Vision Narration or Caption
    else if (chunk.type === 'figure') {
      if (!this.figureNarrationEnabled) {
        this.currentIndex++;
        this._speakChunk(this.currentIndex);
        return;
      }

      const description = await this._describeFigure(chunk);
      if (!isCurrent()) return;
      if (description && this.onStatusMessage) this.onStatusMessage('Figure explanation ready: image and nearby context analyzed.');
      if (!description && this.onStatusMessage) this.onStatusMessage(chunk.figureError || 'Figure explanation unavailable. Reading caption only.');
      textToSpeak = description || `Caption only: ${chunk.caption || chunk.text}.`;
    }

    // 3. TABLE -> Gemini Table Summary or Clean Structured Row Reading
    else if (chunk.type === 'table') {
      if (!chunk.spokenText) {
        let tableSummary = null;
        if (typeof AIRouter !== 'undefined' && chunk.rawTableText) {
          const status = await AIRouter.isAvailable();
          if (status.available) {
            if (this.onStatusMessage) this.onStatusMessage('Summarizing table...');
            tableSummary = await AIRouter.summarizeTable(chunk.rawTableText);
          }
        }
        if (!isCurrent()) return;
        chunk.spokenText = tableSummary || chunk.text;
      }
      textToSpeak = chunk.spokenText;
    }

    if (!isCurrent()) return;

    // Pre-fetch Gemini summaries for the next 2 upcoming code/figure/table chunks in background
    this._prefetchUpcoming(index);

    this.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.selectedVoice) {
      this.currentUtterance.voice = this.selectedVoice;
    }
    this.currentUtterance.rate = this.rate;
    this.currentUtterance.pitch = this.pitch;

    this.currentUtterance.onboundary = (event) => {
      if (!isCurrent() || chunk.type !== 'text') return;
      if (event.name === 'word') {
        if (chunk.element) {
          this._highlightWord(chunk.element, textToSpeak, event.charIndex, event.charLength, chunk);
        } else if (this.onRemoteWord) {
          this.onRemoteWord(chunk, textToSpeak, event.charIndex, event.charLength);
        }
      }
    };

    let started = false;
    let startWatchdog = null;
    this.currentUtterance.onstart = () => {
      started = true;
      if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
    };

    this.currentUtterance.onend = () => {
      started = true;
      if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
      if (!isCurrent()) return;
      this.currentIndex++;
      this._speakChunk(this.currentIndex);
    };

    this.currentUtterance.onerror = (e) => {
      started = true;
      if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
      if (!isCurrent()) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        console.log('[LearnFlow TTS] Autoplay blocked on speechSynthesis; switching to chrome.tts');
        this._useChromeTts = true;
        this._speakViaChromeTts(textToSpeak, chunk, isCurrent);
        return;
      }
      console.warn('[LearnFlow TTS] paused at current sentence:', e.error);
      this.pause();
      if (this.onStatusMessage) this.onStatusMessage('Speech paused. Press Play to retry this sentence, or choose another voice.');
    };

    if (this._useChromeTts && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      this._speakViaChromeTts(textToSpeak, chunk, isCurrent);
      return;
    }

    // Keep a strong reference (Chrome GC can drop utterances and silently stop playback)
    window.__lfUtterance = this.currentUtterance;
    this.synth.speak(this.currentUtterance);

    // Watchdog: if Chrome silently drops speechSynthesis without a user gesture, fall back to chrome.tts
    if (this.synth === window.speechSynthesis && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      startWatchdog = setTimeout(() => {
        if (!started && isCurrent() && !this.synth.speaking) {
          try { this.synth.cancel(); } catch {}
          this._useChromeTts = true;
          this._speakViaChromeTts(textToSpeak, chunk, isCurrent);
        }
      }, 650);
    }
  }

  _speakViaChromeTts(textToSpeak, chunk, isCurrent) {
    const uttId = `lf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this._activeUttId = uttId;
    this._ttsHandler = (ev) => {
      if (!isCurrent() || ev.uttId !== uttId) return;
      if (ev.type === 'word' && chunk.type === 'text') {
        if (chunk.element) {
          this._highlightWord(chunk.element, textToSpeak, ev.charIndex, ev.length || 0, chunk);
        } else if (this.onRemoteWord) {
          this.onRemoteWord(chunk, textToSpeak, ev.charIndex, ev.length || 0);
        }
      } else if (ev.type === 'end') {
        this._activeUttId = null;
        this._ttsHandler = null;
        this.currentIndex++;
        this._speakChunk(this.currentIndex);
      } else if (ev.type === 'error') {
        this._activeUttId = null;
        this._ttsHandler = null;
        this._useChromeTts = false;
        // Fallback to native speechSynthesis if chrome.tts errored
        if (this.currentUtterance && this.synth) {
          try {
            this.synth.speak(this.currentUtterance);
            return;
          } catch {}
        }
        this.pause();
        if (this.onStatusMessage) this.onStatusMessage('Speech paused. Press Play to retry this sentence.');
      }
    };
    chrome.runtime.sendMessage({
      action: 'TTS_SPEAK',
      uttId,
      text: textToSpeak,
      rate: this.rate,
      pitch: this.pitch
    }, (res) => {
      if (chrome.runtime.lastError || !res?.started) {
        if (!isCurrent()) return;
        this.pause();
        if (this.onStatusMessage) this.onStatusMessage('Speech paused. Press Play to start reading.');
      }
    });
  }

  /**
   * Background-prefetch AI narration for upcoming code/figure/table chunks
   * so there is zero pause/gap when playback reaches them.
   */
  _prefetchUpcoming(currentIndex) {
    if (typeof GeminiAI === 'undefined') return;
    for (let offset = 1; offset <= 2; offset++) {
      const nextChunk = this.chunks[currentIndex + offset];
      if (!nextChunk || nextChunk.spokenText || nextChunk._prefetching) continue;

      if (nextChunk.type === 'code' && this.codeWhispererEnabled) {
        nextChunk._prefetching = true;
        AIRouter.summarizeCodeBlock(nextChunk.text, nextChunk.lang)
          .then(s => { if (s) nextChunk.spokenText = s; })
          .catch(() => {});
      } else if (nextChunk.type === 'table' && nextChunk.rawTableText) {
        nextChunk._prefetching = true;
        AIRouter.summarizeTable(nextChunk.rawTableText)
          .then(s => { if (s) nextChunk.spokenText = s; })
          .catch(() => {});
      } else if (nextChunk.type === 'figure' && this.figureNarrationEnabled && nextChunk.imgEl) {
        this._describeFigure(nextChunk);
      }
    }
  }

  async _describeFigure(chunk) {
    if (chunk.spokenText) return chunk.spokenText;
    if (chunk.figurePromise) return chunk.figurePromise;
    const task = (async () => {
      try {
        const status = await AIRouter.isAvailable();
        if (status.mode !== 'cloud' && status.mode !== 'hybrid') throw new Error('Figure AI needs Firebase AI Logic or a Gemini API key in Settings. Caption only.');
        const image = chunk.imgEl;
        if (!image) throw new Error('Figure image is unavailable. Caption only.');
        const src = image.currentSrc || image.src || image.getAttribute('data-src') || '';
        const dataUrl = src.startsWith('data:image/') ? src : await MarkdownBuilder.captureImageAsDataUrl(new URL(src, window.location.href).href, image);
        if (!dataUrl) throw new Error('Could not access this image. Caption only; try again after it loads.');
        const context = [chunk.element?.previousElementSibling?.textContent, chunk.element?.nextElementSibling?.textContent].filter(Boolean).join(' ').slice(0, 3500);
        const description = await AIRouter.describeFigure(dataUrl, chunk.caption, context);
        if (!description) throw new Error('Figure AI returned no explanation. Caption only.');
        chunk.spokenText = description;
        chunk.figureError = null;
        return description;
      } catch (error) {
        chunk.figureError = error.message;
        return null;
      }
    })();
    chunk.figurePromise = task;
    try { return await task; }
    finally { if (chunk.figurePromise === task) chunk.figurePromise = null; }
  }

  _rangeForOffsets(element, start, end) {
    const doc = element?.ownerDocument || document;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let offset = 0, node, started = false;
    while ((node = walker.nextNode())) {
      const length = node.nodeValue.length;
      if (!started && start < offset + length) {
        range.setStart(node, Math.max(0, start - offset));
        started = true;
      }
      if (started && end <= offset + length) {
        range.setEnd(node, end - offset);
        return range;
      }
      offset += length;
    }
    return null;
  }

  /**
   * Reveal bounded interactive lesson widgets (tabs, <details>, accordions, Rise flashcards,
   * and bounded Rise Process carousels) without ever clicking page-level navigation buttons.
   */
  _activateContainingTab(element) {
    const doc = element?.ownerDocument || document;
    const win = doc.defaultView || window;
    const isSingleHidden = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
      const st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) return true;
      if (st.maxHeight === '0px' && /(hidden|clip)/.test(st.overflow + st.overflowY)) return true;
      return false;
    };
    const isPanelHidden = (el, stopAt = null) => {
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (isSingleHidden(node)) return true;
        if (node === stopAt) break;
        node = node.parentElement || (node.getRootNode?.()?.host || null);
      }
      return false;
    };

    let cur = element;
    while (cur) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        // 1. Native <details>
        if (cur.tagName === 'DETAILS' && !cur.open) {
          cur.open = true;
        }

        // 2. ARIA or Rise 360 Accordion item
        if (cur.id && isPanelHidden(cur)) {
          const root = cur.getRootNode();
          const trigger = (root.querySelector ? root.querySelector(`[aria-controls="${CSS.escape(cur.id)}"][aria-expanded="false"]`) : null) ||
            doc.querySelector(`[aria-controls="${CSS.escape(cur.id)}"][aria-expanded="false"]`);
          if (trigger) trigger.click();
        }
        if (cur.matches?.('.blocks-accordion__item, .accordion-item') && isPanelHidden(element, cur)) {
          const headerBtn = cur.querySelector('.blocks-accordion__header, [aria-expanded="false"]');
          if (headerBtn) headerBtn.click();
        }

        // 3. ARIA, Material, Qwiklabs, Bootstrap, or Rise 360 Tabs
        if (cur.matches?.('[role="tabpanel"], .tab-pane, ql-tab-panel, md-tab-panel, sl-tab-panel')) {
          const panel = cur;
          const root = panel.getRootNode();
          const isInactive = isPanelHidden(panel) || (panel.classList.contains('tab-pane') && !panel.classList.contains('active'));

          if (isInactive) {
            let tabBtn = null;
            if (panel.id) {
              tabBtn = (root.querySelector ? root.querySelector(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"]`) : null) ||
                doc.querySelector(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"], a[href="#${CSS.escape(panel.id)}"], button[data-bs-target="#${CSS.escape(panel.id)}"]`);
            }
            if (!tabBtn && panel.getAttribute('aria-labelledby')) {
              const labelId = panel.getAttribute('aria-labelledby');
              tabBtn = (root.getElementById ? root.getElementById(labelId) : null) || doc.getElementById(labelId);
            }
            if (!tabBtn && panel.parentElement) {
              const panels = Array.from(panel.parentElement.children).filter(c => c.matches?.('[role="tabpanel"], .tab-pane, ql-tab-panel, md-tab-panel, sl-tab-panel'));
              const idx = panels.indexOf(panel);
              if (idx >= 0) {
                const scope = panel.parentElement.parentElement || (root.host ? root : doc);
                const tabs = Array.from(scope.querySelectorAll('[role="tab"], ql-tab, md-tab, .nav-link, .blocks-tabs__header-item'));
                if (tabs[idx]) tabBtn = tabs[idx];
              }
            }
            if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') {
              tabBtn.click();
            }
          }
        }

        // 4. Bounded Rise Flashcard (flip back-face into view)
        if (cur.matches?.('.flashcard, .flip-card, [class*="flashcard-item" i]') && cur.getBoundingClientRect().height < 650) {
          const inBack = !!element.closest?.('[class*="back" i]');
          const isFlipped = cur.classList.contains('is-flipped') || cur.classList.contains('flipped') || cur.classList.contains('flashcard--flipped');
          if (inBack && !isFlipped) {
            const flipBtn = cur.querySelector('button, [role="button"]') || cur;
            flipBtn.click();
          }
        }

        // 5. Strictly bounded Rise Process / ARIA Carousel widget (< 850px tall, never a page wrapper)
        if (cur.matches?.('.block-process, [aria-roledescription="carousel"]')) {
          const cRect = cur.getBoundingClientRect();
          if (cRect.height > 0 && cRect.height < 850) {
            const eRect = element.getBoundingClientRect();
            const offscreenInCarousel = isPanelHidden(element, cur) || eRect.left >= cRect.right - 8 || eRect.right <= cRect.left + 8;
            if (offscreenInCarousel) {
              const startBtn = cur.querySelector('.process-header__btn, button[class*="start" i]');
              if (startBtn && !isSingleHidden(startBtn)) startBtn.click();
              for (let s = 0; s < 12; s++) {
                const nowRect = element.getBoundingClientRect();
                if (!isPanelHidden(element, cur) && nowRect.left >= cRect.left - 8 && nowRect.right <= cRect.right + 8) break;
                const nextSlideBtn = cur.querySelector('button[aria-label*="next" i], .carousel-control-next, .process-arrow--right');
                if (!nextSlideBtn || isSingleHidden(nextSlideBtn) || nextSlideBtn.disabled) break;
                nextSlideBtn.click();
              }
            }
          }
        }
      }
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
  }

  _ensureShadowHighlightStyle(element) {
    const cssText = `
      .learnflow-active-reading { outline: 2px solid rgba(245, 158, 11, 0.65) !important; outline-offset: 2px !important; border-radius: 4px !important; }
      .learnflow-block-highlight { background-color: rgba(250, 204, 21, 0.25) !important; outline: 2px solid rgba(245, 158, 11, 0.8) !important; outline-offset: 2px !important; border-radius: 4px !important; }
      pre.learnflow-active-reading, table.learnflow-active-reading, figure.learnflow-active-reading { outline: 2px solid #f59e0b !important; outline-offset: 3px !important; }
      ::highlight(learnflow-sentence) { background-color: rgba(250, 204, 21, 0.45); color: inherit; }
      ::highlight(learnflow-word) { background-color: #f59e0b; color: #0f172a; }
    `;
    const root = element?.getRootNode?.();
    if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && !root.getElementById('learnflow-shadow-style')) {
      const style = (element.ownerDocument || document).createElement('style');
      style.id = 'learnflow-shadow-style';
      style.textContent = cssText;
      root.appendChild(style);
    }
    const doc = element?.ownerDocument;
    if (doc && doc !== document && !doc.getElementById('learnflow-doc-style')) {
      const style = doc.createElement('style');
      style.id = 'learnflow-doc-style';
      style.textContent = cssText;
      (doc.head || doc.documentElement)?.appendChild(style);
    }
  }

  _highlightChunk(chunk) {
    this._clearHighlight();
    const element = chunk?.element;
    if (!element) {
      if (chunk && this.onRemoteHighlight) this.onRemoteHighlight(chunk);
      return;
    }
    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;
    this._ensureShadowHighlightStyle(element);
    this._activateContainingTab(element);
    element.classList.add('learnflow-active-reading');
    this._highlightedElements.add(element);
    this._highlightedWindows.add(win);

    let range = null;
    if (chunk.type === 'text' && Number.isInteger(chunk.textStart) && win.CSS?.highlights && typeof win.Highlight === 'function') {
      range = this._rangeForOffsets(element, chunk.textStart, chunk.textEnd);
      if (range) win.CSS.highlights.set('learnflow-sentence', new win.Highlight(range));
    }
    // Shadow DOM elements and non-text blocks (code, figure, table) get block tint + outline.
    const inShadow = typeof ShadowRoot !== 'undefined' && element.getRootNode?.() instanceof ShadowRoot;
    if (!range || inShadow) element.classList.add('learnflow-block-highlight');
    if (Date.now() < (this.suppressAutoScrollUntil || 0)) return;

    const rect = range?.getBoundingClientRect() || element.getBoundingClientRect();
    let scroller = element.parentElement || (element.getRootNode?.()?.host || null);
    while (scroller && scroller !== doc.body && scroller !== doc.documentElement) {
      const style = win.getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement || (scroller.getRootNode?.()?.host || null);
    }
    const nested = scroller && scroller !== doc.body && scroller !== doc.documentElement ? scroller : null;
    const bounds = nested ? nested.getBoundingClientRect() : { top: 0, bottom: win.innerHeight };
    const top = Math.max(0, bounds.top) + 40;
    const bottom = Math.min(win.innerHeight, bounds.bottom) - 40;
    if (rect.top < top || rect.bottom > bottom) {
      const delta = rect.top < top ? rect.top - top : rect.bottom - bottom;
      (nested || win).scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }
    // If element lives inside a same-origin iframe whose outer page itself scrolls, bring it into outer viewport too.
    if (win !== window && win.frameElement) {
      const frameRect = win.frameElement.getBoundingClientRect();
      const absTop = frameRect.top + rect.top;
      const absBottom = frameRect.top + rect.bottom;
      if (absTop < 60 || absBottom > window.innerHeight - 60) {
        const outerDelta = absTop < 60 ? absTop - 80 : absBottom - (window.innerHeight - 80);
        window.scrollBy({ top: outerDelta, left: 0, behavior: 'instant' });
      }
    }
  }

  _highlightWord(element, sentenceText, charIndex, charLength, chunkOverride = null) {
    const doc = element?.ownerDocument || document;
    const win = doc.defaultView || window;
    if (!win.CSS?.highlights || typeof win.Highlight !== 'function') return;
    const chunk = chunkOverride || this.chunks[this.currentIndex];
    if (!Number.isInteger(chunk?.textStart)) return;
    // Speech uses collapsed whitespace. Map its offsets back into the original DOM text.
    const raw = (element.textContent || '').slice(chunk.textStart, chunk.textEnd);
    const offsets = [];
    let normalized = '';
    for (let i = 0; i < raw.length; i++) {
      if (/[\u00AD\u200B\u200C\u200D\uFEFF]/.test(raw[i])) continue;
      const char = /\s/.test(raw[i]) ? ' ' : raw[i];
      if (char === ' ' && normalized.endsWith(' ')) continue;
      normalized += char;
      offsets.push(i);
    }
    if (normalized !== sentenceText || offsets[charIndex] === undefined) return;
    const length = charLength || (sentenceText.slice(charIndex).match(/^\S+/)?.[0].length || 1);
    const last = Math.min(offsets.length - 1, charIndex + length - 1);
    const range = this._rangeForOffsets(element, chunk.textStart + offsets[charIndex], chunk.textStart + offsets[last] + 1);
    if (range) {
      this._highlightedWindows.add(win);
      win.CSS.highlights.set('learnflow-word', new win.Highlight(range));
    }
  }

  _clearHighlight() {
    this._highlightedElements.forEach(el => {
      try { el.classList.remove('learnflow-active-reading', 'learnflow-block-highlight'); } catch {}
    });
    this._highlightedElements.clear();

    const activeEls = (typeof ContentExtractor !== 'undefined' && ContentExtractor._querySelectorAllDeep)
      ? ContentExtractor._querySelectorAllDeep(document, '.learnflow-active-reading')
      : document.querySelectorAll('.learnflow-active-reading');
    activeEls.forEach(el => {
      el.classList.remove('learnflow-active-reading', 'learnflow-block-highlight');
    });

    this._highlightedWindows.forEach(w => {
      try {
        w.CSS?.highlights?.delete('learnflow-word');
        w.CSS?.highlights?.delete('learnflow-sentence');
      } catch {}
    });
    this._highlightedWindows.clear();

    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('learnflow-word');
      CSS.highlights.delete('learnflow-sentence');
    }
    if (this.onRemoteClearHighlight) this.onRemoteClearHighlight();
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    // Chromium bug: only REMOTE (cloud "Google ...") voices silently stop after ~15s.
    // Pausing/resuming LOCAL voices (Microsoft/OS) actually kills them mid-sentence,
    // which was causing the "audio stops automatically" issue — so only apply to remote voices.
    if (this.selectedVoice && this.selectedVoice.localService) return;
    this.keepAliveTimer = setInterval(() => {
      if (this.isPlaying && !this.isPaused && this.synth.speaking) {
        this.synth.pause();
        this.synth.resume();
      }
    }, 12000);
  }

  _stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  _notifyState() {
    if (this.onStateChange) {
      this.onStateChange({
        isPlaying: this.isPlaying,
        isPaused: this.isPaused,
        rate: this.rate
      });
    }
  }

  _notifyProgress() {
    if (!this.completed && this.onChunkStart) this.onChunkStart(this.currentIndex, this.chunks[this.currentIndex]);
    if (this.onProgress) {
      this.onProgress({
        current: this.currentIndex + 1,
        total: this.chunks.length,
        percent: this.completed ? 100 : (this.chunks.length ? Math.min(99, Math.round((this.currentIndex / this.chunks.length) * 100)) : 0)
      });
    }
  }
}

if (typeof window !== 'undefined') {
  window.AudioPlayer = AudioPlayer;
}
