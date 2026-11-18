/**
 * MarkdownBuilder - Converts HTML DOM elements into clean, human-readable Markdown
 * with separate image asset extraction (no inline base64 gibberish), clean tables,
 * sanitized formatting, and authenticated O'Reilly image capture.
 */
class MarkdownBuilder {
  /**
   * Convert an HTML element into clean GitHub-flavored Markdown + extracted image files
   * @param {HTMLElement} rootElement
   * @param {Object} options { extractImages: boolean, imagePrefix: string }
   * @returns {Promise<{ markdown: string, images: Array<{ filename: string, dataUrl: string, alt: string }> }>}
   */
  static async elementToMarkdownWithAssets(rootElement, options = {}) {
    const opts = {
      extractImages: true,
      imagePrefix: 'fig_',
      ...options
    };

    if (!rootElement) {
      return { markdown: '', images: [] };
    }

    // Build a map of live <img> elements by src so we can read loaded pixels via canvas if fetch is blocked
    const liveImgMap = new Map();
    rootElement.querySelectorAll('img').forEach(img => {
      if (img.src) liveImgMap.set(img.src, img);
      const rawSrc = img.getAttribute('src');
      if (rawSrc) liveImgMap.set(rawSrc, img);
    });

    const clone = rootElement.cloneNode(true);

    // Aggressively remove UI chrome, sidebars, TOCs, buttons, and our own widget
    const removeSelectors = [
      'script', 'style', 'noscript', 'nav', 'footer', 'aside', 'iframe',
      'button', 'input', 'select', 'textarea',
      '#learnflow-player-root',
      '[role="navigation"]', '[role="complementary"]', '[role="banner"]',
      '[role="search"]', '[role="dialog"]', '[role="menu"]', '[role="toolbar"]',
      '[aria-hidden="true"]',
      '[class*="sidebar" i]', '[class*="toc" i]', '[class*="drawer" i]',
      '[data-testid*="toc" i]', '[data-testid*="sidebar" i]',
      '[class*="copy-button" i]', '[class*="copyButton" i]',
      '.ad', '.ads', '.sr-only', '.visually-hidden'
    ];

    removeSelectors.forEach(sel => {
      try {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      } catch {
        // Ignore unsupported selector syntax
      }
    });

    const state = {
      images: [],
      imgCounter: 0,
      liveImgMap,
      opts
    };

    const rawMd = await this._processNode(clone, state);
    const cleanedMd = this._cleanupMarkdown(rawMd);

    return {
      markdown: cleanedMd,
      images: state.images
    };
  }

  /**
   * Backward-compatible helper returning only Markdown string
   */
  static async elementToMarkdown(rootElement, options = {}) {
    const res = await this.elementToMarkdownWithAssets(rootElement, options);
    return res.markdown;
  }

