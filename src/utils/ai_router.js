/**
 * AIRouter - Pluggable AI Provider router for LearnFlow.
 * Allows switching seamlessly in Settings between:
 *   - 'firebase_ai_logic': Firebase AI Logic (Hybrid: Gemini Nano on-device + Cloud fallback + App Check)
 *   - 'direct_gemini': Existing GeminiAI (direct Chrome window.ai + Gemini REST API key)
 *   - Future providers registered via AIRouter.registerProvider(id, provider)
 */
class AIRouter {
  static _providers = new Map();
  static _defaultProviderId = 'firebase_ai_logic';

  static registerProvider(id, provider) {
    if (id && provider) {
      this._providers.set(id, provider);
    }
  }

  static listProviders() {
    return [
      { id: 'firebase_ai_logic', label: 'Firebase AI Logic (Hybrid: On-Device + Cloud)' },
      { id: 'direct_gemini', label: 'Direct Gemini (Developer Fallback — API Key / Nano)' }
    ];
  }

  static async getActiveProviderId() {
    try {
      const data = await chrome.storage.local.get(['learnflow_ai_provider']);
      return data.learnflow_ai_provider || this._defaultProviderId;
    } catch {
      return this._defaultProviderId;
    }
  }

  static async setActiveProviderId(providerId) {
    await chrome.storage.local.set({ learnflow_ai_provider: providerId });
  }

  static _isExtensionContext() {
    return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  }

  static async _bridgeToBackground(method, args = []) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'AI_ROUTER_CALL', method, args }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (res && res.error) {
          reject(new Error(res.error));
          return;
        }
        resolve(res?.result);
      });
    });
  }

  static async _invoke(method, args = []) {
    const providerId = await this.getActiveProviderId();

    // Direct Gemini runs locally in any context (preserves original GeminiAI behavior)
    if (providerId === 'direct_gemini') {
      if (typeof GeminiAI === 'undefined') {
        throw new Error('Direct Gemini provider is not loaded.');
      }
      const res = await GeminiAI[method](...args);
      if (method !== 'isAvailable' && method !== 'checkNanoAvailability') {
        try {
          const st = await GeminiAI.isAvailable();
          await chrome.storage.local.set({
            learnflow_last_ai_meta: {
              provider: 'direct_gemini',
              route: st.mode === 'nano' ? 'on-device' : 'cloud',
              model: st.mode === 'nano' ? 'gemini-nano' : 'gemini-direct-api',
              timestamp: Date.now()
            }
          });
        } catch {}
      }
      return res;
    }

    // Custom registered non-built-in provider
    const custom = this._providers.get(providerId);
    if (custom && typeof custom[method] === 'function') {
      return custom[method](...args);
    }

    // Firebase AI Logic: run directly in extension pages (Side Panel / SW),
    // or bridge from content scripts so App Check runs on the chrome-extension:// origin.
    if (typeof FirebaseAIProvider !== 'undefined' && this._isExtensionContext()) {
      return FirebaseAIProvider[method](...args);
    }
    return this._bridgeToBackground(method, args);
  }

  static isAvailable() {
    return this._invoke('isAvailable');
  }

  static query(prompt, contextText = '') {
    return this._invoke('query', [prompt, contextText]);
  }

  static describeFigure(base64DataUrl, captionText = '', contextText = '') {
    return this._invoke('describeFigure', [base64DataUrl, captionText, contextText]);
  }

  static summarizeTable(tableText, captionText = '') {
    return this._invoke('summarizeTable', [tableText, captionText]);
  }

  static generateAudioBrief(content) {
    return this._invoke('generateAudioBrief', [content]);
  }

  static summarizeCodeBlock(codeSnippet, language = '') {
    return this._invoke('summarizeCodeBlock', [codeSnippet, language]);
  }

  static generateSectionQuiz(sectionText) {
    return this._invoke('generateSectionQuiz', [sectionText]);
  }

  static generateAnkiCards(content) {
    return this._invoke('generateAnkiCards', [content]);
  }

  static searchVault(vaultItems, userQuery) {
    return this._invoke('searchVault', [vaultItems, userQuery]);
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.AIRouter = AIRouter;
}
