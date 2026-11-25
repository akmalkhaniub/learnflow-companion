"""
End-to-End Browser Test Suite for LearnFlow Chrome Extension (Manifest V3)
Launches real Google Chrome with the unpacked extension loaded and verifies:
  1. Service Worker & Content Script load with zero console/runtime errors
  2. Side Panel renders in Light Mode by default & toggles Dark/Light cleanly
  3. Player Bar is hidden by default on page load (on-demand only)
  4. Opening Player Bar injects compact right-docked UI with SVG collapse chevron
  5. Main-content isolation skips TOC/Sidebar and highlights active paragraph
  6. Play progress persists across Close (X) and Reopen (resumes where left off)
  7. MarkdownBuilder extracts figures as separate assets (no inline base64 gibberish)
  8. AutoNavigator locates next chapter link
"""

import http.server
import os
import shutil
import socketserver
import tempfile
import threading
import time
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

EXT_PATH = str(Path(__file__).resolve().parent.parent)
EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# Tiny 100x100 solid blue PNG as valid test figure
TEST_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAA"
    "cklEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4Gg5kAAFr"
    "31xWAAAAAElFTkSuQmCC"
)

MOCK_CH4_HTML = f"""<!DOCTYPE html>
<html>
<head><title>4 Architecting multi-agent systems | AI Agents in Action</title></head>
<body>
  <header role="banner"><nav><a href="/">Home</a><a href="/search">Search</a></nav></header>
  <aside class="sidebar toc" role="navigation">
    <h2>Table of Contents</h2>
    <ul>
      <li><a href="/oreilly-ch1.html">1 Introduction to Agents</a></li>
      <li><a href="/oreilly-ch2.html">2 Single Agent Loops</a></li>
      <li><a href="/oreilly-ch3.html">3 Tool Calling</a></li>
      <li><a href="/oreilly-ch4.html">4 Architecting multi-agent systems</a></li>
    </ul>
  </aside>
  <main>
    <div id="sbo-rt-content">
      <h1>4 Architecting multi-agent systems</h1>
      <p>Multi-agent systems coordinate specialized agents to solve complex tasks.</p>
      <p>This second paragraph tests sentence progression and resume state persistence.</p>
      <figure>
        <img src="data:image/png;base64,{TEST_PNG_BASE64}" width="120" height="120" alt="Figure 4.1 Architecture" />
        <figcaption>Figure 4.1 Three core multi-agent patterns.</figcaption>
      </figure>
      <table>
        <thead><tr><th>Pattern</th><th>Control</th></tr></thead>
        <tbody><tr><td>Orchestrator</td><td>Centralized hub</td></tr></tbody>
      </table>
      <pre><code class="language-python">def run_agent(task):
    return task.upper()</code></pre>
      <section id="jump-target" style="margin-top:1200px"><h2>Jump target section</h2><p>This section tests reading from the visible location.</p></section>
      <section id="later-target" style="margin-top:1200px"><h2>Later section</h2><p>This section tests jumping forward by heading.</p></section>
      <a data-testid="next-link" href="/oreilly-ch5.html">Next Chapter 5 Agent Handoffs</a>
    </div>
  </main>
</body>
</html>"""

MOCK_CH5_HTML = """<!DOCTYPE html>
<html>
<head><title>5 Agent Handoffs | AI Agents in Action</title></head>
<body><div id="sbo-rt-content"><h1>5 Agent Handoffs</h1><p>Welcome to chapter 5.</p></div></body>
</html>"""

MOCK_SKILLS_HTML = """<!DOCTYPE html>
<html>
<head><title>Google Cloud Skills Boost Lab</title></head>
<body>
  <ql-drawer-container class="has-header drawer-layout">
    <ql-header><nav><a href="/">Catalog</a></nav></ql-header>
    <main>
      <ql-lab-page>
        <ql-markdown id="skills-md"></ql-markdown>
      </ql-lab-page>
    </main>
  </ql-drawer-container>
  <script>
    const host = document.getElementById('skills-md');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <h1>Deploy a Cloud Run Service</h1>
      <p>In this lab you will deploy a containerized microservice to Google Cloud Run.</p>
      <p>First verify your active project and region in Cloud Shell.</p>
    `;
  </script>
</body>
</html>"""


class QuietHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        if "oreilly-ch5" in self.path:
            self.wfile.write(MOCK_CH5_HTML.encode("utf-8"))
        elif "skills-lab" in self.path:
            self.wfile.write(MOCK_SKILLS_HTML.encode("utf-8"))
        else:
            self.wfile.write(MOCK_CH4_HTML.encode("utf-8"))

    def log_message(self, format, *args):
        pass


def start_mock_server():
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), QuietHandler)
    server.daemon_threads = True
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port


def run_tests():
    sys.stdout.reconfigure(line_buffering=True)
    server, port = start_mock_server()
    user_data_dir = tempfile.mkdtemp(prefix="lf_e2e_")
    errors = []

    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                executable_path=EDGE_EXE,
                headless=False,
                args=[
                    "--headless=new",
                    f"--disable-extensions-except={EXT_PATH}",
                    f"--load-extension={EXT_PATH}",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
            )

            # 1. Discover Extension ID from Service Worker
            sw = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
            ext_id = sw.url.split("/")[2]
            print(f"[PASS] 1. Extension & MV3 Service Worker loaded (ID: {ext_id})")

            # 2. Open mock O'Reilly page -> verify player bar is NOT auto-shown
            page = context.new_page()
            page.on("pageerror", lambda err: errors.append(f"PageError: {err}"))
            page.on("console", lambda msg: errors.append(f"ConsoleError: {msg.text}") if msg.type == "error" else None)

            page.goto(f"http://127.0.0.1:{port}/oreilly-ch4.html", wait_until="networkidle")
            time.sleep(1.0)
            assert page.locator("#learnflow-player-root").count() == 0, "Player bar should NOT auto-show on page load!"
            print("[PASS] 2. Player bar stays hidden by default on page load (on-demand)")

            # 3. Open Side Panel & verify Light Mode default + Dark toggle + Player toggle
            sp = context.new_page()
            sp.on("pageerror", lambda err: errors.append(f"SidePanelError: {err}"))
            sp.goto(f"chrome-extension://{ext_id}/src/sidepanel/sidepanel.html", wait_until="domcontentloaded")
            time.sleep(0.5)

            assert not sp.locator("body").evaluate("el => el.classList.contains('dark-theme')"), "Side panel should default to Light Mode!"
            assert sp.locator("#tab-home").is_visible(), "Home must be the default tab"
            sp.locator('.tab-btn[data-tab="gemini"]').click()
            assert sp.locator("#gemini-setup-banner").is_visible(), "Inline Gemini API setup banner should be visible when unconfigured!"
            assert sp.locator("#btn-toggle-page-player").inner_text().strip() == "▶ Read Page", "Read Page button should have clear label!"
            sp.locator("#btn-theme-toggle").click()
            assert sp.locator("body").evaluate("el => el.classList.contains('dark-theme')"), "Theme toggle should switch to Dark Mode!"
            sp.locator("#btn-theme-toggle").click()
            assert not sp.locator("body").evaluate("el => el.classList.contains('dark-theme')"), "Theme toggle should switch back to Light Mode!"
            print("[PASS] 3. Side Panel defaults to Light Mode & toggles Light/Dark cleanly")

            untouched_history = sp.evaluate("async () => (await chrome.storage.local.get('learnflow_history')).learnflow_history || []")
            assert untouched_history == [], "Unrelated browsing must not be recorded"

            # 4. Trigger OPEN_PLAYER on the O'Reilly tab via extension runtime messaging
            sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                if (!tabs.length) throw new Error('Mock tab not found');
                await chrome.tabs.sendMessage(tabs[0].id, { action: 'OPEN_PLAYER' });
            }""")
            page.wait_for_selector("#learnflow-player-root", timeout=5000)

            assert page.locator("#learnflow-player-root.dock-right.lf-light").count() == 1, "Player should default to dock-right & lf-light!"
            assert page.locator("#lf-btn-minimize svg").count() == 1, "Standard SVG collapse chevron should be present!"
            page.locator("#lf-btn-minimize").click()
            assert page.locator("#lf-main-bar.minimized").count() == 1, "Collapse button should minimize the bar!"
            page.locator("#lf-btn-minimize").click()
            assert page.locator("#lf-main-bar.minimized").count() == 0, "Clicking chevron again should expand the bar!"
            print("[PASS] 4. On-demand Player Bar opens in compact Light dock-right mode with SVG chevron collapse")

            # 5. Test Play, Highlight inside #sbo-rt-content (NOT sidebar!), Next, Close (X), and Resume
            page.locator("#lf-btn-play").click()
            time.sleep(0.4)

            highlighted_in_main = page.locator("#sbo-rt-content .learnflow-active-reading").count()
            highlighted_in_sidebar = page.locator("aside.sidebar .learnflow-active-reading").count()
            assert highlighted_in_main >= 1, "Active paragraph inside #sbo-rt-content must be highlighted!"
            assert highlighted_in_sidebar == 0, "Sidebar/TOC must NEVER be highlighted or read!"

            # Advance 2 segments and verify progress
            page.locator("#lf-btn-next").click()
            time.sleep(0.2)
            page.locator("#lf-btn-next").click()
            time.sleep(0.3)
            prog_before_close = page.locator("#lf-progress-text").inner_text()
            assert prog_before_close != "0%", f"Progress should advance after Next clicks, got {prog_before_close}"

            # Close via X button -> bar removed, then reopen -> resumes at saved progress!
            page.locator("#lf-btn-close").click()
            assert page.locator("#learnflow-player-root").count() == 0, "Close (X) button must remove the bar!"

            sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                await chrome.tabs.sendMessage(tabs[0].id, { action: 'OPEN_PLAYER' });
            }""")
            page.wait_for_selector("#learnflow-player-root", timeout=5000)
            time.sleep(0.4)
            prog_after_reopen = page.locator("#lf-progress-text").inner_text()
            assert prog_after_reopen == prog_before_close, f"Expected resume at {prog_before_close}, got {prog_after_reopen}"
            print(f"[PASS] 5. Main-content highlighted (sidebar ignored), Close (X) & Resume preserved progress ({prog_after_reopen})")

            # 6. Click real Archive button (#lf-btn-archive) -> verify clean archival & Vault card in Side Panel
            page.locator("#lf-btn-archive").click()
            sp.evaluate("""async () => {
                for (let i = 0; i < 150; i++) {
                    const data = await chrome.storage.local.get('learnflow_vault_items');
                    if (data.learnflow_vault_items?.length) return;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }""")

            vault_state = sp.evaluate("""async () => {
                const d = await chrome.storage.local.get(['learnflow_vault_items']);
                return d.learnflow_vault_items || [];
            }""")
            assert len(vault_state) >= 1, "Archive button must save item into learnflow_vault_items!"
            latest = vault_state[0]
            assert latest["imagesSaved"] == 1, f"Expected 1 separate figure image saved, got {latest['imagesSaved']}"
            assert "4 Architecting multi-agent systems" in latest["localFile"], f"Unexpected localFile: {latest['localFile']}"

            # Verify Vault tab in Side Panel renders the Show-in-Folder button & path
            sp.locator('.tab-btn[data-tab="vault"]').click()
            time.sleep(0.3)
            assert sp.locator("#vault-items-list .btn-show-folder").count() >= 1, "Vault card must show 'Show in Folder' button!"
            print(f"[PASS] 6. Real Archive saved clean Markdown + 1 separate PNG figure ({latest['localFile']})")

            # 7. Verify History tab recorded exact chapter URL (not homepage)
            sp.locator('.tab-btn[data-tab="history"]').click()
            time.sleep(0.3)
            history_urls = sp.evaluate("""async () => {
                const d = await chrome.storage.local.get(['learnflow_history']);
                return (d.learnflow_history || []).map(h => h.url);
            }""")
            assert any("oreilly-ch4.html" in u for u in history_urls), f"History should record exact URL, got {history_urls}"
            print("[PASS] 7. History recorded exact chapter URL cleanly")

            navigation = sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                const [result] = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => {
                    const fixture = document.createElement('article');
                    fixture.innerHTML = '<p style="margin:0;overflow:hidden">First sentence. <strong>Repeated sentence.</strong>  Repeated sentence. Final sentence.</p><blockquote><p>Nested quotation.</p></blockquote>';
                    document.body.append(fixture);
                    const paragraph = fixture.querySelector('p');
                    const before = paragraph.getBoundingClientRect();
                    const chunks = ContentExtractor._extractChunks(fixture);
                    const player = new AudioPlayer();
                    player.setQueue(chunks);
                    const highlights = [];
                    for (let i = 0; i < chunks.length; i++) {
                        player.seekTo(i);
                        highlights.push(CSS.highlights.get('learnflow-sentence').values().next().value.toString());
                    }
                    player.seekTo(2);
                    const repeatedRange = CSS.highlights.get('learnflow-sentence').values().next().value;
                    const secondRepeatNode = repeatedRange.startContainer === paragraph.lastChild;
                    const style = getComputedStyle(paragraph);
                    const noInsetStripe = style.boxShadow === 'none';
                    const sameWidth = paragraph.getBoundingClientRect().width === before.width;
                    player.next(); player.previous();
                    const staysAtSentence = player.currentIndex === 2;
                    window.__navigationFixture = fixture;
                    window.__navigationPlayer = player;
                    return {texts: chunks.map(c => c.text), highlights, secondRepeatNode, noInsetStripe, sameWidth, staysAtSentence};
                }});
                return result.result;
            }""")
            assert navigation['texts'] == navigation['highlights'], navigation
            assert navigation['texts'].count('Nested quotation.') == 1, navigation
            assert all(navigation[key] for key in ['secondRepeatNode', 'noInsetStripe', 'sameWidth', 'staysAtSentence']), navigation
            navigation_artifacts = Path(EXT_PATH) / 'tests' / 'artifacts'
            navigation_artifacts.mkdir(exist_ok=True)
            page.screenshot(path=str(navigation_artifacts / 'sentence-highlight.png'))
            sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => {
                    window.__navigationPlayer.stop(); window.__navigationFixture.remove();
                }});
            }""")
            print('[PASS] 12. Exact sentence highlights, repeated text, nested prose, and layout-safe stepping')

            # Briefs and selections must preserve article progress and never archive/advance.
            state_before = sp.evaluate("async () => await chrome.storage.local.get(['learnflow_play_progress', 'learnflow_vault_items'])")
            for action in ['TRIGGER_GEMINI_AUDIO_BRIEF', 'READ_TEXT_SNIPPET']:
                sp.evaluate("""async (action) => {
                    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                    const tabId = tabs[0].id;
                    await chrome.scripting.executeScript({target: {tabId}, func: () => {
                        AudioPlayer.prototype.play = function () { window.__testPlayer = this; this.isPlaying = true; this._notifyProgress(); };
                        GeminiAI.generateAudioBrief = async () => 'A short test brief.';
                    }});
                    await chrome.tabs.sendMessage(tabId, {action, text: 'Selected test passage.'});
                }""", action)
                time.sleep(0.3)
                sp.evaluate("""async () => {
                    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                    await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: async () => {
                        await window.__testPlayer.onComplete();
                    }});
                }""")
                state_after = sp.evaluate("async () => await chrome.storage.local.get(['learnflow_play_progress', 'learnflow_vault_items'])")
                assert state_after == state_before, f"{action} must preserve article progress and archives"
            print('[PASS] 9. Brief and selection completion preserve article progress and archives')

            sp.locator('.tab-btn[data-tab="home"]').click()
            assert sp.locator('#btn-home-resume').inner_text() == '▶ Resume reading'
            assert 'Architecting' in sp.locator('#home-resume-title').inner_text()
            sp.locator('#btn-home-resume').click()
            expect(sp.locator("#home-status")).to_contain_text("Reader started")
            generation_before = sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                const [result] = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => {
                    history.replaceState(null, '', '#reading-section');
                    return window.__testPlayer.playbackGeneration;
                }});
                return result.result;
            }""")
            page.wait_for_timeout(1800)
            generation_after = sp.evaluate("""async () => {
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                const [result] = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => window.__testPlayer.playbackGeneration});
                return result.result;
            }""")
            assert generation_after == generation_before, 'Hash navigation must not reset playback'
            sp.set_viewport_size({'width': 380, 'height': 820})
            page_output = Path(EXT_PATH) / 'tests' / 'artifacts'
            page_output.mkdir(exist_ok=True)
            sp.screenshot(path=str(page_output / 'home-light.png'), full_page=True)
            sp.locator('#btn-theme-toggle').click()
            sp.wait_for_timeout(300)
            sp.screenshot(path=str(page_output / 'home-dark.png'), full_page=True)
            sp.locator('#btn-theme-toggle').click()
            print('[PASS] 10. Resume-first home displays saved article and renders both themes')

            # Use actual toolbar controls after scrolling to a later section.
            page.locator('#jump-target').scroll_into_view_if_needed()
            page.locator('#lf-read-here-quick').click()
            def current_reader_text():
                return sp.evaluate("""async () => {
                    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                    const [result] = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => window.__testPlayer.chunks[window.__testPlayer.currentIndex].text});
                    return result.result;
                }""")
            assert 'Jump target' in current_reader_text()
            page.locator('#lf-btn-settings').click()
            page.locator('#lf-section-next').click()
            assert 'Later section' in current_reader_text()
            page.locator('#lf-section-prev').click()
            assert 'Jump target' in current_reader_text()
            expect(page.locator('#lf-navigation-status')).to_contain_text('Next detected')
            page.screenshot(path=str(page_output / 'reader-controls.png'))
            page.locator('#lf-follow-scroll').check()
            page.mouse.move(300, 300)
            page.mouse.wheel(0, 1250)
            page.wait_for_timeout(1200)
            assert ('Later section' in current_reader_text() or 'jumping forward' in current_reader_text()), current_reader_text()
            page.locator('#lf-btn-settings').click()
            if not page.locator('#lf-follow-scroll').is_visible():
                page.locator('#lf-btn-settings').click()
            page.locator('#lf-follow-scroll').uncheck()
            print('[PASS] 14. Read-here and heading controls jump directly to scrolled sections')

            # Learn a nonstandard control through Choose Next without navigating on selection.
            page.locator('#lf-choose-next').click()
            page.locator('a[data-testid="next-link"]').click()
            assert 'oreilly-ch4' in page.url
            expect(page.locator('#lf-navigation-status')).to_contain_text('Next detected')
            print('[PASS] 15. Choose Next captures the target without an accidental navigation')

            # Study tools use the real content script; only generated quiz content is stubbed.
            page.bring_to_front()
            sp.locator('[data-tab="study"]').click()
            expect(sp.locator('#study-outline button')).to_have_count(3)
            sp.locator('#study-outline button').first.click()
            expect(sp.locator('#study-passage')).to_contain_text('Architecting')
            sp.locator('#study-note').fill('Remember the coordination pattern.')
            sp.locator('#study-save').click()
            expect(sp.locator('#study-bookmarks textarea')).to_have_value('Remember the coordination pattern.')
            sp.locator('#study-bookmarks textarea').fill('Updated personal note')
            sp.locator('#study-bookmarks button', has_text='Save note').click()
            expect(sp.locator('#study-status')).to_have_text('Note saved.')
            sp.locator('#study-bookmarks button', has_text='Read from here').click()
            expect(sp.locator('#study-status')).to_have_text('Reading bookmarked passage.')
            sp.evaluate('''() => { AIRouter.generateSectionQuiz = async () => Array.from({length: 3}, (_, i) => ({question: 'Question ' + i, choices: ['Correct choice', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Supported by the section.'})); }''')
            sp.locator('#study-quiz').click()
            expect(sp.locator('#study-questions fieldset')).to_have_count(3)
            assert 'Supported by' not in sp.locator('#study-questions').inner_text()
            for i in range(3):
                sp.locator(f'input[name="quiz-{i}"][value="0"]').check()
            sp.locator('#study-questions button').click()
            expect(sp.locator('#study-status')).to_contain_text('3 / 3 correct')
            sp.screenshot(path=str(navigation_artifacts / 'study-tools.png'))
            sp.locator('#study-bookmarks button', has_text='Delete').click()
            expect(sp.locator('#study-bookmarks')).to_have_text('No bookmarks yet.')
            print('[PASS] 16. Study outline, bookmark notes, passage resume, deletion and quiz scoring')

            # New destination must start before being removed from queue.
            result = sp.evaluate("""async (url) => {
                await chrome.storage.local.set({learnflow_playlist: [{url, title: 'Next chapter', addedAt: 1}]});
                return await chrome.runtime.sendMessage({action: 'PLAYLIST_ADVANCE'});
            }""", f'http://127.0.0.1:{port}/oreilly-ch5.html')
            assert result.get('success'), result
            assert sp.evaluate("async () => (await chrome.storage.local.get('learnflow_playlist')).learnflow_playlist") == []
            result = sp.evaluate("""async () => {
                await chrome.storage.local.set({learnflow_playlist: [{url: 'chrome://settings', title: 'Unsupported', addedAt: 2}]});
                return await chrome.runtime.sendMessage({action: 'PLAYLIST_ADVANCE'});
            }""")
            assert not result.get('success'), 'Unsupported queue destinations must report failure'
            assert len(sp.evaluate("async () => (await chrome.storage.local.get('learnflow_playlist')).learnflow_playlist")) == 1
            print('[PASS] 11. Queue acknowledges new-page playback and preserves failed items')

            # Real completion callback -> next document -> automatic reader start.
            await_result = sp.evaluate("""async () => {
                await chrome.storage.local.set({learnflow_playlist: [], learnflow_auto_advance_enabled: true, learnflow_nav_delay: 1});
                const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
                const source = tabs.find(tab => tab.url.includes('oreilly-ch4.html'));
                const [result] = await chrome.scripting.executeScript({target: {tabId: source.id}, func: async () => {
                    GeminiAI.generateAnkiCards = () => { throw new Error('Auto-advance must not wait for AI flashcards'); };
                    const player = window.__testPlayer;
                    player.setQueue([{type: 'text', text: 'The final sentence.', element: null}]);
                    player.synth = {cancel() {}, speak(utterance) { window.__completionUtterance = utterance; }};
                    player.isPlaying = true;
                    await player._speakChunk(0);
                    const progressBefore = document.querySelector('#lf-progress-text').textContent;
                    window.__completionUtterance.onend();
                    return {progressBefore, progressAfter: document.querySelector('#lf-progress-text').textContent};
                }});
                return result.result;
            }""")
            assert await_result['progressBefore'] != '100%', await_result
            assert await_result['progressAfter'] == '100%', await_result
            page.wait_for_url(f'http://127.0.0.1:{port}/oreilly-ch5.html', timeout=15000)
            page.wait_for_selector('#learnflow-player-root', timeout=10000)
            page.wait_for_selector('.learnflow-active-reading', timeout=10000)
            print('[PASS] 13. Final sentence completes, navigates to next chapter, and resumes reading')

            # 17. AI Provider switcher (Firebase AI Logic <-> Direct Gemini)
            sp.locator('.tab-btn[data-tab="settings"]').click()
            sp.select_option('#setting-ai-provider', 'direct_gemini')
            assert sp.locator('#direct-gemini-settings-panel').is_visible()
            assert not sp.locator('#firebase-settings-panel').is_visible()
            sp.select_option('#setting-ai-provider', 'firebase_ai_logic')
            assert sp.locator('#firebase-settings-panel').is_visible()
            assert not sp.locator('#direct-gemini-settings-panel').is_visible()
            sp.fill('#setting-firebase-config', '{"apiKey":"AIzaTestKey123456","projectId":"test-proj","appId":"1:123:web:abc"}')
            sp.fill('#setting-appcheck-token', 'debug-token-123')
            sp.click('#btn-save-firebase-config')
            stored_provider = sp.evaluate("async () => (await chrome.storage.local.get(['learnflow_ai_provider', 'learnflow_firebase_config']))")
            assert stored_provider['learnflow_ai_provider'] == 'firebase_ai_logic'
            assert stored_provider['learnflow_firebase_config']['projectId'] == 'test-proj'
            print('[PASS] 17. AI Provider switcher persists Firebase AI Logic + App Check & Direct Gemini')

            # 18. Same-origin iframe CSS.highlights, code stepping, remote jumpSection, and redirect auto-resume
            iframe_check = page.evaluate("""async () => {
                const frame = document.createElement('iframe');
                document.body.appendChild(frame);
                frame.contentDocument.open();
                frame.contentDocument.write('<!doctype html><html><body><h2>Frame Section 1</h2><p>First iframe sentence. Second iframe sentence.</p><pre><code>const x = 42;</code></pre><h2>Frame Section 2</h2><p>Final iframe sentence.</p></body></html>');
                frame.contentDocument.close();

                const chunks = ContentExtractor._extractChunks(frame.contentDocument.body);
                const p = new AudioPlayer();
                p.setQueue(chunks);
                p._highlightChunk(chunks[1]);
                const hasIframeSentenceHighlight = frame.contentWindow.CSS.highlights.has('learnflow-sentence');
                p.next(); // -> Second iframe sentence
                p.next(); // -> <pre> code block
                const codeEl = chunks[3].element;
                const codeHasActive = codeEl.classList.contains('learnflow-active-reading') && codeEl.classList.contains('learnflow-block-highlight');
                p._clearHighlight();
                const clearedIframeHighlight = !frame.contentWindow.CSS.highlights.has('learnflow-sentence') && !codeEl.classList.contains('learnflow-active-reading');

                // Remote heading jumpSection (when element is null, e.g. cross-origin iframe)
                const pRemote = new AudioPlayer();
                pRemote.synth = { cancel() {}, speak() {} };
                pRemote.setQueue([
                  { type: 'text', text: 'Intro', headingLevel: 1, element: null },
                  { type: 'text', text: 'Body', headingLevel: 0, element: null },
                  { type: 'text', text: 'Next Heading', headingLevel: 2, element: null }
                ]);
                const jumpedRemote = pRemote.jumpSection(1) && pRemote.currentIndex === 2;

                // Redirected Next-page auto-resume (skills.google /activities/... -> /documents/...)
                sessionStorage.setItem('learnflow_navigation', JSON.stringify({
                  from: 'https://www.skills.google/paths/1/activities/100',
                  timestamp: Date.now()
                }));
                const redirectResumed = await AutoNavigator.checkAutoResume();

                frame.remove();
                return { hasIframeSentenceHighlight, codeHasActive, clearedIframeHighlight, jumpedRemote, redirectResumed };
            }""")
            assert all(iframe_check.values()), iframe_check
            print('[PASS] 18. Same-origin iframe highlights, code block stepping, remote jumpSection & redirect auto-resume')

            assert not errors, f"Runtime errors detected: {errors}"
            print("[PASS] 8. Zero console/runtime errors across extension & page")

            context.close()
    finally:
        server.shutdown()
        shutil.rmtree(user_data_dir, ignore_errors=True)

    print("\nALL 16 E2E BROWSER TESTS PASSED!")


if __name__ == "__main__":
    run_tests()
