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
    this.synth.cancel();
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
    const headings = this.chunks.map((chunk, index) => /^H[1-6]$/.test(chunk.element?.tagName || '') ? index : -1).filter(index => index >= 0);
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
      this.synth.cancel();
      this.isPaused = true;
      this.isPlaying = false;
      this._stopKeepAlive();
      this._notifyState();
    }
  }

  stop() {
    this.playbackGeneration++;
    this.synth.cancel();
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
      this.synth.cancel();
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
      this.synth.cancel();
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
      this.synth.cancel();
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
        if (typeof GeminiAI !== 'undefined') {
          summary = await GeminiAI.summarizeCodeBlock(chunk.text, chunk.lang);
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
        if (typeof GeminiAI !== 'undefined' && chunk.rawTableText) {
          const status = await GeminiAI.isAvailable();
          if (status.available) {
            if (this.onStatusMessage) this.onStatusMessage('Summarizing table...');
            tableSummary = await GeminiAI.summarizeTable(chunk.rawTableText);
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

    this.currentUtterance.onend = () => {
      if (!isCurrent()) return;
      this.currentIndex++;
      this._speakChunk(this.currentIndex);
    };

    this.currentUtterance.onerror = (e) => {
      if (!isCurrent()) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('[LearnFlow TTS] paused at current sentence:', e.error);
      this.pause();
      if (this.onStatusMessage) this.onStatusMessage('Speech paused. Press Play to retry this sentence, or choose another voice.');
    };

    // Keep a strong reference (Chrome GC can drop utterances and silently stop playback)
    window.__lfUtterance = this.currentUtterance;
    this.synth.speak(this.currentUtterance);
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
        GeminiAI.summarizeCodeBlock(nextChunk.text, nextChunk.lang)
          .then(s => { if (s) nextChunk.spokenText = s; })
          .catch(() => {});
      } else if (nextChunk.type === 'table' && nextChunk.rawTableText) {
        nextChunk._prefetching = true;
        GeminiAI.summarizeTable(nextChunk.rawTableText)
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
        const status = await GeminiAI.isAvailable();
        if (status.mode !== 'cloud') throw new Error('Figure AI needs a Gemini API key in Settings. Caption only.');
        const image = chunk.imgEl;
        if (!image) throw new Error('Figure image is unavailable. Caption only.');
        const src = image.currentSrc || image.src || image.getAttribute('data-src') || '';
        const dataUrl = src.startsWith('data:image/') ? src : await MarkdownBuilder.captureImageAsDataUrl(new URL(src, window.location.href).href, image);
        if (!dataUrl) throw new Error('Could not access this image. Caption only; try again after it loads.');
        const context = [chunk.element?.previousElementSibling?.textContent, chunk.element?.nextElementSibling?.textContent].filter(Boolean).join(' ').slice(0, 3500);
        const description = await GeminiAI.describeFigure(dataUrl, chunk.caption, context);
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
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
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
   * If the element lives inside an inactive tab panel (skills.google, ARIA tabs, Bootstrap/Material tabs),
   * click the matching tab button so the UI visually switches to that tab!
   */
  _activateContainingTab(element) {
    let cur = element;
    while (cur) {
      if (cur.nodeType === Node.ELEMENT_NODE && cur.matches?.('[role="tabpanel"], .tab-pane, ql-tab-panel, md-tab-panel, sl-tab-panel')) {
        const panel = cur;
        const root = panel.getRootNode();
        const isInactive = panel.hidden || panel.getAttribute('aria-hidden') === 'true' ||
          (panel.classList.contains('tab-pane') && !panel.classList.contains('active')) ||
          window.getComputedStyle(panel).display === 'none';

        if (isInactive) {
          let tabBtn = null;
          if (panel.id) {
            tabBtn = (root.querySelector ? root.querySelector(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"]`) : null) ||
              document.querySelector(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"], a[href="#${CSS.escape(panel.id)}"], button[data-bs-target="#${CSS.escape(panel.id)}"]`);
          }
          if (!tabBtn && panel.getAttribute('aria-labelledby')) {
            const labelId = panel.getAttribute('aria-labelledby');
            tabBtn = (root.getElementById ? root.getElementById(labelId) : null) || document.getElementById(labelId);
          }
          if (!tabBtn && panel.parentElement) {
            const panels = Array.from(panel.parentElement.children).filter(c => c.matches?.('[role="tabpanel"], .tab-pane, ql-tab-panel, md-tab-panel, sl-tab-panel'));
            const idx = panels.indexOf(panel);
            if (idx >= 0) {
              const scope = panel.parentElement.parentElement || (root.host ? root : document);
              const tabs = Array.from(scope.querySelectorAll('[role="tab"], ql-tab, md-tab, .nav-link'));
              if (tabs[idx]) tabBtn = tabs[idx];
            }
          }
          if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') {
            tabBtn.click();
          }
        }
      }
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
  }

  _ensureShadowHighlightStyle(element) {
    const root = element?.getRootNode?.();
    if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && !root.getElementById('learnflow-shadow-style')) {
      const style = document.createElement('style');
      style.id = 'learnflow-shadow-style';
      style.textContent = `
        .learnflow-active-reading { background-color: rgba(250, 204, 21, 0.28) !important; box-shadow: inset 3px 0 0 #d97706 !important; border-radius: 4px !important; }
        .learnflow-block-highlight { background-color: rgba(250, 204, 21, 0.35) !important; }
        ::highlight(learnflow-sentence) { background-color: rgba(254, 240, 138, 0.55); color: inherit; }
        ::highlight(learnflow-word) { background-color: #f59e0b; color: #0f172a; }
      `;
      root.appendChild(style);
    }
  }

  _highlightChunk(chunk) {
    this._clearHighlight();
    const element = chunk?.element;
    if (!element) {
      if (chunk && this.onRemoteHighlight) this.onRemoteHighlight(chunk);
      return;
    }
    this._ensureShadowHighlightStyle(element);
    this._activateContainingTab(element);
    element.classList.add('learnflow-active-reading');
    let range = null;
    if (chunk.type === 'text' && Number.isInteger(chunk.textStart) && typeof CSS !== 'undefined' && CSS.highlights) {
      range = this._rangeForOffsets(element, chunk.textStart, chunk.textEnd);
      if (range) CSS.highlights.set('learnflow-sentence', new Highlight(range));
    }
    // Only non-text blocks (or browsers without custom highlights) need a block tint.
    if (!range) element.classList.add('learnflow-block-highlight');
    if (Date.now() < (this.suppressAutoScrollUntil || 0)) return;
    const rect = range?.getBoundingClientRect() || element.getBoundingClientRect();
    let scroller = element.parentElement;
    while (scroller && scroller !== document.body) {
      const style = window.getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    const nested = scroller && scroller !== document.body;
    const bounds = nested ? scroller.getBoundingClientRect() : {top: 0, bottom: window.innerHeight};
    const top = Math.max(0, bounds.top) + 40;
    const bottom = Math.min(window.innerHeight, bounds.bottom) - 40;
    if (rect.top < top || rect.bottom > bottom) {
      const delta = rect.top < top ? rect.top - top : rect.bottom - bottom;
      (nested ? scroller : window).scrollBy({top: delta, left: 0, behavior: 'instant'});
    }
  }

  _highlightWord(element, sentenceText, charIndex, charLength, chunkOverride = null) {
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
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
    if (range) CSS.highlights.set('learnflow-word', new Highlight(range));
  }

  _clearHighlight() {
    const activeEls = (typeof ContentExtractor !== 'undefined' && ContentExtractor._querySelectorAllDeep)
      ? ContentExtractor._querySelectorAllDeep(document, '.learnflow-active-reading')
      : document.querySelectorAll('.learnflow-active-reading');
    activeEls.forEach(el => {
      el.classList.remove('learnflow-active-reading', 'learnflow-block-highlight');
    });
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
