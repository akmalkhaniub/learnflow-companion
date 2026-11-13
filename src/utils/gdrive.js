/**
 * GDriveSync - Handles authentication and direct uploading to Google Drive
 * Supports both Google Drive REST API v3 and Google Apps Script Webhook.
 */
class GDriveSync {
  /**
   * Upload an archived note to Google Drive
   * @param {Object} item { title, category, bookTitle, chapterTitle, markdown }
   * @returns {Promise<{success: boolean, id?: string, error?: string}>}
   */
  static async upload(item) {
    const settings = await chrome.storage.local.get(['gdrive_webhook_url', 'gdrive_client_id']);

    // Method 1: Google Apps Script Webhook (Zero GCP console setup required)
    if (settings.gdrive_webhook_url) {
      try {
        const res = await fetch(settings.gdrive_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.title,
            category: item.category || 'General',
            bookTitle: item.bookTitle || 'Tutorials',
            chapterTitle: item.chapterTitle || item.title,
            content: item.markdown,
            timestamp: new Date().toISOString()
          })
        });

        if (res.ok) {
          return { success: true, method: 'webhook' };
        }
      } catch (err) {
        console.warn('[LearnFlow] Webhook upload failed, checking OAuth token:', err);
      }
    }

    // Method 2: Google Drive API v3 via chrome.identity
    try {
      const token = await this._getAuthToken();
      if (!token) {
        return { success: false, error: 'Google Drive not authenticated (configure in Side Panel)' };
      }

      // 1. Get or create root "LearnFlow Vault" folder
      const rootFolderId = await this._getOrCreateFolder(token, 'LearnFlow Vault');

      // 2. Get or create category subfolder (e.g. OReilly / YouTube / GoogleSkills)
      const categoryFolderId = await this._getOrCreateFolder(token, item.category || 'Tutorials', rootFolderId);

      // 3. If book or series, create book subfolder
      let targetFolderId = categoryFolderId;
      if (item.bookTitle && item.bookTitle !== item.category) {
        targetFolderId = await this._getOrCreateFolder(token, this._sanitizeFilename(item.bookTitle), categoryFolderId);
      }

      // 4. Upload file
      const fileName = `${this._sanitizeFilename(item.chapterTitle || item.title)}.md`;
      const fileId = await this._createDriveFile(token, fileName, item.markdown, targetFolderId);

      return { success: true, id: fileId, method: 'oauth' };
    } catch (e) {
      console.warn('[LearnFlow GDrive]', e);
      return { success: false, error: e.message };
    }
  }

  static async _getAuthToken() {
    return new Promise((resolve) => {
      if (typeof chrome.identity === 'undefined' || !chrome.identity.getAuthToken) {
        resolve(null);
        return;
      }

      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve(null);
        } else {
          resolve(token);
        }
      });
    });
  }

  static async _getOrCreateFolder(token, folderName, parentId = null) {
    let q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const searchJson = await searchRes.json();

    if (searchJson.files && searchJson.files.length > 0) {
      return searchJson.files[0].id;
    }

    // Create folder
    const metadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    };

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    const createJson = await createRes.json();
    return createJson.id;
  }

  static async _createDriveFile(token, fileName, content, parentId) {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      mimeType: 'text/markdown',
      parents: parentId ? [parentId] : []
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/markdown\r\n\r\n' +
      content +
      closeDelimiter;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    const json = await res.json();
    return json.id;
  }

  static _sanitizeFilename(name) {
    return (name || 'Document').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100).trim();
  }
}

if (typeof window !== 'undefined') {
  window.GDriveSync = GDriveSync;
}

export { GDriveSync };

