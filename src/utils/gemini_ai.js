/**
 * GeminiAI - Universal Gemini client supporting both Chrome's Built-in On-Device AI
 * (Gemini Nano via window.ai / ai.languageModel) and the cloud Gemini API (Flash).
 * Enhanced with Code Whisperer, Anki Flashcards, and Semantic Vault Search.
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
   * Universal prompt executor
   * @param {string} prompt 
   * @param {string} contextText (Optional webpage / transcript text)
   * @returns {Promise<string>}
   */
  static async query(prompt, contextText = '') {
    const settings = await chrome.storage.local.get(['gemini_api_key', 'gemini_prefer_cloud']);

    // If user has a cloud API key and prefers cloud, or Nano is unavailable, use Cloud Gemini
    if (settings.gemini_api_key) {
      return await this._queryCloudAPI(prompt, contextText, settings.gemini_api_key);
    }

    // Try Chrome Built-in Gemini Nano first
    const nanoAvailable = await this.checkNanoAvailability();
    if (nanoAvailable) {
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

    // Fallback if neither is configured
    return "To enable Ask Gemini, please enter your free Gemini API key in the Side Panel Settings, or enable Chrome's Built-in AI flags (chrome://flags/#prompt-api-for-gemini-nano).";
  }

  /**
   * Cloud Gemini 2.0 / 1.5 Flash API execution
   */
  static async _queryCloudAPI(prompt, contextText, apiKey) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const systemInstruction = "You are LearnFlow AI, an intelligent learning companion for technical tutorials, O'Reilly books, and YouTube videos. Always provide concise, insightful explanations and structure summaries so they sound natural when read aloud by Text-to-Speech.";

    let userMessage = prompt;
    if (contextText) {
      userMessage = `DOCUMENT CONTEXT:\n"""\n${contextText.substring(0, 35000)}\n"""\n\nUSER QUESTION/TASK:\n${prompt}`;
    }

    const body = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: userMessage }]
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
      const errJson = await res.json();
      throw new Error(errJson?.error?.message || `Gemini API error: ${res.status}`);
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
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
   */
  static async summarizeCodeBlock(codeSnippet, language = '') {
    const prompt = `Summarize what this ${language ? language + ' ' : ''}code block does in exactly 1 or 2 clear, spoken sentences for someone listening to an audiobook. Start with "Code snippet:" and explain its purpose and key parameters without reading symbols or syntax.`;
    try {
      const summary = await this.query(prompt, codeSnippet);
      return summary.trim().replace(/^["']|["']$/g, '');
    } catch {
      return `Code snippet in ${language || 'code'} showing implementation details.`;
    }
  }

  /**
   * Generate Anki-ready flashcards (Q&A) from chapter/video content
   */
  static async generateAnkiCards(content) {
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

export { GeminiAI };
