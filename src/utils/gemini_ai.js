/**
 * GeminiAI - Universal Gemini client supporting both Chrome's Built-in On-Device AI
 * (Gemini Nano via window.ai / ai.languageModel) and the cloud Gemini API (Flash + Vision).
 * Supports Code Whisperer, Figure Vision Narration, Table Narration, Anki Cards, and Vault Search.
 */
class GeminiAI {
  /**
   * Check if Chrome's on-device Gemini Nano is available
   */
  static async checkNanoAvailability() {
    try {
      if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
        const capabilities = await window.ai.languageModel.capabilities();
        return capabilities.available !== 'no';
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Check whether either Cloud Gemini API key or Chrome Gemini Nano is available
   */
  static async isAvailable() {
    const settings = await chrome.storage.local.get(['gemini_api_key']);
    if (settings.gemini_api_key && settings.gemini_api_key.trim().length > 10) {
      return { available: true, mode: 'cloud', apiKey: settings.gemini_api_key.trim() };
    }
    const nano = await this.checkNanoAvailability();
    if (nano) {
      return { available: true, mode: 'nano', apiKey: null };
    }
    return { available: false, mode: 'none', apiKey: null };
  }

  /**
   * Universal prompt executor
   * @param {string} prompt
   * @param {string} contextText
   * @returns {Promise<string>}
   */
  static async query(prompt, contextText = '') {
    const status = await this.isAvailable();

    if (status.mode === 'cloud') {
      return await this._queryCloudAPI(prompt, contextText, status.apiKey);
    }

    if (status.mode === 'nano') {
      try {
        const session = await window.ai.languageModel.create({
          systemPrompt: 'You are an expert learning assistant. Keep responses clear, concise, well-structured, and ready to be listened to as spoken audio or read as structured notes.'
        });
        const combined = contextText ? `[Context]:\n${contextText.substring(0, 8000)}\n\n[Instruction]:\n${prompt}` : prompt;
        const response = await session.prompt(combined);
        session.destroy();
        return response;
      } catch (err) {
        console.warn('[LearnFlow Gemini] Nano execution failed:', err);
      }
    }

    return "To enable Ask Gemini, please enter your free Gemini API key in the Side Panel Settings (aistudio.google.com), or enable Chrome's Built-in AI flags (chrome://flags/#prompt-api-for-gemini-nano).";
  }

  /**
   * Cloud Gemini 2.0 Flash API execution (supports optional multimodal image inline_data)
   */
  static async _queryCloudAPI(prompt, contextText, apiKey, imageInlineData = null) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const systemInstruction = "You are LearnFlow AI, an intelligent learning companion for technical books, tutorials, and YouTube videos. Always provide concise, insightful explanations that sound natural when read aloud by Text-to-Speech. Never read raw markdown asterisks or symbols.";

    let userMessage = prompt;
    if (contextText) {
      userMessage = `DOCUMENT CONTEXT:\n"""\n${contextText.substring(0, 35000)}\n"""\n\nUSER QUESTION/TASK:\n${prompt}`;
    }

    const parts = [{ text: userMessage }];
    if (imageInlineData && imageInlineData.data && imageInlineData.mimeType) {
      parts.push({
        inline_data: {
          mime_type: imageInlineData.mimeType,
          data: imageInlineData.data
        }
      });
    }

    const body = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        role: 'user',
        parts
      }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Gemini API error: ${res.status}`);
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
  }

  /**
   * Describe a diagram/figure aloud using Gemini Vision (Cloud API)
   * Returns null if cloud API is not configured so AudioPlayer can gracefully fall back to caption.
   */
  static async describeFigure(base64DataUrl, captionText = '') {
    const status = await this.isAvailable();
    if (status.mode !== 'cloud' || !base64DataUrl) {
      return null;
    }

    try {
      const match = base64DataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return null;

      const mimeType = match[1];
      const base64Data = match[2];

      const prompt = `Describe this technical diagram or figure clearly in 2 to 3 concise spoken sentences for an audiobook listener who cannot see the screen. ${captionText ? `Figure caption: "${captionText}". ` : ''}Explain the components, flow/arrows, and main takeaway directly without markdown formatting.`;

      const description = await this._queryCloudAPI(prompt, '', status.apiKey, {
        mimeType,
        data: base64Data
      });
      return description.replace(/[*_`#]/g, '').trim();
    } catch (err) {
      console.warn('[LearnFlow Gemini] Vision figure description failed:', err);
      return null;
    }
  }

  /**
   * Summarize a technical table into natural spoken English
   * Returns null if AI is unavailable so AudioPlayer falls back to structured row reading.
   */
  static async summarizeTable(tableText, captionText = '') {
    const status = await this.isAvailable();
    if (!status.available) return null;

    const prompt = `Summarize the key rows and takeaways of this technical table in 2 to 3 natural spoken sentences suitable for an audiobook listener. ${captionText ? `Table title: "${captionText}".` : ''} Do not use markdown symbols.`;
    try {
      const summary = await this.query(prompt, tableText);
      return summary.replace(/[*_`#]/g, '').trim();
    } catch {
      return null;
    }
  }

  /**
   * Generate an Executive Spoken Audio Brief (2-3 minute summary tailored for TTS)
   */
  static async generateAudioBrief(content) {
    const prompt = "Create a 2-minute executive audio briefing of this content. Write in natural, spoken conversational English that is engaging to listen to via Text-to-Speech. Focus on the core problem, key technical mechanisms, and practical takeaways. Do not include raw markdown symbols, URLs, or code syntax; describe the code concepts in words.";
    return await this.query(prompt, content);
  }

  /**
   * Code Whisperer: Summarize a code block in 1 spoken sentence
   * Returns null if AI is not configured (so AudioPlayer won't speak an error nag mid-book).
   */
  static async summarizeCodeBlock(codeSnippet, language = '') {
    const status = await this.isAvailable();
    if (!status.available) {
      return null;
    }

    const prompt = `Summarize what this ${language ? language + ' ' : ''}code block does in 1 to 2 clear, spoken sentences for someone listening to an audiobook. Start with "Code snippet:" and explain its purpose and key logic without reading syntax symbols.`;
    try {
      const summary = await this.query(prompt, codeSnippet);
      return summary.replace(/[*_`#]/g, '').trim().replace(/^["']|["']$/g, '');
    } catch {
      return null;
    }
  }

  /**
   * Generate Anki-ready flashcards (Q&A) from chapter/video content
   */
  static async generateAnkiCards(content) {
    const status = await this.isAvailable();
    if (!status.available) return '';

    const prompt = `Analyze this technical content and generate 4 to 6 high-yield active-recall flashcards suitable for Anki and spaced repetition. Format each card strictly as:
Q: [Question]
A: [Concise Answer]
---`;
    return await this.query(prompt, content);
  }

  /**
   * Semantic Search across stored vault items
   */
  static async searchVault(vaultItems, userQuery) {
    if (!vaultItems || !vaultItems.length) {
      return "Your vault is currently empty. Archive chapters or videos first!";
    }

    const summaryList = vaultItems.slice(0, 30).map((v, i) => 
      `[${i+1}] Title: ${v.title} | Category: ${v.category} | URL: ${v.url} | Date: ${new Date(v.timestamp).toLocaleDateString()}`
    ).join('\n');

    const prompt = `Here is a list of the user's saved learning archives in their vault:\n\n${summaryList}\n\nBased on this archive list, answer the user's query: "${userQuery}". Identify the most relevant archived items and summarize what the user was studying. Include the title and URL of the best matches.`;
    
    return await this.query(prompt);
  }
}

if (typeof window !== 'undefined') {
  window.GeminiAI = GeminiAI;
}
