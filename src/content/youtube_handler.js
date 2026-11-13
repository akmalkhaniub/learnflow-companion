/**
 * YouTubeHandler - Extracts video metadata, captures keyframe screenshots via HTML5 Canvas,
 * extracts transcript/script, and formats into a rich, self-contained study guide.
 */
class YouTubeHandler {
  static isYouTube() {
    return window.location.hostname.includes('youtube.com') && window.location.pathname.startsWith('/watch');
  }

  /**
   * Capture a high-res screenshot from the HTML5 video element
   * @returns {string|null} Base64 data URL
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
      console.warn('[LearnFlow] Video screenshot capture error (CORS/canvas):', e);
      return null;
    }
  }

  /**
   * Formats seconds into MM:SS or HH:MM:SS
   */
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
   * Attempt to extract transcript lines from YouTube's transcript panel
   */
  static async extractTranscript() {
    // If transcript panel is not open, attempt to click the "Show transcript" button
    let segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    
    if (!segments.length) {
      // Look for transcript button
      const transcriptBtn = document.querySelector('button[aria-label*="transcript" i], #description ytd-video-description-transcript-section-renderer button');
      if (transcriptBtn) {
        transcriptBtn.click();
        // Wait 1.2s for transcript DOM to render
        await new Promise(r => setTimeout(r, 1200));
        segments = document.querySelectorAll('ytd-transcript-segment-renderer');
      }
    }

    if (!segments.length) {
      return null;
    }

    const transcriptData = [];
    segments.forEach(seg => {
      const timeEl = seg.querySelector('.segment-timestamp');
      const textEl = seg.querySelector('.segment-text');
      if (textEl) {
        transcriptData.push({
          time: timeEl ? timeEl.textContent.trim() : '',
          text: textEl.textContent.trim()
        });
      }
    });

    return transcriptData;
  }

  /**
   * Build a complete Markdown study archive for the current video,
   * combining transcript script segments and screenshots.
   */
  static async buildVideoStudyGuide(includeCurrentScreenshot = true) {
    const video = document.querySelector('video');
    const currentTime = video ? video.currentTime : 0;
    const formattedCurrentTime = this.formatTime(currentTime);

    const titleEl = document.querySelector('h1.ytd-watch-metadata, #title h1');
    const channelEl = document.querySelector('#owner #channel-name, ytd-channel-name a');
    const title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '');
    const channel = channelEl ? channelEl.textContent.trim() : 'Unknown Creator';
    const url = window.location.href;

    let md = `# 🎬 ${title}\n\n`;
    md += `**Channel:** ${channel}\n`;
    md += `**Source URL:** [${url}](${url})\n`;
    md += `**Captured At:** ${new Date().toLocaleString()} (Playback: ${formattedCurrentTime})\n\n`;
    md += `---\n\n`;

    // Capture screenshot of current frame
    if (includeCurrentScreenshot) {
      const screenshot = this.captureVideoScreenshot();
      if (screenshot) {
        md += `## 📸 Video Screenshot [${formattedCurrentTime}]\n\n`;
        md += `![Keyframe at ${formattedCurrentTime}](${screenshot})\n\n`;
      }
    }

    // Try extracting transcript
    md += `## 📝 Video Transcript & Notes\n\n`;
    const transcript = await this.extractTranscript();

    if (transcript && transcript.length) {
      let currentSectionTime = '';
      let buffer = [];

      transcript.forEach((item, idx) => {
        buffer.push(item.text);
        // Group every 6 transcript lines into a paragraph
        if ((idx + 1) % 6 === 0 || idx === transcript.length - 1) {
          md += `> **[${item.time}]** ${buffer.join(' ')}\n\n`;
          buffer = [];
        }
      });
    } else {
      md += `*Transcript was not available or disabled by creator for this video.*\n\n`;
      const descEl = document.querySelector('#description-inline-expander');
      if (descEl) {
        md += `### Video Description\n\n\`\`\`\n${descEl.textContent.trim()}\n\`\`\`\n\n`;
      }
    }

    return {
      title,
      channel,
      category: 'YouTube',
      url,
      markdown: md
    };
  }
}

if (typeof window !== 'undefined') {
  window.YouTubeHandler = YouTubeHandler;
}
