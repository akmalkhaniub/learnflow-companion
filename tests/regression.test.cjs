const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const readSource = relPath => fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');

function driveClient(fetch, settings = {gdrive_webhook_url: 'https://example.test/exec'}, identity) {
  const context = vm.createContext({fetch, Blob, console, chrome: {
    storage: {local: {get: async () => settings}}, identity, runtime: {}
  }});
  vm.runInContext(readSource('src/utils/gdrive.js').replace('export { GDriveSync };', 'globalThis.client = GDriveSync;'), context);
  return context.client;
}
const note = {title: 'Chapter', markdown: '![Figure](images/figure.png)', images: [{filename: 'figure.png', dataUrl: 'data:image/png;base64,YQ=='}]};

test('Section quizzes accept fenced JSON and reject invalid answer keys and duplicate choices', () => {
  const {client} = geminiClient({});
  const questions = Array.from({length: 3}, () => ({question: 'Which?', choices: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'The section explains B.'}));
  assert.equal(client.parseSectionQuiz('```json\n' + JSON.stringify(questions) + '\n```').length, 3);
  questions[0].correctIndex = 4;
  assert.throws(() => client.parseSectionQuiz(JSON.stringify(questions)), /incomplete/);
  questions[0].correctIndex = 0; questions[0].choices[1] = 'a';
  assert.throws(() => client.parseSectionQuiz(JSON.stringify(questions)), /incomplete/);
  assert.throws(() => client.parseSectionQuiz('not JSON'), /unreadable/);
});

test('Section quizzes refuse insufficient source material before requesting AI', async () => {
  const {client} = geminiClient({});
  await assert.rejects(() => client.generateSectionQuiz('A heading'), /too short/);
});

test('Drive reports webhook application errors despite HTTP 200', async () => {
  const client = driveClient(async () => ({ok: true, json: async () => ({status: 'error', message: 'Quota exceeded'})}));
  const result = await client.upload(note);
  assert.equal(result.success, false);
  assert.match(result.error, /Quota exceeded/);
});
test('Drive rejects legacy success responses that do not confirm figures', async () => {
  const client = driveClient(async () => ({ok: true, json: async () => ({status: 'success'})}));
  assert.equal((await client.upload(note)).success, false);
});
test('Drive sends separate images and requires confirmation', async () => {
  let payload;
  const client = driveClient(async (url, options) => {
    payload = JSON.parse(options.body);
    return {ok: true, json: async () => ({status: 'success', imagesSaved: 1})};
  });
  assert.equal((await client.upload(note)).success, true);
  assert.deepEqual(payload.images, note.images);
});
test('Drive propagates HTTP errors and invalid response bodies', async () => {
  for (const response of [
    {ok: false, status: 403, json: async () => ({message: 'Forbidden'})},
    {ok: true, json: async () => { throw new Error('Invalid JSON'); }}
  ]) {
    assert.equal((await driveClient(async () => response).upload(note)).success, false);
  }
});
test('Drive OAuth upload never reports success without a file ID', async () => {
  const client = driveClient(async () => ({ok: false, json: async () => ({error: {message: 'Permission denied'}})}), {}, {getAuthToken: (options, cb) => cb('token')});
  const result = await client.upload(note);
  assert.equal(result.success, false);
  assert.match(result.error, /Permission denied/);
});

function audioClient(summarizeCodeBlock) {
  const spoken = [];
  const synth = {cancel() {}, getVoices: () => [{name: 'Local', lang: 'en', localService: true}], speak: utterance => spoken.push(utterance)};
  const context = vm.createContext({
    window: {speechSynthesis: synth}, document: {querySelectorAll: () => []},
    chrome: {storage: {local: {get: async () => ({})}}},
    AIRouter: {summarizeCodeBlock},
    GeminiAI: {summarizeCodeBlock}, SpeechSynthesisUtterance: function(text) {this.text = text;},
    setInterval: () => 1, clearInterval() {}, console
  });
  vm.runInContext(readSource('src/content/audio_player.js'), context);
  return {player: new context.window.AudioPlayer(), spoken};
}
test('Seeking past pending AI narration ignores the stale result and callback', async () => {
  let resolveSummary;
  const {player, spoken} = audioClient(() => new Promise(resolve => {resolveSummary = resolve;}));
  player.setQueue([{type: 'code', text: 'code'}, {type: 'text', text: 'Next paragraph'}]);
  player.play();
  player.next();
  resolveSummary('Old code summary');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(spoken.map(u => u.text), ['Next paragraph']);
  const oldUtterance = spoken[0];
  player.setQueue([{type: 'text', text: 'Replacement'}]);
  player.play();
  oldUtterance.onend();
  assert.equal(player.currentIndex, 0);
});
test('Pausing during AI generation and resuming restarts the segment', async () => {
  let resolveSummary;
  let calls = 0;
  const {player, spoken} = audioClient(() => ++calls === 1 ? new Promise(resolve => {resolveSummary = resolve;}) : Promise.resolve('Resumed summary'));
  player.setQueue([{type: 'code', text: 'code'}]);
  player.play();
  player.pause();
  resolveSummary('Stale summary');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spoken.length, 0);
  player.play();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(spoken.map(u => u.text), ['Resumed summary']);
});

