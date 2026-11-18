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

      const preferred = voices.find(v =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Online') || v.name.includes('Neural'))
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

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
    this.rate = Math.max(0.5, Math.min(2.5, newRate));
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

    this.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.selectedVoice) {
      this.currentUtterance.voice = this.selectedVoice;
    }
    this.currentUtterance.rate = this.rate;
    this.currentUtterance.pitch = this.pitch;

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

  _highlightElement(element) {
    this._clearHighlight();
    if (!element) return;

    element.classList.add('learnflow-active-reading');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  _clearHighlight() {
    document.querySelectorAll('.learnflow-active-reading').forEach(el => {
      el.classList.remove('learnflow-active-reading');
    });
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
