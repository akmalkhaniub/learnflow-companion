/**
 * content_main.js - Orchestrates dynamic content extraction (SPA-aware),
 * audio playback with Figure/Code/Table narration, Alt+Click jump-to-read,
 * YouTube SPA tracking + transcript/screenshot archiving, Ask Gemini Briefings, and Multi-Tab Queue.
 */
(async function initLearnFlowContent() {
  console.log('[LearnFlow] Content script initializing on:', window.location.href);

  const audioPlayer = new AudioPlayer();
  let extractedData = null;
  let lastExtractedUrl = null;

  const getCanonicalUrl = (u = window.location.href) => {
    try {
      const parsed = new URL(u);
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch {
      return u;
    }
  };

  const savePlayProgress = async (index, total) => {
    if (!total || YouTubeHandler.isYouTubeHost()) return;
    const key = getCanonicalUrl();
    const data = await chrome.storage.local.get(['learnflow_play_progress']);
    const map = data.learnflow_play_progress || {};
    map[key] = {
      index,
      total,
      percent: Math.round(((index + 1) / total) * 100),
      title: document.title,
      updatedAt: Date.now()
    };
    // Keep at most 200 recent page positions
    const entries = Object.entries(map);
    if (entries.length > 200) {
      entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      await chrome.storage.local.set({ learnflow_play_progress: Object.fromEntries(entries.slice(0, 200)) });
    } else {
      await chrome.storage.local.set({ learnflow_play_progress: map });
    }
  };

  const clearPlayProgress = async () => {
    const key = getCanonicalUrl();
    const data = await chrome.storage.local.get(['learnflow_play_progress']);
    const map = data.learnflow_play_progress || {};
    if (map[key]) {
      delete map[key];
      await chrome.storage.local.set({ learnflow_play_progress: map });
    }
  };

  const restorePlayProgress = async () => {
    if (!audioPlayer.chunks.length || YouTubeHandler.isYouTubeHost()) return null;
    const key = getCanonicalUrl();
    const data = await chrome.storage.local.get(['learnflow_play_progress']);
    const saved = (data.learnflow_play_progress || {})[key];
    if (saved && saved.index > 0 && saved.index < audioPlayer.chunks.length - 1) {
      audioPlayer.seekTo(saved.index);
      return saved;
    }
    return null;
  };

  // Persist reading position whenever a new segment starts
  audioPlayer.onChunkStart = (index) => {
    savePlayProgress(index, audioPlayer.chunks.length);
  };

  /**
   * Ensure fresh extraction of the main reading area (critical for O'Reilly/skills.google SPAs!)
   */
  const ensureFreshExtraction = async (force = false) => {
    if (YouTubeHandler.isYouTubeHost()) return null;

    if (force || !extractedData || lastExtractedUrl !== window.location.href || !extractedData.chunks?.length) {
      extractedData = ContentExtractor.extract();
      lastExtractedUrl = window.location.href;
      if (extractedData.chunks && extractedData.chunks.length > 0) {
        audioPlayer.setQueue(extractedData.chunks);
        await restorePlayProgress();
        console.log(`[LearnFlow] Extracted ${extractedData.chunks.length} main-content segments from:`, extractedData.title);
      }
    }
    return extractedData;
  };

  // Play handler (resumes from saved position if available!)
  const handlePlay = async () => {
    if (audioPlayer.isPaused && lastExtractedUrl === window.location.href) {
      audioPlayer.play();
      return;
    }
    const data = await ensureFreshExtraction(lastExtractedUrl !== window.location.href || !audioPlayer.chunks.length);
    if (!data || !data.chunks?.length) {
      if (playerUI.isVisible()) playerUI.showToast('No readable content found on this page.');
      return;
    }
    if (audioPlayer.currentIndex === 0) {
      const saved = await restorePlayProgress();
      if (saved && playerUI.isVisible()) {
        playerUI.showToast(`▶ Resuming from ${saved.percent}% (${saved.index + 1}/${saved.total})`);
      }
    } else if (playerUI.isVisible()) {
      const pct = Math.round(((audioPlayer.currentIndex + 1) / audioPlayer.chunks.length) * 100);
      playerUI.showToast(`▶ Resuming from ${pct}%`);
    }
    audioPlayer.play();
  };

  const handleRestart = async () => {
    await clearPlayProgress();
    audioPlayer.stop();
    await ensureFreshExtraction(false);
    audioPlayer.play();
    if (playerUI.isVisible()) playerUI.showToast('↺ Restarting from top');
  };

  // Archival function: clean Markdown + separate image files (ZERO inline base64 gibberish!)
  const handleArchive = async () => {
    try {
      if (YouTubeHandler.isYouTubeHost() && !YouTubeHandler.isYouTube()) {
        if (playerUI) playerUI.showToast('Open a YouTube video first to save its transcript!');
        return;
      }

      if (playerUI) {
        playerUI.showToast(
          YouTubeHandler.isYouTube()
            ? 'Fetching YouTube transcript & video screenshot...'
            : 'Archiving clean Markdown + figures...'
        );
      }

      let archivePayload = null;

      if (YouTubeHandler.isYouTube()) {
        const ytData = await YouTubeHandler.buildVideoStudyGuide(true);
        archivePayload = {
          title: ytData.title,
          category: ytData.category,
          bookTitle: ytData.channel,
          chapterTitle: ytData.title,
          url: ytData.url,
          transcriptCount: ytData.transcriptCount,
          markdown: ytData.markdown,
          images: ytData.images || []
        };
      } else {
        const data = await ensureFreshExtraction(true);

        const chapterSlug = (data.chapterTitle || 'ch')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .substring(0, 20) || 'page';

        const { markdown: mdContent, images } = await MarkdownBuilder.elementToMarkdownWithAssets(data.contentEl, {
          extractImages: true,
          imagePrefix: `${chapterSlug}_fig_`
        });

        // Append Anki flashcards if Gemini AI is configured
        let flashcardSection = '';
        try {
          const rawSample = (data.contentEl.innerText || data.contentEl.textContent || '').trim().substring(0, 10000);
          const ankiCards = await GeminiAI.generateAnkiCards(rawSample);
          if (ankiCards && ankiCards.includes('Q:')) {
            flashcardSection = `\n\n## 📇 Active Recall & Flashcards\n\n${ankiCards}\n`;
          }
        } catch (e) {
          console.log('[LearnFlow] Anki generation skipped:', e);
        }

        const fullMarkdown = `# ${data.chapterTitle}\n\n` +
          `**Book / Source:** ${data.bookTitle}\n` +
          `**Source URL:** [${window.location.href}](${window.location.href})\n` +
          `**Archived At:** ${new Date().toLocaleString()}\n\n---\n\n` +
          mdContent + flashcardSection;

        archivePayload = {
          title: data.title,
          category: data.category,
          bookTitle: data.bookTitle,
          chapterTitle: data.chapterTitle,
          url: window.location.href,
          markdown: fullMarkdown,
          images
        };
      }

      chrome.runtime.sendMessage({
        action: 'ARCHIVE_PAGE',
        payload: archivePayload
      }, (response) => {
        if (response && response.success) {
          if (YouTubeHandler.isYouTube()) {
            const cueMsg = archivePayload.transcriptCount > 0
              ? `${archivePayload.transcriptCount} transcript cues`
              : 'no captions found';
            const savedPath = response.local?.filename || 'Downloads/LearnFlow_Vault/YouTube/';
            if (playerUI) playerUI.showToast(`✓ Saved (${cueMsg}) -> ${savedPath}`, 4500);
          } else {
            const imgCount = archivePayload.images?.length || 0;
            const imgNote = imgCount > 0 ? ` + ${imgCount} figure${imgCount > 1 ? 's' : ''}` : '';
            if (playerUI) playerUI.showToast(`✓ Saved Markdown${imgNote} in Downloads/LearnFlow_Vault/`, 3800);
          }
        } else {
          if (playerUI) playerUI.showToast('Save error: ' + (response?.error || 'Check downloads permissions'), 4000);
        }
      });
    } catch (err) {
      console.error('[LearnFlow] Archive error:', err);
      if (playerUI) playerUI.showToast('Archive error: ' + err.message, 4000);
    }
  };

  // Gemini Audio Brief handler
  const handleGeminiBrief = async () => {
    try {
      if (playerUI) playerUI.showToast('✨ Gemini is preparing your 2-min audio brief...');

      let rawText = '';
      if (YouTubeHandler.isYouTube()) {
        const yt = await YouTubeHandler.buildVideoStudyGuide(false);
        rawText = yt.markdown;
      } else {
        const data = await ensureFreshExtraction(true);
        rawText = (data.contentEl.innerText || data.contentEl.textContent || '').trim().substring(0, 20000);
      }

      const brief = await GeminiAI.generateAudioBrief(rawText);

      const sentences = brief.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [brief];
      const briefChunks = sentences.map(s => ({ type: 'text', text: s.trim(), element: null }));

      audioPlayer.setQueue(briefChunks);
      audioPlayer.play();
      if (playerUI) playerUI.showToast('🎙️ Playing Gemini Audio Briefing...');
    } catch (err) {
      console.error('[LearnFlow] Gemini Brief error:', err);
      if (playerUI) playerUI.showToast('Gemini Brief: ' + err.message);
    }
  };

  // Multi-Tab Playlist Queue Handler
  const handleAddToQueue = async () => {
    const data = await chrome.storage.local.get(['learnflow_playlist']);
    let playlist = data.learnflow_playlist || [];

    const meta = YouTubeHandler.isYouTube() ? YouTubeHandler.getVideoMetadata() : null;
    playlist.push({
      title: meta ? meta.title : document.title,
      url: meta ? meta.url : window.location.href,
      siteType: ContentExtractor.getSiteType(),
      addedAt: Date.now()
    });

    await chrome.storage.local.set({ learnflow_playlist: playlist });
    if (playerUI) playerUI.showToast(`📑 Added to Playlist Queue (#${playlist.length})`);
  };

  // Log exact page or YouTube video visit
  const reportCurrentVisit = () => {
    if (YouTubeHandler.isYouTubeHost()) {
      if (!YouTubeHandler.isYouTube()) return; // Skip YouTube homepage
      const meta = YouTubeHandler.getVideoMetadata();
      if (!meta.videoId || meta.title.toLowerCase() === 'youtube') return;
      chrome.runtime.sendMessage({
        action: 'LOG_PAGE_VISIT',
        payload: {
          title: `${meta.title} — ${meta.channel}`,
          url: meta.url,
          siteType: 'youtube',
          timestamp: Date.now()
        }
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'LOG_PAGE_VISIT',
        payload: {
          title: document.title,
          url: window.location.href,
          siteType: ContentExtractor.getSiteType(),
          timestamp: Date.now()
        }
      });
    }
  };

  // Instantiate Compact Dockable UI (on-demand — NOT auto-shown on every tab!)
  const playerUI = new PlayerUI(audioPlayer, {
    onArchiveRequest: handleArchive,
    onGeminiBriefRequest: handleGeminiBrief,
    onAddToQueueRequest: handleAddToQueue,
    onPlayRequest: handlePlay,
    onRestartRequest: handleRestart,
    onCloseRequest: () => {
      // Stop speech without wiping saved play progress, then remove bar
      window.speechSynthesis.cancel();
      audioPlayer.isPlaying = false;
      audioPlayer.isPaused = false;
      audioPlayer._stopKeepAlive();
      audioPlayer._clearHighlight();
      playerUI.destroy();
    }
  });

  const openPlayer = async () => {
    if (!playerUI.isVisible()) {
      playerUI.init();
    }
    if (!YouTubeHandler.isYouTubeHost()) {
      await ensureFreshExtraction(lastExtractedUrl !== window.location.href || !audioPlayer.chunks.length);
      if (audioPlayer.chunks.length > 0) {
        if (audioPlayer.currentIndex === 0) {
          await restorePlayProgress();
        } else {
          audioPlayer.seekTo(audioPlayer.currentIndex);
        }
      }
    }
  };

  // Alt + Click on any paragraph/heading/figure to jump right there and start reading!
  document.addEventListener('click', async (e) => {
    if (!e.altKey || YouTubeHandler.isYouTubeHost()) return;
    if (e.target.closest('#learnflow-player-root')) return;

    const targetBlock = e.target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table');
    if (!targetBlock) return;

    e.preventDefault();
    await openPlayer();
    const jumped = audioPlayer.jumpToElement(targetBlock);
    if (jumped) {
      playerUI.showToast('🎧 Reading from selected spot');
    } else {
      playerUI.showToast('Click inside the main article text');
    }
  });

  if (!YouTubeHandler.isYouTubeHost()) {
    audioPlayer.onComplete = async () => {
      console.log('[LearnFlow] Audio reached end of section.');
      await clearPlayProgress();
      await handleArchive();

      const data = await chrome.storage.local.get(['learnflow_playlist']);
      if (data.learnflow_playlist && data.learnflow_playlist.length > 0) {
        playerUI.showToast('Next item in Playlist Queue in 2s...');
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'PLAYLIST_ADVANCE' });
        }, 2000);
        return;
      }

      if (playerUI.autoAdvance) {
        const advanced = await AutoNavigator.advanceToNext((sec) => {
          playerUI.showToast(`Next chapter in ${sec}s...`);
        }, 2);

        if (!advanced) {
          playerUI.showToast('Reached the end of available chapters.');
        }
      } else {
        playerUI.showToast('Completed section.');
      }
    };
  }

  // Listen for YouTube's native SPA navigation event so exact video URL & title are ALWAYS captured!
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(reportCurrentVisit, 1400);
  });

  // Periodically save YouTube playback timestamp (every 30s while watching) so history links resume at exact spot!
  if (YouTubeHandler.isYouTubeHost()) {
    setInterval(() => {
      const video = document.querySelector('video');
      if (YouTubeHandler.isYouTube() && video && !video.paused && video.currentTime > 5) {
        reportCurrentVisit();
      }
    }, 30000);
  }

  // Watch for SPA URL navigation on O'Reilly / skills.google / YouTube
  let currentUrl = window.location.href;
  setInterval(async () => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      extractedData = null;
      lastExtractedUrl = null;
      audioPlayer.stop();

      setTimeout(reportCurrentVisit, 1500);

      const shouldResume = await AutoNavigator.checkAutoResume();
      setTimeout(async () => {
        if (shouldResume && !YouTubeHandler.isYouTubeHost()) {
          await openPlayer();
          playerUI.showToast('Auto-playing next chapter...');
          audioPlayer.play();
        } else if (playerUI.isVisible()) {
          await ensureFreshExtraction(true);
        }
      }, 1500);
    }
  }, 1500);

  // Log initial visit (wait 1.2s so YouTube/SPA real title has mounted)
  setTimeout(reportCurrentVisit, 1200);

  // Check if we arrived here through full-page Auto-Advance
  const shouldAutoResume = await AutoNavigator.checkAutoResume();
  if (shouldAutoResume && !YouTubeHandler.isYouTubeHost()) {
    setTimeout(async () => {
      await openPlayer();
      playerUI.showToast('Auto-playing next chapter...');
      audioPlayer.play();
      handleArchive();
    }, 1500);
  }

  // Listen for messages from background / shortcuts / context menus / sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'OPEN_PLAYER') {
      openPlayer().then(() => sendResponse({ visible: true }));
      return true;
    } else if (message.action === 'TOGGLE_PLAYER') {
      if (playerUI.isVisible()) {
        window.speechSynthesis.cancel();
        audioPlayer.isPlaying = false;
        audioPlayer.isPaused = false;
        audioPlayer._stopKeepAlive();
        audioPlayer._clearHighlight();
        playerUI.destroy();
        sendResponse({ visible: false });
      } else {
        openPlayer().then(() => sendResponse({ visible: true }));
      }
      return true;
    } else if (message.action === 'TOGGLE_PLAY') {
      (async () => {
        await openPlayer();
        if (audioPlayer.isPlaying) {
          audioPlayer.pause();
        } else {
          handlePlay();
        }
      })();
    } else if (message.action === 'TRIGGER_GEMINI_AUDIO_BRIEF') {
      openPlayer().then(() => handleGeminiBrief());
    } else if (message.action === 'READ_TEXT_SNIPPET') {
      if (message.text) {
        openPlayer().then(() => {
          audioPlayer.setQueue([{ type: 'text', text: message.text, element: null }]);
          audioPlayer.play();
        });
      }
    } else if (message.action === 'AUTO_START_READING') {
      openPlayer().then(() => handlePlay());
    }
  });
})();
