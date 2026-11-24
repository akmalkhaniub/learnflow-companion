/**
 * content_main.js - Orchestrates dynamic content extraction (SPA-aware),
 * audio playback with Figure/Code/Table narration, Alt+Click jump-to-read,
 * YouTube SPA tracking + transcript/screenshot archiving, Ask Gemini Briefings, and Multi-Tab Queue.
 */
(async function initLearnFlowContent() {
  // Child frames (e.g. embedded Google Skills / Qwiklabs / Docs iframes):
  // Do NOT render UI or track history; just respond to top-frame extraction & highlight requests!
  if (window !== window.top) {
    const framePlayer = new AudioPlayer();
    let frameChunks = [];

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'LEARNFLOW_EXTRACT_FRAME') {
        try {
          const res = ContentExtractor.extract();
          let chunks = res?.chunks || [];
          if (!chunks.length) {
            chunks = ContentExtractor._extractVisibleTextFallback(document.body);
          }
          frameChunks = chunks;
          const serializable = chunks.map((c, idx) => ({
            type: c.type || 'text',
            text: c.text,
            lang: c.lang || '',
            caption: c.caption || '',
            headingLevel: c.headingLevel || 0,
            frameChunkIndex: idx
          }));
          const textLength = serializable.reduce((sum, c) => sum + (c.text?.length || 0), 0);
          const hasNextButton = !!AutoNavigator.findNextTarget();
          window.top.postMessage({
            type: 'LEARNFLOW_FRAME_CHUNKS',
            reqId: event.data.reqId,
            textLength,
            hasNextButton,
            chunks: serializable
          }, '*');
        } catch {
          // Ignore restricted frame errors
        }
      } else if (event.data?.type === 'LEARNFLOW_HIGHLIGHT_FRAME_CHUNK') {
        try {
          const c = frameChunks[event.data.chunkIndex];
          if (c) {
            framePlayer._highlightChunk(c);
          }
        } catch {}
      } else if (event.data?.type === 'LEARNFLOW_HIGHLIGHT_FRAME_WORD') {
        try {
          const c = frameChunks[event.data.chunkIndex];
          if (c && c.element) {
            framePlayer._highlightWord(c.element, event.data.text, event.data.charIndex, event.data.charLength, c);
          }
        } catch {}
      } else if (event.data?.type === 'LEARNFLOW_CLEAR_FRAME_HIGHLIGHT') {
        try {
          framePlayer._clearHighlight();
        } catch {}
      } else if (event.data?.type === 'LEARNFLOW_CLICK_NEXT') {
        try {
          const nextEl = AutoNavigator.findNextTarget();
          if (nextEl) {
            chrome.storage.local.set({
              learnflow_auto_play_next: true,
              learnflow_auto_play_origin: window.location.origin,
              learnflow_last_navigated: Date.now()
            }).then(() => nextEl.click());
          }
        } catch {}
      }
    });
    return;
  }

  console.log('[LearnFlow] Content script initializing on:', window.location.href);

  const audioPlayer = new AudioPlayer();
  audioPlayer.onRemoteHighlight = (chunk) => {
    if (mainContentFrameWindow && typeof chunk?.frameChunkIndex === 'number') {
      try {
        mainContentFrameWindow.postMessage({
          type: 'LEARNFLOW_HIGHLIGHT_FRAME_CHUNK',
          chunkIndex: chunk.frameChunkIndex
        }, '*');
      } catch {}
    }
  };
  audioPlayer.onRemoteWord = (chunk, text, charIndex, charLength) => {
    if (mainContentFrameWindow && typeof chunk?.frameChunkIndex === 'number') {
      try {
        mainContentFrameWindow.postMessage({
          type: 'LEARNFLOW_HIGHLIGHT_FRAME_WORD',
          chunkIndex: chunk.frameChunkIndex,
          text,
          charIndex,
          charLength
        }, '*');
      } catch {}
    }
  };
  audioPlayer.onRemoteClearHighlight = () => {
    if (mainContentFrameWindow) {
      try {
        mainContentFrameWindow.postMessage({ type: 'LEARNFLOW_CLEAR_FRAME_HIGHLIGHT' }, '*');
      } catch {}
    }
  };
  let extractedData = null;
  let lastExtractedUrl = null;
  let lastExtractedText = null;
  let playbackMode = 'article';
  let learningUrl = null;
  let progressWrites = Promise.resolve();

  const getCanonicalUrl = (u = window.location.href) => {
    try {
      const parsed = new URL(u);
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch {
      return u;
    }
  };

  const updateProgress = operation => {
    progressWrites = progressWrites.catch(() => {}).then(operation);
    return progressWrites;
  };

  const savePlayProgress = (index, total) => {
    if (playbackMode !== 'article' || !total || YouTubeHandler.isYouTubeHost()) return;
    const key = getCanonicalUrl();
    const position = { index, total, percent: Math.round(((index + 1) / total) * 100),
      title: document.title, updatedAt: Date.now() };
    return updateProgress(async () => {
      const data = await chrome.storage.local.get(['learnflow_play_progress']);
      const map = data.learnflow_play_progress || {};
      map[key] = position;
      const entries = Object.entries(map).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      await chrome.storage.local.set({ learnflow_play_progress: Object.fromEntries(entries.slice(0, 200)) });
    });
  };

  const clearPlayProgress = () => {
    const key = getCanonicalUrl();
    return updateProgress(async () => {
      const data = await chrome.storage.local.get(['learnflow_play_progress']);
      const map = data.learnflow_play_progress || {};
      delete map[key];
      await chrome.storage.local.set({ learnflow_play_progress: map });
    });
  };

  const restorePlayProgress = async () => {
    await progressWrites;
    if (!audioPlayer.chunks.length || YouTubeHandler.isYouTubeHost()) return null;
    const key = getCanonicalUrl();
    const data = await chrome.storage.local.get(['learnflow_play_progress']);
    const saved = (data.learnflow_play_progress || {})[key];
    if (saved && saved.index >= 0 && saved.index < audioPlayer.chunks.length) {
      audioPlayer.seekTo(saved.index);
      return saved;
    }
    return null;
  };

  // Persist reading position whenever a new segment starts
  audioPlayer.onChunkStart = (index) => {
    savePlayProgress(index, audioPlayer.chunks.length);
  };

  let mainContentFrameWindow = null;

  /**
   * Ensure fresh extraction of the main reading area (critical for O'Reilly/skills.google SPAs & multi-frame docs!)
   */
  const ensureFreshExtraction = async (force = false) => {
    if (YouTubeHandler.isYouTubeHost()) return null;

    if (force || !extractedData || lastExtractedUrl !== getCanonicalUrl() || !extractedData.chunks?.length) {
      mainContentFrameWindow = null;
      extractedData = ContentExtractor.extract();

      const topTextLen = (extractedData.chunks || []).reduce((s, c) => s + (c.text?.length || 0), 0);
      const iframes = ContentExtractor._querySelectorAllDeep(document, 'iframe');

      // On multi-frame pages (like skills.google), top frame often holds only a short heading/shell.
      // Query ALL iframes (including inside Shadow DOM) and pick the main content frame!
      if (iframes.length > 0 && ((extractedData.chunks?.length || 0) < 8 || topTextLen < 600)) {
        const frameReplies = await new Promise((resolve) => {
          const reqId = `lf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const replies = [];
          const onMsg = (ev) => {
            if (ev.data?.type === 'LEARNFLOW_FRAME_CHUNKS' && ev.data.reqId === reqId && Array.isArray(ev.data.chunks)) {
              replies.push({
                win: ev.source,
                textLength: ev.data.textLength || 0,
                hasNextButton: !!ev.data.hasNextButton,
                chunks: ev.data.chunks.map(c => ({ ...c, element: null }))
              });
            }
          };
          window.addEventListener('message', onMsg);
          iframes.forEach(frame => {
            try {
              frame.contentWindow?.postMessage({ type: 'LEARNFLOW_EXTRACT_FRAME', reqId }, '*');
            } catch {}
          });
          setTimeout(() => {
            window.removeEventListener('message', onMsg);
            resolve(replies);
          }, 550);
        });

        if (frameReplies.length > 0) {
          // Pick the frame with the richest content (preferring frames that also have a Next button)
          frameReplies.sort((a, b) => (b.textLength + (b.hasNextButton ? 500 : 0)) - (a.textLength + (a.hasNextButton ? 500 : 0)));
          const best = frameReplies[0];
          if (best && best.chunks.length > 0 && best.textLength > topTextLen) {
            mainContentFrameWindow = best.win;
            extractedData.chunks = [...(extractedData.chunks || []), ...best.chunks];
          }
        }
      }
      lastExtractedUrl = getCanonicalUrl();
      lastExtractedText = extractedData.contentEl?.textContent || null;
      if (extractedData.chunks && extractedData.chunks.length > 0) {
        playbackMode = 'article';
        audioPlayer.setQueue(extractedData.chunks);
        await restorePlayProgress();
        console.log(`[LearnFlow] Extracted ${extractedData.chunks.length} main-content segments from:`, extractedData.title);
      }
    }
    return extractedData;
  };

  // Play handler (resumes from saved position if available!)
  const handlePlay = async ({ resumeArticle = false } = {}) => {
    learningUrl = window.location.href;
    reportCurrentVisit();
    if (YouTubeHandler.isYouTube()) {
      const video = document.querySelector('video');
      if (!video) throw new Error('Video is not ready. Try again shortly.');
      await video.play();
      return;
    }
    if (!resumeArticle && audioPlayer.isPaused && lastExtractedUrl === getCanonicalUrl()) {
      audioPlayer.play();
      return;
    }
    if (playbackMode === 'article' && audioPlayer.isPlaying && lastExtractedUrl === getCanonicalUrl()) return;
    if (playbackMode !== 'article') await ensureFreshExtraction(true);
    if (audioPlayer.isPaused && lastExtractedUrl === getCanonicalUrl()) {
      audioPlayer.play();
      return;
    }
    const data = await ensureFreshExtraction(lastExtractedUrl !== getCanonicalUrl() || !audioPlayer.chunks.length);
    if (!data || !data.chunks?.length) {
      throw new Error('No readable content found on this page.');
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
    await ensureFreshExtraction(true);
    learningUrl = window.location.href;
    reportCurrentVisit();
    audioPlayer.play();
    if (playerUI.isVisible()) playerUI.showToast('↺ Restarting from top');
  };

  // Archival function: clean Markdown + separate image files (ZERO inline base64 gibberish!)
  const handleArchive = async ({ automatic = false } = {}) => {
    learningUrl = window.location.href;
    reportCurrentVisit();
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
        const data = ContentExtractor.extract();

        const chapterSlug = (data.chapterTitle || 'ch')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .substring(0, 20) || 'page';

        const { markdown: mdContent, images } = await MarkdownBuilder.elementToMarkdownWithAssets(data.contentEl, {
          extractImages: true,
          imagePrefix: `${chapterSlug}_fig_`,
          imageDeadline: automatic ? Date.now() + 4000 : null
        });

        // Append Anki flashcards if Gemini AI is configured
        let flashcardSection = '';
        try {
          const rawSample = (data.contentEl.innerText || data.contentEl.textContent || '').trim().substring(0, 10000);
          const ankiCards = automatic ? '' : await GeminiAI.generateAnkiCards(rawSample);
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
          if (response.gdrive?.error && !response.gdrive?.skipped) {
            playerUI.showToast('Saved locally. Drive sync failed: ' + response.gdrive.error, 6500);
            return;
          }
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
    learningUrl = window.location.href;
    reportCurrentVisit();
    try {
      if (playerUI) playerUI.showToast('✨ Gemini is preparing your 2-min audio brief...');

      let rawText = '';
      if (YouTubeHandler.isYouTube()) {
        const yt = await YouTubeHandler.buildVideoStudyGuide(false);
        rawText = yt.markdown;
      } else {
        const data = ContentExtractor.extract();
        rawText = (data.contentEl.innerText || data.contentEl.textContent || '').trim().substring(0, 20000);
      }

      const brief = await GeminiAI.generateAudioBrief(rawText);

      const sentences = brief.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [brief];
      const briefChunks = sentences.map(s => ({ type: 'text', text: s.trim(), element: null }));

      playbackMode = 'brief';
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
    if (learningUrl !== window.location.href) return;
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

  const readerStatus = (message, id = 'lf-navigation-status') => {
    const label = playerUI.root?.querySelector(`#${id}`);
    if (label) label.textContent = message;
    playerUI.showToast(message, 5500);
  };

  const prepareArticle = async () => {
    audioPlayer.suppressAutoScrollUntil = Date.now() + 1500;
    await ensureFreshExtraction(playbackMode !== 'article');
    learningUrl = window.location.href;
    reportCurrentVisit();
  };

  const readHere = async () => {
    try {
      await prepareArticle();
      const index = audioPlayer.visibleChunkIndex();
      if (index < 0) return readerStatus('Scroll to some article text, then choose Read from here.');
      audioPlayer.jumpToIndex(index);
      playerUI.showToast('Reading from the visible section');
    } catch (error) { readerStatus(error.message); }
  };

  const nextPageNow = async (delay = 0) => {
    try {
      readerStatus(AutoNavigator.status());
      const advanced = await AutoNavigator.advanceToNext(seconds => readerStatus(`Next chapter in ${seconds}s…`), delay);
      if (advanced) return;
      // If Next button lives inside a cross-origin content iframe, tell that frame to click Next
      const iframes = ContentExtractor._querySelectorAllDeep(document, 'iframe');
      if (mainContentFrameWindow || iframes.length > 0) {
        if (mainContentFrameWindow) {
          mainContentFrameWindow.postMessage({ type: 'LEARNFLOW_CLICK_NEXT' }, '*');
        } else {
          iframes.forEach(f => { try { f.contentWindow?.postMessage({ type: 'LEARNFLOW_CLICK_NEXT' }, '*'); } catch {} });
        }
        return;
      }
      readerStatus('Next page did not open. Choose Next, then click the book’s Next control.');
    } catch (error) { readerStatus(`Next page failed: ${error.message}`); }
  };

  const chooseNext = () => {
    readerStatus('Click the book’s Next button or chapter link. Press Escape to cancel.');
    const cleanup = () => {
      document.removeEventListener('click', capture, true);
      document.removeEventListener('keydown', cancel, true);
    };
    const cancel = event => { if (event.key === 'Escape') { cleanup(); readerStatus('Choosing Next canceled.'); } };
    const capture = event => {
      if (event.target.closest('#learnflow-player-root')) return;
      const target = event.target.closest('a, button, [role=button]');
      if (!target) return;
      event.preventDefault(); event.stopImmediatePropagation(); cleanup();
      try { AutoNavigator.choose(target); readerStatus(AutoNavigator.status()); }
      catch (error) { readerStatus(error.message); }
    };
    document.addEventListener('click', capture, true);
    document.addEventListener('keydown', cancel, true);
  };

  const explainVisibleFigure = async () => {
    try {
      await prepareArticle();
      const candidates = audioPlayer.chunks.map((chunk, index) => ({chunk, index, rect: chunk.element?.getBoundingClientRect()}))
        .filter(item => item.chunk.type === 'figure' && item.rect?.bottom > 0 && item.rect.top < window.innerHeight)
        .sort((a, b) => Math.abs(a.rect.top - 80) - Math.abs(b.rect.top - 80));
      if (!candidates.length) return readerStatus('Scroll to a figure, then choose Explain visible figure.', 'lf-figure-status');
      const {chunk, index} = candidates[0];
      chunk.spokenText = null;
      chunk.figureError = null;
      audioPlayer.figureNarrationEnabled = true;
      readerStatus('Reading the image and surrounding explanation…', 'lf-figure-status');
      audioPlayer.jumpToIndex(index);
    } catch (error) { readerStatus(error.message, 'lf-figure-status'); }
  };

  // Instantiate Compact Dockable UI (on-demand — NOT auto-shown on every tab!)
  const playerUI = new PlayerUI(audioPlayer, {
    onReadHere: readHere,
    onSection: async direction => {
      await prepareArticle();
      if (!audioPlayer.jumpSection(direction)) readerStatus(direction > 0 ? 'No later section heading found.' : 'No earlier section heading found.');
    },
    onNextPage: () => nextPageNow(),
    onChooseNext: chooseNext,
    onExplainFigure: explainVisibleFigure,
    onArchiveRequest: handleArchive,
    onGeminiBriefRequest: handleGeminiBrief,
    onAddToQueueRequest: handleAddToQueue,
    onPlayRequest: () => handlePlay().catch(error => playerUI.showToast(error.message)),
    onRestartRequest: handleRestart,
    onOpenSidebarRequest: () => {
      chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          playerUI.showToast('Press Alt+Shift+L (or right-click → Open Side Panel) to open sidebar', 4500);
        }
      });
    },
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
      await ensureFreshExtraction(lastExtractedUrl !== getCanonicalUrl() || !audioPlayer.chunks.length);
      if (audioPlayer.chunks.length > 0) {
        if (audioPlayer.currentIndex === 0) {
          await restorePlayProgress();
        } else {
          audioPlayer.seekTo(audioPlayer.currentIndex);
        }
      }
    }
  };

  let lastScrollInput = 0, scrollTimer = null, followWasPlaying = false;
  const userScrollIntent = event => {
    if (!playerUI.isVisible() || event.target.closest?.('#learnflow-player-root, input, textarea, select')) return;
    if (event.type === 'keydown' && !['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    lastScrollInput = Date.now();
    audioPlayer.suppressAutoScrollUntil = Date.now() + 30000;
    if (playerUI.followScroll && audioPlayer.isPlaying) {
      followWasPlaying = true;
      audioPlayer.pause();
    }
  };
  document.addEventListener('wheel', userScrollIntent, {passive: true, capture: true});
  document.addEventListener('touchmove', userScrollIntent, {passive: true, capture: true});
  document.addEventListener('keydown', userScrollIntent, true);
  document.addEventListener('scroll', () => {
    if (!playerUI.followScroll || !followWasPlaying || Date.now() - lastScrollInput > 1800) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      followWasPlaying = false;
      if (playerUI.isVisible() && playerUI.followScroll) readHere();
    }, 700);
  }, {passive: true, capture: true});

  // Alt + Click on any paragraph/heading/figure to jump right there and start reading!
  document.addEventListener('click', async (e) => {
    if (!e.altKey || YouTubeHandler.isYouTubeHost()) return;
    if (e.target.closest('#learnflow-player-root')) return;

    const targetBlock = e.target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table');
    if (!targetBlock) return;

    e.preventDefault();
    await openPlayer();
    if (playbackMode !== 'article') await ensureFreshExtraction(true);
    learningUrl = window.location.href;
    const jumped = audioPlayer.jumpToElement(targetBlock);
    if (jumped) reportCurrentVisit();
    if (jumped) {
      playerUI.showToast('🎧 Reading from selected spot');
    } else {
      playerUI.showToast('Click inside the main article text');
    }
  });

  if (!YouTubeHandler.isYouTubeHost()) {
    audioPlayer.onComplete = async () => {
      if (playbackMode !== 'article') return;
      console.log('[LearnFlow] Audio reached end of section.');
      await clearPlayProgress();
      playerUI.showToast('Reading complete. Saving notes before next page…');
      await handleArchive({ automatic: true });

      const data = await chrome.storage.local.get(['learnflow_playlist', 'learnflow_nav_delay']);
      const delay = Math.max(1, Math.min(10, Number(data.learnflow_nav_delay) || 2));
      if (data.learnflow_playlist && data.learnflow_playlist.length > 0) {
        playerUI.showToast(`Next item in Playlist Queue in ${delay}s...`);
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'PLAYLIST_ADVANCE' }).then(result => {
            if (!result?.success) playerUI.showToast(result?.error || 'Could not start the next queued page.', 5000);
          });
        }, delay * 1000);
        return;
      }

      if (playerUI.autoAdvance) {
        await nextPageNow(delay);
      } else {
        playerUI.showToast('Completed. Auto-Next is OFF; enable it in the reader settings to continue.', 6000);
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

  const resumeNextPage = async (previousText = null) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await ensureFreshExtraction(true);
      const chunks = extractedData?.chunks || [];
      const text = extractedData?.contentEl?.textContent || chunks.map(c => c.text || '').join('\n');
      if (chunks.length && (previousText === null || text !== previousText)) {
        await openPlayer();
        await handlePlay();
        playerUI.showToast('Reading next chapter');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    playerUI.showToast('Next page is still loading. Press Play when its text appears.', 6000);
  };

  // Watch for SPA URL navigation on O'Reilly / skills.google / YouTube
  let currentUrl = getCanonicalUrl();
  setInterval(async () => {
    const pendingNavigation = sessionStorage.getItem('learnflow_navigation');
    const changedInPlace = pendingNavigation && lastExtractedText && extractedData?.contentEl &&
      ((ContentExtractor.extract().contentEl?.textContent || '') !== lastExtractedText);
    if (getCanonicalUrl() !== currentUrl || changedInPlace) {
      const previousText = lastExtractedText;
      currentUrl = getCanonicalUrl();
      extractedData = null;
      lastExtractedUrl = null;
      audioPlayer.stop();

      setTimeout(reportCurrentVisit, 1500);

      const shouldResume = await AutoNavigator.checkAutoResume();
      setTimeout(async () => {
        if (shouldResume && !YouTubeHandler.isYouTubeHost()) {
          resumeNextPage(previousText).catch(error => playerUI.showToast(error.message));
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
      resumeNextPage().catch(error => playerUI.showToast(error.message));
    }, 1500);
  }

  // Listen for messages from background / shortcuts / context menus / sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_STUDY_CONTEXT' || message.action === 'STUDY_JUMP') {
      (async () => {
        if (message.url && message.url !== getCanonicalUrl()) throw new Error('The page changed. Refresh the outline.');
        const data = ContentExtractor.extract();
        const chunks = data.chunks || [];
        if (!chunks.length) throw new Error('No readable article found on this page.');
        const outline = chunks.flatMap((c, index) => /^H[1-6]$/.test(c.element?.tagName || '') ? [{ index, text: c.text }] : []);
        let index = playbackMode === 'article' && lastExtractedUrl === getCanonicalUrl() ? audioPlayer.currentIndex : 0;
        index = Math.max(0, Math.min(index, chunks.length - 1));
        if (message.action === 'STUDY_JUMP') {
          const match = chunks[message.index]?.text === message.text ? message.index : chunks.findIndex(c => c.text === message.text);
          if (match < 0) throw new Error('This passage has changed. Refresh the outline or save a new bookmark.');
          await openPlayer();
          playbackMode = 'article';
          extractedData = data;
          lastExtractedUrl = getCanonicalUrl();
          lastExtractedText = data.contentEl?.textContent || '';
          audioPlayer.setQueue(chunks);
          learningUrl = window.location.href;
          reportCurrentVisit();
          audioPlayer.jumpToIndex(match);
          return { success: true };
        }
        const start = outline.filter(h => h.index <= index).at(-1)?.index || 0;
        const end = outline.find(h => h.index > index)?.index || chunks.length;
        return { url: getCanonicalUrl(), title: data.title || document.title, index, text: chunks[index].text,
          outline, sectionTitle: chunks[start].text, sectionText: chunks.slice(start, end).map(c => c.text || c.caption || '').join('\n').slice(0, 16000) };
      })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
      return true;
    }
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
          handlePlay().catch(error => playerUI.showToast(error.message));
        }
      })();
    } else if (message.action === 'TRIGGER_GEMINI_AUDIO_BRIEF') {
      openPlayer().then(() => handleGeminiBrief());
    } else if (message.action === 'READ_TEXT_SNIPPET') {
      if (message.text) {
        openPlayer().then(() => {
          learningUrl = window.location.href;
          reportCurrentVisit();
          playbackMode = 'selection';
          audioPlayer.setQueue([{ type: 'text', text: message.text, element: null }]);
          audioPlayer.play();
        });
      }
    } else if (message.action === 'AUTO_START_READING') {
      openPlayer().then(() => handlePlay({ resumeArticle: true })).then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
})();
