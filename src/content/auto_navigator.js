/** Sequential chapter navigation, scoped to this browser tab. */
class AutoNavigator {
  static findNextTarget() {
    if (this.chosen?.page === this._canonical(location.href) && this.chosen.element.isConnected && this._isUsable(this.chosen.element)) return this.chosen.element;
    const selectors = [
      'a[rel="next"]', 'link[rel="next"]', 'a[data-testid="next-link"]',
      'button[data-testid="next-chapter"]', 'a[data-testid*="next" i]',
      'a.nav-link.next', 'a.next-nav', '.interface-controls__next',
      'button.js-next-step', 'a.next-step', '.lab-content__next',
      'a.pagination__next', 'a.next-page', 'a.next', 'button.next',
      'a[aria-label*="next" i]', 'button[aria-label*="next" i]',
      'a[title*="next" i]', 'button[title*="next" i]',
      '[role="button"][aria-label*="next" i]', '[data-testid*="next" i]'
    ];
    const deepQuery = (root, sel) => (typeof ContentExtractor !== 'undefined' && ContentExtractor._querySelectorAllDeep)
      ? ContentExtractor._querySelectorAllDeep(root, sel)
      : Array.from(root.querySelectorAll(sel));

    const interactiveSel = 'a, button, link, [role=button], ql-button, md-filled-button, md-text-button, md-outlined-button';
    for (const selector of selectors) {
      for (const el of deepQuery(document, selector)) {
        const target = el.matches(interactiveSel) ? el : el.closest(interactiveSel) || el.querySelector(interactiveSel);
        if (target && this._isUsable(target)) return target;
      }
    }
    for (const el of deepQuery(document, interactiveSel)) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (/^(next|continue)(?:\s|[:→›»]|$)/i.test(text) && this._isUsable(el)) return el;
    }
    // Check same-origin iframes (e.g. skills.google embedded document/lab frames)
    for (const frame of deepQuery(document, 'iframe')) {
      try {
        const fdoc = frame.contentDocument;
        if (!fdoc) continue;
        for (const el of deepQuery(fdoc, interactiveSel)) {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if ((/^next(?:\s|[:→›»]|$)/i.test(text) || el.matches('[aria-label*="next" i], a[rel="next"]')) && this._isUsable(el)) {
            return el;
          }
        }
      } catch {}
    }
    // Use actual ordered book TOC links, never invent the next chapter URL.
    const current = new URL(location.href);
    if (current.hostname === 'learning.oreilly.com') {
      const bookPrefix = current.pathname.slice(0, current.pathname.lastIndexOf('/') + 1);
      for (const nav of document.querySelectorAll('nav, aside, [role=navigation], [data-testid*="toc" i]')) {
        const chapters = [];
        for (const link of nav.querySelectorAll('a[href]')) {
          const url = new URL(link.href, location.href);
          if (url.origin !== current.origin || !url.pathname.startsWith(bookPrefix)) continue;
          if (!chapters.some(entry => this._canonical(entry.href) === this._canonical(url.href))) chapters.push(link);
        }
        const index = chapters.findIndex(link => this._canonical(link.href) === this._canonical(location.href));
        if (index >= 0 && chapters[index + 1]) return chapters[index + 1];
      }
    }
    return null;
  }

  static choose(element) {
    if (!this._isUsable(element)) throw new Error('Choose an enabled Next button or a link to another page.');
    this.chosen = {page: this._canonical(location.href), element};
  }

  static status() {
    const target = this.findNextTarget();
    if (!target) return 'No Next link detected. Use Choose Next, then click the book’s Next control.';
    const label = (target.getAttribute('aria-label') || target.textContent || target.getAttribute('href') || 'Next page').trim().replace(/\s+/g, ' ').slice(0, 100);
    return `Next detected: ${label}`;
  }

  static _canonical(url) {
    const parsed = new URL(url, window.location.href);
    return parsed.origin + parsed.pathname + parsed.search;
  }

  static _isUsable(el) {
    if (el.closest('#learnflow-player-root') || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.tagName.toLowerCase() !== 'link' && !(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
    const href = el.getAttribute('href');
    if (href !== null) {
      try {
        const target = new URL(href, window.location.href);
        if (!/^https?:$/.test(target.protocol) || this._canonical(target.href) === this._canonical(window.location.href)) return false;
      } catch { return false; }
    }
    return true;
  }

  static async advanceToNext(onTick = null, seconds = 2) {
    const nextEl = this.findNextTarget();
    if (!nextEl) return false;
    for (let i = seconds; i > 0; i--) {
      if (onTick) onTick(i);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!nextEl.isConnected || nextEl.disabled || nextEl.getAttribute('aria-disabled') === 'true') return false;
    const href = nextEl.getAttribute('href');
    sessionStorage.setItem('learnflow_navigation', JSON.stringify({
      from: this._canonical(window.location.href),
      to: href ? this._canonical(href) : null,
      content: (document.querySelector('#sbo-rt-content, article, main')?.textContent || '').slice(0, 12000),
      timestamp: Date.now()
    }));
    // Keep navigation in the reader's tab, even if the site link targets _blank.
    if (href) window.location.assign(new URL(href, window.location.href).href);
    else {
      nextEl.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      const pending = JSON.parse(sessionStorage.getItem('learnflow_navigation') || 'null');
      const content = (document.querySelector('#sbo-rt-content, article, main')?.textContent || '').slice(0, 12000);
      if (pending && this._canonical(location.href) === pending.from && pending.content === content) {
        sessionStorage.removeItem('learnflow_navigation');
        return false;
      }
    }
    return true;
  }

  static async checkAutoResume() {
    try {
      const pending = JSON.parse(sessionStorage.getItem('learnflow_navigation') || 'null');
      if (!pending) return false;
      if (Date.now() - pending.timestamp > 120000) {
        sessionStorage.removeItem('learnflow_navigation');
        return false;
      }
      const current = this._canonical(window.location.href);
      const contentChanged = pending.content !== undefined && pending.content !== (document.querySelector('#sbo-rt-content, article, main')?.textContent || '').slice(0, 12000);
      if ((current === pending.from && !contentChanged) || (pending.to && current !== pending.to)) return false;
      sessionStorage.removeItem('learnflow_navigation');
      return true;
    } catch { return false; }
  }
}
if (typeof window !== 'undefined') window.AutoNavigator = AutoNavigator;
