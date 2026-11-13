/**
 * AudioPlayer - Browser-native Text-to-Speech Engine with sentence highlighting,
 * Smart Code Whisperer, Sleep/Pomodoro timer, speed controls, and auto-advance.
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

    // Advanced Features
    this.codeWhispererEnabled = true;
    this.sleepTimer = null;
    this.sleepRemainingSeconds = 0;
    this.sleepInterval = null;

    // Callbacks
    this.onStateChange = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onSleepTick = null;

    this._initVoices();
  }

  _initVoices() {
    const setVoice = () => {
      const voices = this.synth.getVoices();
      if (!voices.length) return;

      const preferred = voices.find(v => 
        (v.lang.startsWith('en')) && 
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
   * @param {number|null} minutes null cancels timer
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
        console.log('[LearnFlow] Sleep timer reached. Stopping audio.');
        this.stop();
        if (this.onSleepTick) this.onSleepTick(0);
      }
    }, 1000);
  }

  async _speakChunk(index) {
    if (index >= this.chunks.length) {
      this.stop();
      if (this.onComplete) {
        this.onComplete();
      }
      return;
    }

    const chunk = this.chunks[index];
    let textToSpeak = chunk.text;

    // Smart Code Whisperer: If code block, convert to spoken summary
    if (chunk.type === 'code') {
      if (!this.codeWhispererEnabled) {
        // Skip code block if disabled
        this.currentIndex++;
        this._speakChunk(this.currentIndex);
        return;
      }

      if (!chunk.spokenText) {
        if (typeof GeminiAI !== 'undefined') {
          chunk.spokenText = await GeminiAI.summarizeCodeBlock(chunk.text, chunk.lang);
        } else {
          chunk.spokenText = `Code block in ${chunk.lang || 'code'}.`;
        }
      }
      textToSpeak = chunk.spokenText;
    }

    this.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.selectedVoice) {
      this.currentUtterance.voice = this.selectedVoice;
    }
    this.currentUtterance.rate = this.rate;
    this.currentUtterance.pitch = this.pitch;

    this._highlightElement(chunk.element);
    this._notifyProgress();

    this.currentUtterance.onend = () => {
      if (!this.isPlaying) return;
      this.currentIndex++;
      this._speakChunk(this.currentIndex);
    };

    this.currentUtterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        this.currentIndex++;
        this._speakChunk(this.currentIndex);
      }
    };

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
    this.keepAliveTimer = setInterval(() => {
      if (this.isPlaying && !this.isPaused) {
        this.synth.pause();
        this.synth.resume();
      }
    }, 10000);
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
