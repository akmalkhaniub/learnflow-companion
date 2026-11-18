/**
 * AudioPlayer - Browser-native Text-to-Speech Engine with sentence highlighting,
 * Smart Code Whisperer, Figure Vision Narration, Table Narration, Sleep/Pomodoro timer,
 * Alt+Click jump-to-paragraph, and auto-advance.
 */
class AudioPlayer {
  constructor() {
    this.synth = window.speechSynthesis;
    this.chunks = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.selectedVoice = null;
    this.currentUtterance = null;
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

    this.synth.cancel();
    this.currentIndex = idx;
    this.isPlaying = true;
    this.isPaused = false;
    this._startKeepAlive();
    this._notifyState();
    this._speakChunk(this.currentIndex);
    return true;
  }

  /**
   * Move to a saved position without speaking (used to restore reading progress)
   */
  seekTo(index) {
    if (!this.chunks.length) return;
    this.currentIndex = Math.max(0, Math.min(index, this.chunks.length - 1));
    this._highlightElement(this.chunks[this.currentIndex]?.element);
    if (this.onProgress) {
      this.onProgress({
        current: this.currentIndex + 1,
        total: this.chunks.length,
        percent: Math.round(((this.currentIndex + 1) / this.chunks.length) * 100)
      });
    }
  }

  play() {
    if (!this.chunks.length) return;

    if (this.isPaused) {
      this.synth.resume();
      this.isPaused = false;
      this.isPlaying = true;
      this._startKeepAlive();
      this._notifyState();
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
      this.synth.pause();
      this.isPaused = true;
      this.isPlaying = false;
      this._stopKeepAlive();
      this._notifyState();
    }
  }

  stop() {
    this.synth.cancel();
    this._stopKeepAlive();
    this._clearHighlight();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this._notifyState();
  }

  next() {
    if (this.currentIndex < this.chunks.length - 1) {
      this.synth.cancel();
      this.currentIndex++;
      if (this.isPlaying) {
        this._speakChunk(this.currentIndex);
      } else {
        this._highlightElement(this.chunks[this.currentIndex]?.element);
        this._notifyProgress();
      }
    }
  }

  previous() {
    if (this.currentIndex > 0) {
      this.synth.cancel();
      this.currentIndex--;
      if (this.isPlaying) {
        this._speakChunk(this.currentIndex);
      } else {
        this._highlightElement(this.chunks[this.currentIndex]?.element);
        this._notifyProgress();
      }
    }
  }

  setRate(newRate) {
    this.rate = Math.max(0.6, Math.min(1.6, newRate));
    if (this.isPlaying) {
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
    if (!this.isPlaying) return;

    if (index >= this.chunks.length) {
      this.stop();
      if (this.onComplete) {
        this.onComplete();
      }
      return;
    }

    const chunk = this.chunks[index];
    this._highlightElement(chunk.element);
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
        if (!this.isPlaying) return; // User stopped while awaiting AI
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

      if (!chunk.spokenText) {
        let visionDesc = null;
        if (typeof GeminiAI !== 'undefined' && typeof MarkdownBuilder !== 'undefined' && chunk.imgEl) {
          const status = await GeminiAI.isAvailable();
          if (status.mode === 'cloud') {
            if (this.onStatusMessage) this.onStatusMessage('Describing figure...');
            const src = chunk.imgEl.src || chunk.imgEl.getAttribute('src') || '';
            const dataUrl = src.startsWith('data:image/')
              ? src
              : await MarkdownBuilder.captureImageAsDataUrl(new URL(src, window.location.href).href, chunk.imgEl);
            if (dataUrl) {
              visionDesc = await GeminiAI.describeFigure(dataUrl, chunk.caption);
            }
          }
        }
        if (!this.isPlaying) return;
        chunk.spokenText = visionDesc
          ? `${chunk.caption}. ${visionDesc}`
          : `Figure: ${chunk.caption}.`;
      }
      textToSpeak = chunk.spokenText;
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
        if (!this.isPlaying) return;
        chunk.spokenText = tableSummary || chunk.text;
      }
      textToSpeak = chunk.spokenText;
    }

    if (!this.isPlaying) return;

    // Pre-fetch Gemini summaries for the next 2 upcoming code/figure/table chunks in background
    this._prefetchUpcoming(index);

