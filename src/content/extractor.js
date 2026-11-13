/**
 * ContentExtractor - Intelligent DOM and content isolation for O'Reilly,
 * Google Skills Boost (skills.google), YouTube, and generic documentation.
 * Enhanced with Code Block recognition for Smart Code Whisperer.
 */
class ContentExtractor {
  static getSiteType() {
    const host = window.location.hostname;
    if (host.includes('oreilly.com') || host.includes('learning.oreilly.com')) {
      return 'oreilly';
    }
    if (host.includes('skills.google') || host.includes('cloudskillsboost.google') || host.includes('qwiklabs.com')) {
      return 'google_skills';
    }
    if (host.includes('youtube.com')) {
      return 'youtube';
    }
    return 'generic';
  }

  /**
   * Extract comprehensive page metadata and primary content root
   */
  static extract() {
    const siteType = this.getSiteType();

    switch (siteType) {
      case 'oreilly':
        return this._extractOReilly();
      case 'google_skills':
        return this._extractGoogleSkills();
      case 'youtube':
        return this._extractYouTube();
      default:
        return this._extractGeneric();
    }
  }

  static _extractOReilly() {
    const contentSelectors = [
      '#sbo-rt-content',
      '.annotator-wrapper',
      'main#main-content',
      'div[data-testid="reader-content"]',
      'section[class*="chapter"]',
      'article'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        contentEl = el;
        break;
      }
    }

    const bookTitleEl = document.querySelector('header [data-testid="book-title"], .header-book-title, title');
    const chapterTitleEl = document.querySelector('h1, h2, [data-testid="chapter-title"]');

    const bookTitle = bookTitleEl ? bookTitleEl.textContent.trim() : document.title;
    const chapterTitle = chapterTitleEl ? chapterTitleEl.textContent.trim() : 'Chapter';

    return {
      type: 'oreilly',
      title: `${bookTitle} - ${chapterTitle}`,
      category: 'OReilly',
      bookTitle,
      chapterTitle,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractSentences(contentEl || document.body)
    };
  }

  static _extractGoogleSkills() {
    const contentSelectors = [
      '.lab-content',
      '.lab-content__inner',
      'div[data-testid="lab-instructions"]',
      'main.lab-step-content',
      '.step-content',
      'article',
      'main'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        contentEl = el;
        break;
      }
    }

    const titleEl = document.querySelector('h1.lab-title, h1, .headline-5, title');
    const title = titleEl ? titleEl.textContent.trim() : document.title;

    return {
      type: 'google_skills',
      title,
      category: 'GoogleSkills',
      bookTitle: 'Google Skills Tutorial',
      chapterTitle: title,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractSentences(contentEl || document.body)
    };
  }

  static _extractYouTube() {
    const videoTitleEl = document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title');
    const channelEl = document.querySelector('#owner #channel-name, ytd-channel-name a');
    const title = videoTitleEl ? videoTitleEl.textContent.trim() : document.title.replace(' - YouTube', '');
    const channel = channelEl ? channelEl.textContent.trim() : 'YouTube Channel';

    return {
      type: 'youtube',
      title: `${title} (${channel})`,
      category: 'YouTube',
      bookTitle: channel,
      chapterTitle: title,
      url: window.location.href,
      contentEl: document.querySelector('#primary-inner') || document.body,
      chunks: []
    };
  }

  static _extractGeneric() {
    const contentSelectors = [
      'article',
      'main',
      '.markdown-body',
      '.post-content',
      '.article-content',
      '#content',
      '.content'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) {
        contentEl = el;
        break;
      }
    }

    const title = document.querySelector('h1')?.textContent?.trim() || document.title;

    return {
      type: 'generic',
      title,
      category: 'WebArticles',
      bookTitle: window.location.hostname,
      chapterTitle: title,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractSentences(contentEl || document.body)
    };
  }

  /**
   * Breaks an element's text down into speakable sentence chunks & code blocks
   * with references back to DOM nodes for visual highlighting and Code Whisperer.
   */
  static _extractSentences(rootEl) {
    if (!rootEl) return [];

    const chunks = [];
    const elementsToRead = rootEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre');

    elementsToRead.forEach(el => {
      if (el.closest('nav, footer, header, [aria-hidden="true"], .sidebar')) {
        return;
      }

      // Check if it's a code block
      if (el.tagName.toLowerCase() === 'pre') {
        const codeText = el.textContent.trim();
        if (codeText.length > 5) {
          const lang = el.className.match(/lang(?:uage)?-(\w+)/)?.[1] || '';
          chunks.push({
            type: 'code',
            text: codeText,
            lang: lang,
            element: el,
            spokenText: null // filled dynamically by Code Whisperer
          });
        }
        return;
      }

      // Skip elements that are inside pre (handled above)
      if (el.closest('pre')) {
        return;
      }

      const text = el.textContent.trim();
      if (!text || text.length < 3) return;

      // Split into sentence-like segments
      const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];

      sentences.forEach(s => {
        const cleanText = s.trim().replace(/\s+/g, ' ');
        if (cleanText.length > 2) {
          chunks.push({
            type: 'text',
            text: cleanText,
            element: el
          });
        }
      });
    });

    return chunks;
  }
}

if (typeof window !== 'undefined') {
  window.ContentExtractor = ContentExtractor;
}