  static _cleanText(text) {
    return (text || '')
      .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '') // Strip invisible soft hyphens & zero-width chars
      .replace(/\u00A0/g, ' ') // Non-breaking spaces -> normal space
      .replace(/\s+/g, ' ');
  }

  static _cleanupMarkdown(md) {
    return (md || '')
      .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '')
      // Fix accidental broken emphasis like *word**s* or **word*s**
      .replace(/\*{4,}/g, '**')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+\n/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  static async _processNode(node, state) {
    if (node.nodeType === Node.TEXT_NODE) {
      return this._cleanText(node.textContent);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tagName = node.tagName.toLowerCase();

    // Table conversion
    if (tagName === 'table') {
      return '\n\n' + this._tableToMarkdown(node) + '\n\n';
    }

    // Image conversion
    if (tagName === 'img') {
      return await this._imgToMarkdown(node, state);
    }

    // Figure container
    if (tagName === 'figure') {
      const img = node.querySelector('img');
      const captionEl = node.querySelector('figcaption');
      const caption = captionEl ? this._cleanText(captionEl.textContent).trim() : '';
      let md = '\n\n';
      if (img) {
        md += await this._imgToMarkdown(img, state, caption);
      }
      if (caption) {
        md += `\n*${caption}*\n\n`;
      }
      return md + '\n';
    }

    // Pre & Code blocks
    if (tagName === 'pre') {
      const code = (node.textContent || '')
        .replace(/[\u00AD\u200B\uFEFF]/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
      if (!code) return '';
      const codeChild = node.querySelector('code');
      const cls = (node.className || '') + ' ' + (codeChild?.className || '');
      const lang = cls.match(/lang(?:uage)?-([a-zA-Z0-9+#_-]+)/)?.[1] || '';
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    if (tagName === 'code') {
      const text = this._cleanText(node.textContent).trim();
      return text ? `\`${text}\`` : '';
    }

    // Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = '#'.repeat(parseInt(tagName[1], 10));
      const text = this._cleanText(node.textContent).trim();
      if (!text) return '';
      return `\n\n${level} ${text}\n\n`;
    }

    // Paragraphs
    if (tagName === 'p') {
      const childrenText = (await this._processChildren(node, state)).trim();
      if (!childrenText) return '';
      return `\n\n${childrenText}\n\n`;
    }

    // Line break
    if (tagName === 'br') {
      return '\n';
    }

    // Lists
    if (tagName === 'ul') {
      let result = '\n\n';
      for (const li of node.children) {
        if (li.tagName.toLowerCase() === 'li') {
          const itemText = (await this._processChildren(li, state)).trim().replace(/\n+/g, ' ');
          if (itemText) result += `- ${itemText}\n`;
        }
      }
      return result + '\n';
    }

    if (tagName === 'ol') {
      let result = '\n\n';
      let idx = 1;
      for (const li of node.children) {
        if (li.tagName.toLowerCase() === 'li') {
          const itemText = (await this._processChildren(li, state)).trim().replace(/\n+/g, ' ');
          if (itemText) {
            result += `${idx}. ${itemText}\n`;
            idx++;
          }
        }
      }
      return result + '\n';
    }

    // Blockquote
    if (tagName === 'blockquote') {
      const text = (await this._processChildren(node, state)).trim();
      if (!text) return '';
      return `\n\n> ${text.replace(/\n+/g, '\n> ')}\n\n`;
    }

    // Links
    if (tagName === 'a') {
      const href = node.getAttribute('href') || '';
      const linkText = (await this._processChildren(node, state)).trim();
      if (!linkText) return '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return linkText;
      }
      try {
        const absHref = new URL(href, window.location.href).href;
        return `[${linkText}](${absHref})`;
      } catch {
        return linkText;
      }
    }

    // Strong / Bold (preserve outer spaces, avoid nested broken markers)
    if (tagName === 'strong' || tagName === 'b') {
      const raw = await this._processChildren(node, state);
      const trimmed = raw.trim().replace(/\*\*/g, '');
      if (!trimmed) return raw;
      const lead = raw.match(/^\s*/)?.[0] || '';
      const trail = raw.match(/\s*$/)?.[0] || '';
      return `${lead}**${trimmed}**${trail}`;
    }

    // Emphasis / Italic (preserve outer spaces, avoid broken *word**s*)
    if (tagName === 'em' || tagName === 'i') {
      const raw = await this._processChildren(node, state);
      const trimmed = raw.trim().replace(/^\*+|\*+$/g, '');
      if (!trimmed) return raw;
      const lead = raw.match(/^\s*/)?.[0] || '';
      const trail = raw.match(/\s*$/)?.[0] || '';
      // If it's only a 1-char fragment split by bad HTML (e.g. "g" inside em), just return cleanly
      if (trimmed.length <= 2 && /^[a-zA-Z]$/.test(trimmed)) {
        return raw;
      }
      return `${lead}*${trimmed}*${trail}`;
    }

    // Horizontal Rule
    if (tagName === 'hr') {
      return '\n\n---\n\n';
    }

    return await this._processChildren(node, state);
  }

  static async _processChildren(node, state) {
    let result = '';
    for (const child of node.childNodes) {
      result += await this._processNode(child, state);
    }
    return result;
  }

  /**
   * Convert an HTML <table> into clean GitHub-flavored Markdown table syntax
   */
  static _tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    let mdRows = [];
    let maxCols = 0;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (!cells.length) continue;
      if (cells.length > maxCols) maxCols = cells.length;
      const cellTexts = cells.map(c =>
        this._cleanText(c.textContent)
          .trim()
          .replace(/\|/g, '\\|')
          .replace(/\n+/g, ' ')
      );
      mdRows.push(cellTexts);
    }

    if (maxCols === 0 || mdRows.length === 0) return '';

    mdRows = mdRows.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });

    let output = '| ' + mdRows[0].join(' | ') + ' |\n';
    output += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';

    for (let i = 1; i < mdRows.length; i++) {
      output += '| ' + mdRows[i].join(' | ') + ' |\n';
    }

    return output;
  }

  /**
   * Convert <img> to clean relative local image link (saving actual PNG/JPG file separately)
   * Eliminates massive inline base64 gibberish in the Markdown file!
   */
  static async _imgToMarkdown(img, state, fallbackAlt = '') {
    const rawSrc = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!rawSrc) return '';

    // Skip tiny tracking pixels / UI icons
    const liveImg = state.liveImgMap.get(img.src) || state.liveImgMap.get(rawSrc);
    if (liveImg && liveImg.complete && liveImg.naturalWidth > 0) {
      if (liveImg.naturalWidth < 40 && liveImg.naturalHeight < 40) {
        return '';
      }
    }

    const alt = this._cleanText(img.getAttribute('alt') || fallbackAlt || 'Figure').trim();

    if (!state.opts.extractImages) {
      try {
        const absUrl = new URL(rawSrc, window.location.href).href;
        return `\n\n![${alt}](${absUrl})\n\n`;
      } catch {
        return `\n\n![${alt}](${rawSrc})\n\n`;
      }
    }

    // Extract image data cleanly into a separate file in images/
    let dataUrl = null;
    if (rawSrc.startsWith('data:image/')) {
      dataUrl = rawSrc;
    } else {
      try {
        const absUrl = new URL(rawSrc, window.location.href).href;
        const remaining = state.opts.imageDeadline ? state.opts.imageDeadline - Date.now() : 10000;
        if (remaining > 0) dataUrl = await this.captureImageAsDataUrl(absUrl, liveImg, remaining);
      } catch (e) {
        console.warn('[LearnFlow] Could not extract image:', e);
      }
    }

    if (dataUrl) {
      state.imgCounter++;
      const extMatch = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);/);
      let ext = extMatch ? extMatch[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg') : 'png';
      const filename = `${state.opts.imagePrefix}${state.imgCounter}.${ext}`;

      state.images.push({
        filename,
        dataUrl,
        alt
      });

      return `\n\n![${alt}](images/${filename})\n\n`;
    }

    // Fallback to clean absolute URL if extraction failed
    try {
      const absUrl = new URL(rawSrc, window.location.href).href;
      return `\n\n![${alt}](${absUrl})\n\n`;
    } catch {
      return '';
    }
  }

  /**
   * Robustly capture an image (works on authenticated O'Reilly pages via credentials: 'include' or Canvas)
   */
  static async captureImageAsDataUrl(absoluteUrl, liveImgEl = null, timeoutMs = 10000) {
    // 1. Try authenticated fetch first (works on same-origin O'Reilly image assets)
    try {
      const response = await fetch(absoluteUrl, { credentials: 'include', signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))) });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type.startsWith('image/')) {
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch {
      // Fallback to canvas below
    }

    // Extension host permissions can fetch cross-origin figures that page CORS blocks.
    if (timeoutMs === 10000 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const result = await chrome.runtime.sendMessage({action: 'FETCH_FIGURE_IMAGE', url: absoluteUrl});
        if (result?.dataUrl) return result.dataUrl;
      } catch { /* Try already-loaded image pixels below. */ }
    }

    // 2. Fallback: draw already-loaded DOM <img> onto an offscreen canvas
    if (liveImgEl && liveImgEl.complete && liveImgEl.naturalWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = liveImgEl.naturalWidth;
        canvas.height = liveImgEl.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(liveImgEl, 0, 0);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    }

    return null;
  }
}

if (typeof window !== 'undefined') {
  window.MarkdownBuilder = MarkdownBuilder;
}
