/**
 * ContentExtractor - Intelligent main-content isolation for O'Reilly,
 * Google Cloud Skills Boost (skills.google), YouTube, and generic web articles.
 *
 * Key upgrades:
 * - Strictly excludes sidebars, TOCs, drawers, navs, and high-link-density menus
 * - Readability prose-density fallback scorer (never reads the sidebar!)
 * - Extracts Figures (with captions & <img> references for Vision AI narration)
 * - Extracts Tables (structured for natural spoken narration)
 * - Extracts Code blocks (for Smart Code Whisperer)
 */
class ContentExtractor {
  static EXCLUDED_ANCESTORS = [
    'nav', 'aside', 'footer', 'header', 'script', 'style', 'noscript',
    '#learnflow-player-root',
    '[aria-hidden="true"]',
    '[role="navigation"]', '[role="complementary"]', '[role="banner"]',
    '[role="search"]', '[role="dialog"]', '[role="menu"]', '[role="toolbar"]',
    '[class*="sidebar" i]', '[class*="toc" i]', '[class*="table-of-contents" i]',
    '[class*="drawer" i]', '[class*="nav-" i]', '[class*="-nav" i]',
    '[class*="menu" i]', '[class*="breadcrumb" i]', '[class*="header" i]',
    '[data-testid*="toc" i]', '[data-testid*="sidebar" i]', '[data-testid*="nav" i]',
    '.sr-only', '.visually-hidden'
  ].join(', ');

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
   * Extract comprehensive page metadata, isolated main content root, and ordered reading chunks
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
    // Prioritize O'Reilly's exact chapter content body containers (never the sidebar/TOC!)
    const contentSelectors = [
      '#sbo-rt-content',
      '.sbo-rt-content',
      '[data-testid="book-content"]',
      '[data-testid="reader-content"]',
      '#book-content',
      'section[data-type="chapter"]',
      'div[class*="ChapterContent"]',
      'div[class*="chapter-content"]',
      'div[class*="reader-content"]',
      '.annotator-wrapper',
      'article'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        if (this._isValidMainContent(el)) {
          contentEl = el;
          break;
        }
      }
      if (contentEl) break;
    }

    // Fallback to Readability prose-density scorer (strictly avoids TOC/sidebar!)
    if (!contentEl) {
      contentEl = this._findBestMainContent();
    }

    // Cleanly parse Book Title and Chapter Title from O'Reilly page title ("Chapter | Book Title")
    let bookTitle = 'OReilly Book';
    let chapterTitle = 'Chapter';

    const titleParts = (document.title || '').split(/\s+\|\s+|\s+-\s+O'Reilly/i).map(s => s.trim()).filter(Boolean);
    if (titleParts.length >= 2) {
      chapterTitle = titleParts[0];
      bookTitle = titleParts[1];
    } else if (titleParts.length === 1) {
      bookTitle = titleParts[0];
    }

    // Prefer chapter heading INSIDE contentEl (never grab sidebar H1!)
    if (contentEl) {
      const innerHeading = contentEl.querySelector('h1, h2');
      if (innerHeading && innerHeading.textContent.trim().length > 2) {
        chapterTitle = this._cleanText(innerHeading.textContent).trim();
      }
    }

    return {
      type: 'oreilly',
      title: `${chapterTitle} — ${bookTitle}`,
      category: 'OReilly',
      bookTitle,
      chapterTitle,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractChunks(contentEl)
    };
  }

  static _extractGoogleSkills() {
    const contentSelectors = [
      '.lab-content__inner',
      '.lab-content',
      'div[data-testid="lab-instructions"]',
      'main.lab-step-content',
      '.step-content',
      'ql-lab-page article',
      'article',
      'main'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (this._isValidMainContent(el)) {
        contentEl = el;
        break;
      }
    }

    if (!contentEl) {
      contentEl = this._findBestMainContent();
    }

    const innerHeading = contentEl?.querySelector('h1, h2');
    const titleEl = innerHeading || document.querySelector('h1.lab-title, h1, .headline-5');
    const title = titleEl ? this._cleanText(titleEl.textContent).trim() : document.title;

    return {
      type: 'google_skills',
      title,
      category: 'GoogleSkills',
      bookTitle: 'Google Skills Tutorials',
      chapterTitle: title,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractChunks(contentEl)
    };
  }

  static _extractYouTube() {
    const videoTitleEl = document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title');
    const channelEl = document.querySelector('#owner #channel-name, ytd-channel-name a');
    const title = videoTitleEl ? this._cleanText(videoTitleEl.textContent).trim() : document.title.replace(' - YouTube', '');
    const channel = channelEl ? this._cleanText(channelEl.textContent).trim() : 'YouTube Channel';

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
      '[role="main"]',
      'main',
      '.markdown-body',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
      '.content'
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (this._isValidMainContent(el)) {
        contentEl = el;
        break;
      }
    }

    if (!contentEl) {
      contentEl = this._findBestMainContent();
    }

    const innerH1 = contentEl?.querySelector('h1');
    const title = innerH1 ? this._cleanText(innerH1.textContent).trim() : (document.querySelector('h1')?.textContent?.trim() || document.title);

    return {
      type: 'generic',
      title,
      category: 'WebArticles',
      bookTitle: window.location.hostname.replace(/^www\./, ''),
      chapterTitle: title,
      url: window.location.href,
      contentEl: contentEl || document.body,
      chunks: this._extractChunks(contentEl)
    };
  }

  /**
   * Verify an element is visible, has substantial prose, and is NOT a sidebar/nav/TOC
   */
  static _isValidMainContent(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'learnflow-player-root') return false;
    try {
      if (el.matches(this.EXCLUDED_ANCESTORS) || el.closest(this.EXCLUDED_ANCESTORS)) {
        return false;
      }
    } catch {
      // ignore selector error
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 260 || rect.height < 100) return false;

    const paragraphs = el.querySelectorAll('p');
    const textLen = (el.innerText || el.textContent || '').trim().length;
    if (textLen < 180) return false;

    // Check link density: TOCs and sidebars are mostly <a> links!
    const linkDensity = this._getLinkDensity(el);
    if (linkDensity > 0.5 && paragraphs.length < 3) return false;

    return true;
  }

  /**
   * Readability-style prose density scorer to locate the real main reading area
   * while strictly ignoring TOCs, sidebars, drawers, and navigation chrome.
   */
  static _findBestMainContent() {
    const candidates = Array.from(document.querySelectorAll('main, article, section, div'));
    let bestEl = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (el === document.body || el.id === 'learnflow-player-root') continue;
      try {
        if (el.matches(this.EXCLUDED_ANCESTORS) || el.closest(this.EXCLUDED_ANCESTORS)) continue;
      } catch {
        continue;
      }

      const rect = el.getBoundingClientRect();
      // Main reading column must be reasonably wide and visible
      if (rect.width < 320 || rect.height < 150) continue;

      const paragraphs = Array.from(el.querySelectorAll('p'));
      if (paragraphs.length < 2) continue;

      let pTextLen = 0;
      for (const p of paragraphs) {
        if (p.closest(this.EXCLUDED_ANCESTORS)) continue;
        pTextLen += (p.textContent || '').trim().length;
      }

      if (pTextLen < 200) continue;

      const linkDensity = this._getLinkDensity(el);
      if (linkDensity > 0.45) continue; // Skip TOCs and link lists

      // Score favors rich paragraph prose with low link density and tight container wrapping
      const totalLen = Math.max(1, (el.textContent || '').trim().length);
      const proseRatio = pTextLen / totalLen;
      const score = pTextLen * (1 - linkDensity) * (0.5 + proseRatio);

      // Slightly prefer narrower/more specific container if scores are nearly tied
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    return bestEl || document.querySelector('main, article') || document.body;
  }

  static _getLinkDensity(el) {
    const totalLen = (el.textContent || '').trim().length;
    if (totalLen === 0) return 1;
    let linkLen = 0;
    el.querySelectorAll('a').forEach(a => {
      linkLen += (a.textContent || '').trim().length;
    });
    return linkLen / totalLen;
  }

  static _cleanText(text) {
    return (text || '')
      .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /**
   * Breaks main content into an ordered reading queue containing:
   * - text sentences (with DOM element for karaoke highlighting)
   * - figures / images (with caption & imgEl for Vision narration)
   * - tables (structured spoken rows)
   * - code blocks (for Smart Code Whisperer)
   */
  static _extractChunks(rootEl) {
    if (!rootEl) return [];

    const chunks = [];
    const visitedNodes = new Set();

    // Query in strict DOM document order
    const elements = rootEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figure, img, table');

    elements.forEach(el => {
      // Skip if inside an excluded navigation/sidebar/TOC/widget container
      try {
        if (el.matches(this.EXCLUDED_ANCESTORS) || el.closest(this.EXCLUDED_ANCESTORS)) {
          return;
        }
      } catch {
        // ignore
      }

      // Skip hidden elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      // Skip if already consumed by a parent block (table, pre, figure)
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== rootEl) {
        if (visitedNodes.has(ancestor)) return;
        ancestor = ancestor.parentElement;
      }

      const tag = el.tagName.toLowerCase();

      // 1. CODE BLOCK
      if (tag === 'pre') {
        visitedNodes.add(el);
        const codeText = this._cleanText(el.textContent).trim();
        if (codeText.length > 5) {
          const codeChild = el.querySelector('code');
          const cls = (el.className || '') + ' ' + (codeChild?.className || '');
          const lang = cls.match(/lang(?:uage)?-([a-zA-Z0-9+#_-]+)/)?.[1] || '';
          chunks.push({
            type: 'code',
            text: codeText,
            lang,
            element: el,
            spokenText: null
          });
        }
        return;
      }

      // 2. TABLE
      if (tag === 'table') {
        visitedNodes.add(el);
        const { spokenFallback, rawTableText } = this._parseTableForSpeech(el);
        if (spokenFallback) {
          chunks.push({
            type: 'table',
            text: spokenFallback,
            rawTableText,
            element: el,
            spokenText: null
          });
        }
        return;
      }

      // 3. FIGURE / IMAGE
      if (tag === 'figure' || tag === 'img') {
        const imgEl = tag === 'img' ? el : el.querySelector('img');
        if (!imgEl) return;

        // Ignore tiny decorative icons / spacers
        const rect = imgEl.getBoundingClientRect();
        const natW = imgEl.naturalWidth || rect.width;
        const natH = imgEl.naturalHeight || rect.height;
        if (natW < 80 && natH < 80) return;

        visitedNodes.add(el);
        if (imgEl !== el) visitedNodes.add(imgEl);

        let caption = '';
        if (tag === 'figure') {
          const figcap = el.querySelector('figcaption');
          if (figcap) caption = this._cleanText(figcap.textContent).trim();
        }
        const alt = this._cleanText(imgEl.getAttribute('alt') || '').trim();

        // Check if next sibling is a Figure caption heading/paragraph (common on O'Reilly!)
        const nextSib = el.nextElementSibling;
        if (!caption && nextSib && /^figure\s+\d/i.test((nextSib.textContent || '').trim())) {
          caption = this._cleanText(nextSib.textContent).trim();
        }

        const label = caption || (alt && alt.toLowerCase() !== 'illustration' ? alt : 'Diagram');

        chunks.push({
          type: 'figure',
          caption: label,
          alt,
          imgEl,
          text: `Figure: ${label}`,
          element: el,
          spokenText: null
        });
        return;
      }

      // 4. LIST ITEM (Skip pure navigation/TOC links)
      if (tag === 'li') {
        const text = this._cleanText(el.textContent).trim();
        if (!text || text.length < 3) return;
        // Skip if LI is just a single navigation link with no descriptive sentence
        const links = el.querySelectorAll('a');
        if (links.length === 1 && links[0].textContent.trim().length >= text.length * 0.9 && text.length < 80) {
          // Allow chapter outline bullet lists, skip TOC/menu links that have hrefs to other chapters
          const href = links[0].getAttribute('href') || '';
          if (href && !href.startsWith('#')) return;
        }
      }

      // 5. NORMAL PROSE / HEADING
      // Avoid double-reading if a <li> contains <p> children (let the <p> handle it)
      if ((tag === 'li' || tag === 'blockquote') && el.querySelector('p')) {
        return;
      }

      const text = this._cleanText(el.textContent).trim();
      if (!text || text.length < 3) return;

      // Keep exact DOM offsets so repeated sentences and inline markup highlight correctly.
      const rawText = el.textContent || '';
      const sentences = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(document.documentElement.lang || 'en', { granularity: 'sentence' }).segment(rawText))
        : Array.from(rawText.matchAll(/[^.!?]+(?:[.!?]+(?:["”’']+)?(?=\s|$)|$)/g), match => ({ segment: match[0], index: match.index }));
      for (const sentence of sentences) {
        const leading = sentence.segment.length - sentence.segment.trimStart().length;
        const trimmed = sentence.segment.trim();
        const spoken = this._cleanText(trimmed).trim();
        if (!spoken) continue;
        chunks.push({ type: 'text', text: spoken, element: el,
          textStart: sentence.index + leading,
          textEnd: sentence.index + leading + trimmed.length });
      }
    });

    return chunks;
  }

  /**
   * Build clean spoken text and raw markdown summary for HTML tables
   */
  static _parseTableForSpeech(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (!rows.length) return { spokenFallback: '', rawTableText: '' };

    const matrix = rows.map(r =>
      Array.from(r.querySelectorAll('th, td')).map(c => this._cleanText(c.textContent).trim())
    ).filter(r => r.some(cell => cell.length > 0));

    if (!matrix.length) return { spokenFallback: '', rawTableText: '' };

    const headers = matrix[0];
    const spokenParts = ['Table summary.'];

    for (let i = 1; i < Math.min(matrix.length, 8); i++) {
      const row = matrix[i];
      const rowDesc = row.map((val, colIdx) => {
        const h = headers[colIdx] || `Column ${colIdx + 1}`;
        return val ? `${h}: ${val}` : '';
      }).filter(Boolean).join('. ');
      if (rowDesc) spokenParts.push(rowDesc);
    }

    if (matrix.length > 8) {
      spokenParts.push(`And ${matrix.length - 8} more rows.`);
    }

    const rawTableText = matrix.map(r => r.join(' | ')).join('\n');
    return {
      spokenFallback: spokenParts.join(' '),
      rawTableText
    };
  }
}

if (typeof window !== 'undefined') {
  window.ContentExtractor = ContentExtractor;
}