test('OAuth uploads both Markdown and binary figure into images folder', async () => {
  const uploads = [];
  const client = driveClient(async (url, options) => {
    if (url.startsWith('data:')) return {blob: async () => new Blob(['a'], {type: 'image/png'})};
    if (url.includes('/upload/')) {
      uploads.push(await options.body.text());
      return {ok: true, json: async () => ({id: `file-${uploads.length}`})};
    }
    return {ok: true, json: async () => ({files: [{id: 'folder'}]})};
  }, {}, {getAuthToken: (options, cb) => cb('token')});
  assert.equal((await client.upload(note)).success, true);
  assert.equal(uploads.length, 2);
  assert.match(uploads[0], /text\/markdown/);
  assert.match(uploads[1], /image\/png/);
  assert.match(uploads[1], /figure.png/);
});
test('OAuth rejects successful HTTP upload responses without an ID', async () => {
  const client = driveClient(async () => ({ok: true, json: async () => ({})}));
  await assert.rejects(client._createDriveFile('token', 'note.md', 'text', 'parent'), /upload failed/);
});

test('Speech errors pause at the current sentence instead of skipping to the end', () => {
  const {player, spoken} = audioClient(async () => null);
  let completions = 0;
  player.onComplete = () => completions++;
  player.setQueue([{type: 'text', text: 'First'}, {type: 'text', text: 'Second'}]);
  player.play();
  spoken[0].onerror({error: 'synthesis-failed'});
  assert.equal(player.currentIndex, 0);
  assert.equal(player.isPaused, true);
  assert.equal(completions, 0);
  player.play();
  assert.deepEqual(spoken.map(u => u.text), ['First', 'First']);
});
test('Natural completion retains the last sentence and manual steps never wrap', () => {
  const {player, spoken} = audioClient(async () => null);
  let completions = 0;
  player.onComplete = () => completions++;
  player.setQueue([{type: 'text', text: 'First'}, {type: 'text', text: 'Second'}]);
  player.play();
  spoken[0].onend();
  spoken[1].onend();
  assert.equal(player.currentIndex, 1);
  assert.equal(player.isPlaying, false);
  assert.equal(completions, 1);
  player.next();
  assert.equal(player.currentIndex, 1);
  player.previous();
  player.previous();
  assert.equal(player.currentIndex, 0);
});

test('Progress reaches 100 only after the last sentence finishes', () => {
  const {player, spoken} = audioClient(async () => null);
  const values = [];
  player.onProgress = progress => values.push(progress.percent);
  player.setQueue([{type: 'text', text: 'Only sentence'}]);
  player.play();
  assert.equal(values.at(-1), 0);
  spoken[0].onend();
  assert.equal(values.at(-1), 100);
});

test('Auto-resume belongs to the destination in the same tab and is consumed once', async () => {
  const data = new Map();
  const location = {href: 'https://example.test/chapter-1'};
  const context = vm.createContext({window: {location}, URL, Date, sessionStorage: {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)
  }});
  vm.runInContext(readSource('src/content/auto_navigator.js'), context);
  data.set('learnflow_navigation', JSON.stringify({from: location.href, to: 'https://example.test/chapter-2', timestamp: Date.now()}));
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), false);
  location.href = 'https://example.test/unrelated';
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), false);
  location.href = 'https://example.test/chapter-2';
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), true);
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), false);
});

