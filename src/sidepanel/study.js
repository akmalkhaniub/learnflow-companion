/* Study tools deliberately request article content only on user action. */
document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);
  let context = null;
  let generation = 0;
  const status = text => { el('study-status').textContent = text; };
  const button = (text, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary-btn'; b.textContent = text;
    b.addEventListener('click', () => Promise.resolve().then(action).catch(e => status(e.message))); return b;
  };
  async function activeContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Open an article first.');
    let data;
    try { data = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STUDY_CONTEXT' }); }
    catch { throw new Error('Open a web article and refresh its tab to enable Study.'); }
    if (!data || data.error) throw new Error(data?.error || 'No readable section found.');
    return { ...data, tabId: tab.id };
  }
  async function refresh() {
    const token = ++generation; context = null; el('study-outline').replaceChildren(); el('study-questions').replaceChildren(); el('study-passage').textContent = '';
    status('Loading current section…');
    try {
      const data = await activeContext(); if (token !== generation) return;
      context = data; status(`${data.title} — ${data.sectionTitle}`); el('study-passage').textContent = data.text;
      for (const heading of data.outline) el('study-outline').append(button(heading.text, async () => {
        const result = await chrome.tabs.sendMessage(data.tabId, { action: 'STUDY_JUMP', url: data.url, ...heading });
        if (result?.error) throw new Error(result.error);
        await refresh();
      }));
      if (!data.outline.length) el('study-outline').textContent = 'This page has no headings. You can still bookmark and quiz its text.';
    } catch (e) { if (token === generation) status(e.message); }
  }
  async function bookmarks() {
    const { learnflow_bookmarks: items = [] } = await chrome.storage.local.get('learnflow_bookmarks');
    el('study-bookmarks').replaceChildren();
    if (!items.length) el('study-bookmarks').textContent = 'No bookmarks yet.';
    for (const item of items) {
      const card = document.createElement('div'); card.className = 'settings-card';
      const title = document.createElement('strong'); title.textContent = item.title;
      const quote = document.createElement('p'); quote.textContent = item.text;
      const note = document.createElement('textarea'); note.className = 'text-input'; note.value = item.note; note.maxLength = 4000; note.setAttribute('aria-label', `Note for ${item.title}`);
      async function update(remove) {
        const latest = (await chrome.storage.local.get('learnflow_bookmarks')).learnflow_bookmarks || [];
        await chrome.storage.local.set({ learnflow_bookmarks: remove ? latest.filter(b => b.id !== item.id) : latest.map(b => b.id === item.id ? { ...b, note: note.value } : b) });
        await bookmarks(); status(remove ? 'Bookmark deleted.' : 'Note saved.');
      }
      card.append(title, quote, note, button('Read from here', async () => {
        const result = await chrome.runtime.sendMessage({ action: 'RESUME_READING', url: item.url, passage: { index: item.index, text: item.text } });
        if (!result?.success) throw new Error(result?.error || 'Could not open bookmark.');
        status('Reading bookmarked passage.');
      }), button('Save note', () => update(false)), button('Delete', () => update(true)));
      el('study-bookmarks').append(card);
    }
  }
  el('study-save').addEventListener('click', async () => {
    el('study-save').disabled = true;
    try {
      const data = await activeContext();
      const items = (await chrome.storage.local.get('learnflow_bookmarks')).learnflow_bookmarks || [];
      const existing = items.find(b => b.url === data.url && b.text === data.text);
      if (!existing && items.length >= 500) throw new Error('Your 500 bookmarks are full. Delete one before adding another.');
      const item = { id: existing?.id || crypto.randomUUID(), url: data.url, title: data.title, index: data.index, text: data.text, note: el('study-note').value, updatedAt: Date.now() };
      await chrome.storage.local.set({ learnflow_bookmarks: [item, ...items.filter(b => b.id !== item.id)] });
      el('study-note').value = ''; await bookmarks(); status('Bookmark and note saved on this device.');
    } catch (e) { status(e.message); } finally { el('study-save').disabled = false; }
  });
  el('study-quiz').addEventListener('click', async () => {
    const token = ++generation; el('study-quiz').disabled = true; el('study-questions').replaceChildren();
    try {
      const data = await activeContext(); status(`Creating a quiz: ${data.sectionTitle}`);
      const questions = await AIRouter.generateSectionQuiz(data.sectionText);
      if (token !== generation) return;
      const form = el('study-questions');
      const source = document.createElement('p'); source.textContent = `Quiz: ${data.sectionTitle}`; form.append(source);
      questions.forEach((q, index) => {
        const field = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = q.question; field.append(legend);
        q.choices.forEach((choice, option) => {
          const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'radio'; input.name = `quiz-${index}`; input.value = option; input.required = true;
          label.append(input, document.createTextNode(choice)); field.append(label);
        }); form.append(field);
      });
      const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary-btn'; submit.textContent = 'Check answers'; form.append(submit);
      form.onsubmit = event => {
        event.preventDefault(); let score = 0;
        questions.forEach((q, index) => {
          const correct = Number(new FormData(form).get(`quiz-${index}`)) === q.correctIndex; if (correct) score++;
          const explanation = document.createElement('p'); explanation.textContent = `${correct ? 'Correct' : 'Review'} — ${q.choices[q.correctIndex]}. ${q.explanation}`;
          form.querySelectorAll('fieldset')[index].append(explanation);
        });
        form.querySelectorAll('input, button').forEach(input => { input.disabled = true; }); status(`${score} / ${questions.length} correct. Review the section to check the explanations.`);
      }; status('Choose one answer per question, then check your answers.');
    } catch (e) { if (token === generation) status(e.message); } finally { el('study-quiz').disabled = false; }
  });
  el('study-refresh').addEventListener('click', refresh);
  document.querySelector('[data-tab="study"]').addEventListener('click', () => { refresh(); bookmarks().catch(e => status(e.message)); });
  const invalidate = () => { ++generation; context = null; el('study-outline').replaceChildren(); el('study-questions').replaceChildren(); el('study-passage').textContent = ''; status('Page changed. Refresh current section to study this page.'); };
  chrome.tabs.onActivated?.addListener(invalidate);
  chrome.tabs.onUpdated?.addListener((id, change) => { if (context?.tabId === id && change.url) invalidate(); });
});
