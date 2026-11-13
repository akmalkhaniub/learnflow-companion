/**
 * content_main.js - Orchestrates content extraction, audio playback,
 * Ask Gemini Audio Briefings, Code Whisperer, Multi-Tab Queue, and auto-advancing.
 */
(async function initLearnFlowContent() {
  console.log('[LearnFlow] Content script initializing on:', window.location.href);

  // Initialize Core Engines
  const audioPlayer = new AudioPlayer();
  let extractedData = null;

  // Archival function
  const handleArchive = async () => {
    try {
      if (playerUI) playerUI.showToast('Archiving with figures & tables...');

      let archivePayload = null;

      if (YouTubeHandler.isYouTube()) {
        const ytData = await YouTubeHandler.buildVideoStudyGuide(true);
        archivePayload = {
          title: ytData.title,
          category: ytData.category,
          bookTitle: ytData.channel,
          chapterTitle: ytData.title,
          url: ytData.url,
          markdown: ytData.markdown
        };
      } else {
        if (!extractedData) {
          extractedData = ContentExtractor.extract();
        }

        const mdContent = await MarkdownBuilder.elementToMarkdown(extractedData.contentEl, {
          embedImagesAsBase64: true
        });

        // Also ask Gemini to generate 3-4 Anki flashcards to append
        let flashcardSection = '';
        try {
          const rawSample = extractedData.contentEl.textContent.trim().substring(0, 10000);
          const ankiCards = await GeminiAI.generateAnkiCards(rawSample);
          if (ankiCards && ankiCards.includes('Q:')) {
            flashcardSection = `\n\n## 📇 Active Recall & Flashcards\n\n${ankiCards}\n\n`;
          }
        } catch (e) {
          console.log('[LearnFlow] Anki generation skipped:', e);
        }

        const fullMarkdown = `# ${extractedData.title}\n\n` +
          `**Source URL:** [${window.location.href}](${window.location.href})\n` +
          `**Archived At:** ${new Date().toLocaleString()}\n\n---\n\n` +
          mdContent + flashcardSection;

        archivePayload = {
          title: extractedData.title,
          category: extractedData.category,
          bookTitle: extractedData.bookTitle,
          chapterTitle: extractedData.chapterTitle,
          url: window.location.href,
          markdown: fullMarkdown
        };
      }

      chrome.runtime.sendMessage({
        action: 'ARCHIVE_PAGE',
        payload: archivePayload
      }, (response) => {
        if (response && response.success) {
          if (playerUI) playerUI.showToast('✓ Saved to Local Vault & Google Drive!');
        } else {
          if (playerUI) playerUI.showToast('Saved locally (' + (response?.error || 'ready') + ')');
        }
      });
    } catch (err) {
      console.error('[LearnFlow] Archive error:', err);
      if (playerUI) playerUI.showToast('Archive error: ' + err.message);
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
        if (!extractedData) extractedData = ContentExtractor.extract();
        rawText = extractedData.contentEl.textContent.trim().substring(0, 20000);
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

    playlist.push({
      title: document.title,
      url: window.location.href,
      siteType: ContentExtractor.getSiteType(),
      addedAt: Date.now()
    });

    await chrome.storage.local.set({ learnflow_playlist: playlist });
    if (playerUI) playerUI.showToast(`📑 Added to Playlist Queue (#${playlist.length})`);
  };

  // Instantiate UI
  const playerUI = new PlayerUI(audioPlayer, handleArchive, handleGeminiBrief, handleAddToQueue);
  playerUI.init();

  // If not YouTube, extract readable text chunks
  if (!YouTubeHandler.isYouTube()) {
    extractedData = ContentExtractor.extract();
    if (extractedData.chunks && extractedData.chunks.length > 0) {
      audioPlayer.setQueue(extractedData.chunks);
      console.log(`[LearnFlow] Extracted ${extractedData.chunks.length} segments from:`, extractedData.title);
    }

    // End of chapter reached
    audioPlayer.onComplete = async () => {
      console.log('[LearnFlow] Audio reached end of section.');
      await handleArchive();

      // Check if playlist queue has more tabs waiting
      const data = await chrome.storage.local.get(['learnflow_playlist']);
      if (data.learnflow_playlist && data.learnflow_playlist.length > 0) {
        playerUI.showToast('Switching to next item in Playlist Queue in 2s...');
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

  // Automatic Page Tracking
  chrome.runtime.sendMessage({
    action: 'LOG_PAGE_VISIT',
    payload: {
      title: document.title,
      url: window.location.href,
      siteType: ContentExtractor.getSiteType(),
      timestamp: Date.now()
    }
  });

  // Check if we arrived here through Auto-Advance or Playlist Queue
  const shouldAutoResume = await AutoNavigator.checkAutoResume();
  if (shouldAutoResume) {
    console.log('[LearnFlow] Auto-resume flag detected. Starting audio playback in 1.2s...');
    setTimeout(async () => {
      playerUI.showToast('Auto-playing next chapter...');
      audioPlayer.play();
      handleArchive();
    }, 1200);
  }

  // Listen for messages from background / shortcuts / context menus
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'TOGGLE_PLAY') {
      if (audioPlayer.isPlaying) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
    } else if (message.action === 'TRIGGER_GEMINI_AUDIO_BRIEF') {
      handleGeminiBrief();
    } else if (message.action === 'READ_TEXT_SNIPPET') {
      if (message.text) {
        audioPlayer.setQueue([{ type: 'text', text: message.text, element: null }]);
        audioPlayer.play();
      }
    } else if (message.action === 'AUTO_START_READING') {
      audioPlayer.play();
    }
  });
})();