test('Figure errors are visible, captions are labeled, and failures remain retryable', async () => {
  const {player} = audioClient(async () => null);
  const chunk = {type: 'figure', caption: 'A figure', imgEl: {src: 'data:image/png;base64,YQ=='}};
  assert.equal(await player._describeFigure(chunk), null);
  assert.ok(chunk.figureError);
  assert.equal(chunk.spokenText, undefined);
  assert.equal(chunk.figurePromise, null);
});

test('Section jumps skip directly between headings', () => {
  const {player} = audioClient(async () => null);
  player.play = function () {};
  const heading = {tagName: 'H2'};
  player.setQueue([{type: 'text', element: heading}, {type: 'text'}, {type: 'text'}, {type: 'text', element: heading}]);
  assert.equal(player.jumpSection(1), true);
  assert.equal(player.currentIndex, 3);
  assert.equal(player.jumpSection(-1), true);
  assert.equal(player.currentIndex, 0);
});

function geminiClient(response) {
  let request;
  const context = vm.createContext({window: {}, AbortSignal, console, chrome: {storage: {local: {get: async () => ({gemini_api_key: 'test-key-123456789'})}}},
    fetch: async (url, options) => { request = {url, options, body: JSON.parse(options.body)}; return response; }
  });
  vm.runInContext(readSource('src/utils/gemini_ai.js'), context);
  return {client: context.window.GeminiAI, request: () => request};
}
test('Figure AI sends pixels and context to a current model without storing interactions', async () => {
  const {client, request} = geminiClient({ok: true, json: async () => ({steps: [{type: 'model_output', content: [{type: 'text', text: 'The input flows through the router to the workers.'}]}]})});
  const text = await client.describeFigure('data:image/png;base64,YQ==', 'Router', 'Workers execute the tasks.');
  assert.match(text, /router/);
  const req = request();
  assert.equal(req.body.model, 'gemini-3.5-flash-lite');
  assert.equal(req.body.store, false);
  assert.equal(req.body.input[1].data, 'YQ==');
  assert.match(req.body.input[0].text, /Workers execute/);
  assert.match(req.body.input[0].text, /unreadable/);
  assert.equal(req.url.includes('test-key'), false);
});
test('Figure AI propagates API errors instead of silently pretending to explain', async () => {
  const {client} = geminiClient({ok: false, status: 403, json: async () => ({error: {message: 'API key rejected'}})});
  await assert.rejects(client.describeFigure('data:image/png;base64,YQ==', 'Caption'), /API key rejected/);
});

test('OReilly TOC fallback ignores the current chapter summary fragment', () => {
  const location = {href: 'https://learning.oreilly.com/library/view/book/123/ch01.html#summary'};
  const link = path => ({href: `https://learning.oreilly.com/library/view/book/123/${path}`, textContent: 'Chapter title'});
  const links = [link('ch01.html'), link('ch01.html#summary'), link('ch02.html')];
  const context = vm.createContext({URL, location, window: {location}, document: {
    querySelectorAll: selector => selector.startsWith('nav, aside') ? [{querySelectorAll: () => links}] : []
  }});
  vm.runInContext(readSource('src/content/auto_navigator.js'), context);
  assert.equal(context.window.AutoNavigator.findNextTarget().href, links[2].href);
});

test('Chapter buttons that replace content in place can resume without a URL change', async () => {
  let pending = JSON.stringify({from: 'https://example.test/reader', to: null, content: 'Old chapter', timestamp: Date.now()});
  const context = vm.createContext({URL, Date, window: {location: {href: 'https://example.test/reader'}},
    document: {querySelector: () => ({textContent: 'New chapter'})},
    sessionStorage: {getItem: () => pending, removeItem: () => {pending = null;}}
  });
  vm.runInContext(readSource('src/content/auto_navigator.js'), context);
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), true);
  assert.equal(pending, null);
});

test('Redirected Next links without an explicit destination URL still auto-resume once', async () => {
  const data = new Map();
  const location = {href: 'https://example.test/activities/123'};
  const context = vm.createContext({window: {location}, URL, Date, sessionStorage: {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)
  }});
  vm.runInContext(readSource('src/content/auto_navigator.js'), context);
  data.set('learnflow_navigation', JSON.stringify({from: location.href, timestamp: Date.now()}));
  location.href = 'https://example.test/documents/456';
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), true);
  assert.equal(await context.window.AutoNavigator.checkAutoResume(), false);
});
