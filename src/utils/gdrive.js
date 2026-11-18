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
            images: item.images || [],
            timestamp: new Date().toISOString()
          })
        });

        const result = await res.json();
        if (!res.ok || result.status !== 'success') throw new Error(result.message || `Drive upload failed (${res.status})`);
        if ((item.images || []).length > 0 && result.imagesSaved !== item.images.length) {
          throw new Error('Note uploaded, but figures were not confirmed. Copy and redeploy the updated Apps Script from Settings.');
        }
        return { success: true, method: 'webhook', imagesSaved: result.imagesSaved || 0 };
      } catch (err) {
        return { success: false, error: err.message, method: 'webhook' };
      }
    }

    // Method 2: Google Drive API v3 via chrome.identity
    try {
      const token = await this._getAuthToken();
      if (!token) {
        return { success: false, skipped: true };
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
      if (item.images?.length) {
        const imageFolder = await this._getOrCreateFolder(token, 'images', targetFolderId);
        for (const image of item.images) {
          if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image.dataUrl || '')) throw new Error('Invalid figure data');
          const blob = await (await fetch(image.dataUrl)).blob();
          await this._createDriveFile(token, image.filename, blob, imageFolder, blob.type);
        }
      }

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
    const escapedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const searchJson = await searchRes.json();
    if (!searchRes.ok) throw new Error(searchJson.error?.message || 'Drive folder lookup failed');

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
    if (!createRes.ok || !createJson.id) throw new Error(createJson.error?.message || 'Drive folder creation failed');
    return createJson.id;
  }

  static async _createDriveFile(token, fileName, content, parentId, mimeType = 'text/markdown') {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      mimeType,
      parents: parentId ? [parentId] : []
    };

    const multipartRequestBody = new Blob([
      delimiter, 'Content-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata),
      delimiter, `Content-Type: ${mimeType}\r\n\r\n`, content, closeDelimiter
    ]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    const json = await res.json();
    if (!res.ok || !json.id) throw new Error(json.error?.message || 'Drive file upload failed');
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

