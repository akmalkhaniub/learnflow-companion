/**
 * AutoNavigator - Detects sequential navigation buttons across O'Reilly,
 * Google Skills Boost, and documentation platforms to enable 100% hands-free reading.
 */
class AutoNavigator {
  /**
   * Find the "Next" button or link on the current page
   * @returns {HTMLElement|null}
   */
  static findNextTarget() {
    const siteType = ContentExtractor.getSiteType();

    if (siteType === 'oreilly') {
      const selectors = [
        'a[data-testid="next-link"]',
        'a.nav-link.next',
        'a.next-nav',
        'a[aria-label*="Next"]',
        'button[data-testid="next-chapter"]',
        '.interface-controls__next',
        'a[href*="/read/"][class*="next"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && this._isVisible(el)) return el;
      }
    }

    if (siteType === 'google_skills') {
      const selectors = [
        'button.js-next-step',
        'button[aria-label*="Next"]',
        'a.next-step',
        '.lab-content__next',
        'button:has(span:contains("Next"))',
        'button:has(span:contains("Continue"))'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && this._isVisible(el)) return el;
      }
    }

    // Generic fallbacks (documentation, tutorials, books)
    const genericSelectors = [
      'link[rel="next"]',
      'a[rel="next"]',
      'a.pagination__next',
      'a.next-page',
      'a.next',
      'button.next',
      'a[aria-label*="Next"]'
    ];

    for (const sel of genericSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Text content search fallback for "Next" or "Next Chapter"
    const candidates = Array.from(document.querySelectorAll('a, button'));
    for (const el of candidates) {
      const text = el.textContent.trim().toLowerCase();
      if ((text === 'next' || text === 'next chapter' || text === 'next lesson' || text.startsWith('next:')) && this._isVisible(el)) {
        return el;
      }
    }

    return null;
  }

  static _isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /**
   * Execute auto-navigation with countdown notification
   * @param {Function} onTick Callback every second (countdown)
   * @param {number} seconds
   */
  static async advanceToNext(onTick = null, seconds = 2) {
    const nextEl = this.findNextTarget();

    if (!nextEl) {
      console.log('[LearnFlow] No next chapter/step detected.');
      return false;
    }

    // Save state so next page auto-starts reading
    await chrome.storage.local.set({
      learnflow_auto_play_next: true,
      learnflow_last_navigated: Date.now()
    });

    console.log('[LearnFlow] Advancing to next section in', seconds, 'seconds:', nextEl);

    for (let i = seconds; i > 0; i--) {
      if (onTick) onTick(i);
      await new Promise(r => setTimeout(r, 1000));
    }

    if (nextEl.tagName.toLowerCase() === 'link') {
      window.location.href = nextEl.getAttribute('href');
    } else {
      nextEl.click();
    }

    return true;
  }

  /**
   * Check if we arrived here via auto-advance and should resume playing
   */
  static async checkAutoResume() {
    const data = await chrome.storage.local.get(['learnflow_auto_play_next', 'learnflow_last_navigated']);
    if (data.learnflow_auto_play_next) {
      // Clear flag once consumed
      await chrome.storage.local.set({ learnflow_auto_play_next: false });
      return true;
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.AutoNavigator = AutoNavigator;
}
