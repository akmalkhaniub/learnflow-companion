/**
 * YouTubeHandler - Bulletproof YouTube metadata, transcript fetcher, and Canvas keyframe capture.
 *
 * Transcript extraction uses a 2-tier strategy:
 *   Tier 1: Direct extraction of YouTube's captionTracks JSON/XML from watch page HTML (works even when description is collapsed!)
 *   Tier 2: Auto-expands description ("...more"), opens YouTube's Transcript panel, and scrapes DOM segments.
 */
class YouTubeHandler {
  static isYouTubeHost() {
    return window.location.hostname.includes('youtube.com');
  }

  static isYouTube() {
    return this.isYouTubeHost() && (
      window.location.pathname.startsWith('/watch') ||
      window.location.pathname.startsWith('/shorts/')
    );
  }

  static getVideoId() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('v')) return params.get('v');
    const shortMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return shortMatch ? shortMatch[1] : null;
  }

  /**
   * Extract clean video title, channel, and exact timestamped URL
   */
  static getVideoMetadata() {
    const titleSelectors = [
      'ytd-watch-metadata h1 yt-formatted-string',
      'h1.ytd-watch-metadata',
      '#title h1 yt-formatted-string',
      '#title h1',
      'h1.title'
    ];

    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

    if (!title) {
      title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/i, '').trim();
    }

    const channelSelectors = [
      'ytd-watch-metadata #owner ytd-channel-name a',
      '#owner #channel-name a',
      'ytd-video-owner-renderer ytd-channel-name a',
      '#channel-name a'
    ];

    let channel = 'YouTube';
    for (const sel of channelSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        channel = el.textContent.trim();
        break;
      }
    }

    const video = document.querySelector('video');
    const currentSeconds = video && !isNaN(video.currentTime) ? Math.floor(video.currentTime) : 0;
    const videoId = this.getVideoId();

    let exactUrl = window.location.href;
    if (videoId && window.location.pathname.startsWith('/watch')) {
      exactUrl = currentSeconds > 5
        ? `https://www.youtube.com/watch?v=${videoId}&t=${currentSeconds}s`
        : `https://www.youtube.com/watch?v=${videoId}`;
    }

    return {
      videoId,
      title: title || 'YouTube Video',
      channel,
      currentSeconds,
      formattedTime: this.formatTime(currentSeconds),
      url: exactUrl
    };
  }

  /**
   * Capture a high-res screenshot from the HTML5 video element
   */
  static captureVideoScreenshot() {
    const video = document.querySelector('video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('[LearnFlow] Video screenshot capture error:', e);
      return null;
    }
  }

  static formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Tier 1: Fetch captionTracks directly from the YouTube watch page HTML (works even when UI panel is closed!)
   */
  static async _fetchTranscriptFromCaptionTracks(videoId) {
    if (!videoId) return null;

    try {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const res = await fetch(watchUrl, { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();

      // Locate "captionTracks":[ ... ] JSON array inside ytInitialPlayerResponse
      const marker = '"captionTracks":';
      const idx = html.indexOf(marker);
      if (idx === -1) return null;

      const startBracket = html.indexOf('[', idx);
      if (startBracket === -1) return null;

      // Balanced bracket extraction so nested objects never break regexes
      let depth = 0;
      let endBracket = -1;
      let inStr = false;
      let escaped = false;

      for (let i = startBracket; i < html.length && i < startBracket + 50000; i++) {
        const ch = html[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (!inStr) {
          if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) {
              endBracket = i;
              break;
            }
          }
        }
      }

      if (endBracket === -1) return null;
      const tracksJson = html.slice(startBracket, endBracket + 1);
      const tracks = JSON.parse(tracksJson);
      if (!Array.isArray(tracks) || !tracks.length) return null;

      // Prefer manual English -> auto-generated English -> first track
      const selectedTrack =
        tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
        tracks.find(t => t.languageCode?.startsWith('en')) ||
        tracks[0];

      if (!selectedTrack?.baseUrl) return null;

      // Try JSON3 format first
      const json3Url = selectedTrack.baseUrl.includes('fmt=')
        ? selectedTrack.baseUrl
        : `${selectedTrack.baseUrl}&fmt=json3`;

      const trackRes = await fetch(json3Url, { credentials: 'include' });
      if (!trackRes.ok) return null;
      const bodyText = await trackRes.text();

      // Parse JSON3
      if (bodyText.trim().startsWith('{')) {
        const parsed = JSON.parse(bodyText);
        const events = parsed.events || [];
        const lines = [];

        for (const ev of events) {
          if (!ev.segs) continue;
          const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const secs = Math.floor((ev.tStartMs || 0) / 1000);
          lines.push({ time: this.formatTime(secs), text });
        }

        if (lines.length > 0) {
          console.log(`[LearnFlow] Fetched ${lines.length} transcript cues via YouTube captionTracks JSON3!`);
          return lines;
        }
      }

      // Fallback XML format (<text start="12.3">...</text>)
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(bodyText, 'text/xml');
      const textNodes = xmlDoc.querySelectorAll('text');
      const xmlLines = [];

      textNodes.forEach(node => {
        const startSec = parseFloat(node.getAttribute('start') || '0');
        const decoded = this._decodeHtmlEntities(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (decoded) {
          xmlLines.push({ time: this.formatTime(startSec), text: decoded });
        }
      });

      if (xmlLines.length > 0) {
        console.log(`[LearnFlow] Fetched ${xmlLines.length} transcript cues via YouTube captionTracks XML!`);
        return xmlLines;
      }
    } catch (err) {
      console.warn('[LearnFlow] Tier 1 captionTracks fetch failed:', err);
    }

    return null;
  }

  /**
   * Tier 2: Expand YouTube description and click "Show transcript" button, then scrape DOM
   */
  static async _fetchTranscriptFromDOM() {
    try {
      let segments = document.querySelectorAll('ytd-transcript-segment-renderer');

      if (!segments.length) {
        // Expand description first so "Show transcript" button becomes visible in DOM
        const expandBtn = document.querySelector('tp-yt-paper-button#expand, #description-inline-expander #expand');
        if (expandBtn) {
          expandBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }

        // Find and click "Show transcript" button
        const transcriptBtn =
          document.querySelector('ytd-video-description-transcript-section-renderer button') ||
          document.querySelector('button[aria-label*="Show transcript" i], button[aria-label*="transcript" i]') ||
          Array.from(document.querySelectorAll('button')).find(b => /show transcript/i.test(b.textContent || ''));

        if (transcriptBtn) {
          transcriptBtn.click();
          await new Promise(r => setTimeout(r, 1800));
          segments = document.querySelectorAll('ytd-transcript-segment-renderer');
        }
      }

      if (!segments.length) return null;

      const lines = [];
      segments.forEach(seg => {
        const timeEl = seg.querySelector('.segment-timestamp');
        const textEl = seg.querySelector('.segment-text, yt-formatted-string.segment-text');
        const text = textEl ? textEl.textContent.replace(/\s+/g, ' ').trim() : '';
        if (text) {
          lines.push({
            time: timeEl ? timeEl.textContent.trim() : '',
            text
          });
        }
      });

      if (lines.length > 0) {
        console.log(`[LearnFlow] Fetched ${lines.length} transcript cues via YouTube DOM panel!`);
        return lines;
      }
    } catch (err) {
      console.warn('[LearnFlow] Tier 2 DOM transcript scrape failed:', err);
    }

    return null;
  }

  static _decodeHtmlEntities(str) {
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  /**
   * Unified bulletproof transcript extractor (Tier 1 -> Tier 2)
   */
  static async extractTranscript() {
    const videoId = this.getVideoId();
    const tier1 = await this._fetchTranscriptFromCaptionTracks(videoId);
    if (tier1 && tier1.length > 0) return tier1;

    const tier2 = await this._fetchTranscriptFromDOM();
    if (tier2 && tier2.length > 0) return tier2;

    return null;
  }

  /**
   * Build a clean Markdown study archive for the current video,
   * returning separate image assets so the .md file has zero base64 clutter.
   */
  static async buildVideoStudyGuide(includeCurrentScreenshot = true) {
    const meta = this.getVideoMetadata();
    const safeTimeSlug = meta.formattedTime.replace(/:/g, '-');
    const images = [];

    let md = `# 🎬 ${meta.title}\n\n`;
    md += `**Channel:** ${meta.channel}\n`;
    md += `**Source URL:** [${meta.url}](${meta.url})\n`;
    md += `**Captured At:** ${new Date().toLocaleString()} (Playback: ${meta.formattedTime})\n\n`;
    md += `---\n\n`;

    if (includeCurrentScreenshot) {
      const screenshot = this.captureVideoScreenshot();
      if (screenshot) {
        const imgFilename = `yt_${meta.videoId || 'video'}_${safeTimeSlug}.jpg`;
        images.push({
          filename: imgFilename,
          dataUrl: screenshot,
          alt: `Keyframe at ${meta.formattedTime}`
        });
        md += `## 📸 Video Screenshot [${meta.formattedTime}]\n\n`;
        md += `![Keyframe at ${meta.formattedTime}](images/${imgFilename})\n\n`;
      }
    }

    md += `## 📝 Video Transcript & Notes\n\n`;
    const transcript = await this.extractTranscript();

    if (transcript && transcript.length) {
      let buffer = [];
      let blockStartTime = transcript[0]?.time || '00:00';

      transcript.forEach((item, idx) => {
        if (buffer.length === 0) blockStartTime = item.time;
        buffer.push(item.text);
        if ((idx + 1) % 6 === 0 || idx === transcript.length - 1) {
          md += `> **[${blockStartTime}]** ${buffer.join(' ')}\n\n`;
          buffer = [];
        }
      });
    } else {
      md += `*Transcript was not available or captions are disabled by the creator for this video.*\n\n`;
      const descEl = document.querySelector('#description-inline-expander, #description');
      if (descEl && descEl.textContent.trim()) {
        md += `### Video Description\n\n\`\`\`\n${descEl.textContent.trim().substring(0, 4000)}\n\`\`\`\n\n`;
      }
    }

    return {
      title: meta.title,
      channel: meta.channel,
      category: 'YouTube',
      url: meta.url,
      transcriptCount: transcript ? transcript.length : 0,
      markdown: md,
      images
    };
  }
}

if (typeof window !== 'undefined') {
  window.YouTubeHandler = YouTubeHandler;
}