    this.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.selectedVoice) {
      this.currentUtterance.voice = this.selectedVoice;
    }
    this.currentUtterance.rate = this.rate;
    this.currentUtterance.pitch = this.pitch;

    this.currentUtterance.onboundary = (event) => {
      if (!this.isPlaying || chunk.type !== 'text' || !chunk.element) return;
      if (event.name === 'word') {
        this._highlightWord(chunk.element, textToSpeak, event.charIndex, event.charLength);
      }
    };

    this.currentUtterance.onend = () => {
      if (!this.isPlaying) return;
      this.currentIndex++;
      this._speakChunk(this.currentIndex);
    };

    this.currentUtterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('[LearnFlow TTS] error, skipping segment:', e.error);
      this.currentIndex++;
      this._speakChunk(this.currentIndex);
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
      } else if (nextChunk.type === 'figure' && this.figureNarrationEnabled && nextChunk.imgEl && typeof MarkdownBuilder !== 'undefined') {
        nextChunk._prefetching = true;
        GeminiAI.isAvailable().then(async (status) => {
          if (status.mode !== 'cloud') return;
          const src = nextChunk.imgEl.src || nextChunk.imgEl.getAttribute('src') || '';
          const dataUrl = src.startsWith('data:image/')
            ? src
            : await MarkdownBuilder.captureImageAsDataUrl(new URL(src, window.location.href).href, nextChunk.imgEl);
          if (dataUrl) {
            const desc = await GeminiAI.describeFigure(dataUrl, nextChunk.caption);
            if (desc) nextChunk.spokenText = `${nextChunk.caption}. ${desc}`;
          }
        }).catch(() => {});
      }
    }
  }

  _highlightElement(element) {
    this._clearHighlight();
    if (!element) return;

    element.classList.add('learnflow-active-reading');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Real-time word-by-word karaoke highlighting using Chrome's CSS Custom Highlight API
   * (zero DOM mutation, safe for React/O'Reilly pages).
   */
  _highlightWord(element, sentenceText, charIndex, charLength) {
    if (typeof CSS === 'undefined' || !CSS.highlights || !element) return;

    try {
      // Build flat text map of all text nodes inside element
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let fullText = '';
      let n;
      while ((n = walker.nextNode())) {
        if (!n.nodeValue) continue;
        nodes.push({ node: n, start: fullText.length, end: fullText.length + n.nodeValue.length });
        fullText += n.nodeValue;
      }
      if (!nodes.length) return;

      // Locate the sentence inside the paragraph
      const prefix = sentenceText.slice(0, Math.min(24, sentenceText.length)).replace(/\s+/g, ' ').trim();
      let sentOffset = fullText.indexOf(prefix);
      if (sentOffset === -1) {
        // Fallback: case-insensitive first-word match near start
        sentOffset = 0;
      }

      const wordStart = sentOffset + charIndex;
      let wordLen = charLength;
      if (!wordLen || wordLen <= 0) {
        const tail = sentenceText.slice(charIndex);
        const m = tail.match(/^\S+/);
        wordLen = m ? m[0].length : 1;
      }
      const wordEnd = Math.min(fullText.length, wordStart + wordLen);
      if (wordStart < 0 || wordStart >= fullText.length || wordEnd <= wordStart) return;

      const makeRange = (startIdx, endIdx) => {
        const range = document.createRange();
        let startSet = false;
        for (const item of nodes) {
          if (!startSet && startIdx >= item.start && startIdx <= item.end) {
            range.setStart(item.node, startIdx - item.start);
            startSet = true;
          }
          if (startSet && endIdx >= item.start && endIdx <= item.end) {
            range.setEnd(item.node, endIdx - item.start);
            return range;
          }
        }
        return null;
      };

      const wordRange = makeRange(wordStart, wordEnd);
      if (wordRange) {
        CSS.highlights.set('learnflow-word', new Highlight(wordRange));
      }
    } catch {
      // Ignore range edge cases gracefully
    }
  }

  _clearHighlight() {
    document.querySelectorAll('.learnflow-active-reading').forEach(el => {
      el.classList.remove('learnflow-active-reading');
    });
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('learnflow-word');
      CSS.highlights.delete('learnflow-sentence');
    }
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
    if (this.onChunkStart) this.onChunkStart(this.currentIndex, this.chunks[this.currentIndex]);
    if (this.onProgress) {
      this.onProgress({
        current: this.currentIndex + 1,
        total: this.chunks.length,
        percent: this.chunks.length ? Math.round(((this.currentIndex + 1) / this.chunks.length) * 100) : 0
      });
    }
  }
}

if (typeof window !== 'undefined') {
  window.AudioPlayer = AudioPlayer;
}
