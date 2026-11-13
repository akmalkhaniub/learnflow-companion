/**
 * MarkdownBuilder - Converts HTML DOM elements into clean, portable Markdown
 * with full support for tables, figures, code blocks, and base64 embedded images.
 */
class MarkdownBuilder {
  /**
   * Convert an HTML element into GitHub-flavored Markdown
   * @param {HTMLElement} rootElement 
   * @param {Object} options 
   * @returns {Promise<string>}
   */
  static async elementToMarkdown(rootElement, options = { embedImagesAsBase64: true }) {
    if (!rootElement) return '';
    const clone = rootElement.cloneNode(true);

    // Remove hidden elements, scripts, styles, buttons, navs
    const removeSelectors = ['script', 'style', 'noscript', 'nav', 'footer', 'iframe', '.ad', '.ads', '[aria-hidden="true"]'];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    return await this._processNode(clone, options);
  }

  static async _processNode(node, options) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tagName = node.tagName.toLowerCase();

    // Table conversion
    if (tagName === 'table') {
      return this._tableToMarkdown(node) + '\n\n';
    }

    // Image & Figure conversion
    if (tagName === 'img') {
      return await this._imgToMarkdown(node, options) + '\n\n';
    }

    if (tagName === 'figure') {
      const img = node.querySelector('img');
      const caption = node.querySelector('figcaption')?.textContent?.trim() || '';
      let md = '';
      if (img) {
        md = await this._imgToMarkdown(img, options);
      }
      if (caption) {
        md += `\n*Figure: ${caption}*\n\n`;
      }
      return md;
    }

    // Pre & Code blocks
    if (tagName === 'pre') {
      const code = node.textContent;
      const lang = node.className.match(/lang(?:uage)?-(\w+)/)?.[1] || '';
      return `\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
    }

    if (tagName === 'code') {
      return `\`${node.textContent}\``;
    }

    // Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = '#'.repeat(parseInt(tagName[1], 10));
      const text = node.textContent.trim();
      return `\n\n${level} ${text}\n\n`;
    }

    // Paragraphs
    if (tagName === 'p') {
      const childrenText = await this._processChildren(node, options);
      return `\n\n${childrenText.trim()}\n\n`;
    }

    // Lists
    if (tagName === 'ul') {
      let result = '\n';
      for (const li of node.children) {
        if (li.tagName.toLowerCase() === 'li') {
          const itemText = await this._processChildren(li, options);
          result += `- ${itemText.trim()}\n`;
        }
      }
      return result + '\n';
    }

    if (tagName === 'ol') {
      let result = '\n';
      let idx = 1;
      for (const li of node.children) {
        if (li.tagName.toLowerCase() === 'li') {
          const itemText = await this._processChildren(li, options);
          result += `${idx}. ${itemText.trim()}\n`;
          idx++;
        }
      }
      return result + '\n';
    }

    // Blockquote
    if (tagName === 'blockquote') {
      const text = await this._processChildren(node, options);
      return `\n> ${text.trim().replace(/\n/g, '\n> ')}\n\n`;
    }

    // Links
    if (tagName === 'a') {
      const href = node.getAttribute('href') || '';
      const linkText = node.textContent.trim();
      return linkText ? `[${linkText}](${href})` : '';
    }

    // Strong / Em
    if (tagName === 'strong' || tagName === 'b') {
      const text = await this._processChildren(node, options);
      return `**${text}**`;
    }

    if (tagName === 'em' || tagName === 'i') {
      const text = await this._processChildren(node, options);
      return `*${text}*`;
    }

    // Horizontal Rule
    if (tagName === 'hr') {
      return '\n\n---\n\n';
    }

    // Default: Process children
    return await this._processChildren(node, options);
  }

  static async _processChildren(node, options) {
    let result = '';
    for (const child of node.childNodes) {
      result += await this._processNode(child, options);
    }
    return result;
  }

  /**
   * Convert an HTML <table> into Markdown table syntax
   */
  static _tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    let mdRows = [];
    let maxCols = 0;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length > maxCols) maxCols = cells.length;
      const cellTexts = cells.map(c => c.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '));
      mdRows.push(cellTexts);
    }

    if (maxCols === 0) return '';

    // Normalize row lengths
    mdRows = mdRows.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });

    let output = '\n| ' + mdRows[0].join(' | ') + ' |\n';
    output += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';

    for (let i = 1; i < mdRows.length; i++) {
      output += '| ' + mdRows[i].join(' | ') + ' |\n';
    }

    return output;
  }

  /**
   * Convert <img> to Markdown with optional base64 embedding
   */
  static async _imgToMarkdown(img, options) {
    const src = img.getAttribute('src') || '';
    const alt = (img.getAttribute('alt') || 'illustration').trim();

    if (!src) return '';

    // If already data URI or embedding not requested
    if (src.startsWith('data:') || !options.embedImagesAsBase64) {
      return `![${alt}](${src})`;
    }

    try {
      // Resolve relative URLs to absolute
      const absoluteUrl = new URL(src, window.location.href).href;
      const base64Data = await this._urlToBase64(absoluteUrl);
      if (base64Data) {
        return `![${alt}](${base64Data})`;
      }
    } catch (e) {
      console.warn('[LearnFlow] Image conversion failed, fallback to URL:', e);
    }

    return `![${alt}](${src})`;
  }

  /**
   * Fetch image and convert to Base64
   */
  static async _urlToBase64(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
}

// Make available globally in content script and module contexts
if (typeof window !== 'undefined') {
  window.MarkdownBuilder = MarkdownBuilder;
}
