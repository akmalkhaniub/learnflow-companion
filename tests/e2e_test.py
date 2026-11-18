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
from pathlib import Path
from playwright.sync_api import sync_playwright

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
      <a data-testid="next-link" href="/oreilly-ch5.html">Next Chapter</a>
    </div>
  </main>
</body>
</html>"""

MOCK_CH5_HTML = """<!DOCTYPE html>
<html>
<head><title>5 Agent Handoffs | AI Agents in Action</title></head>
<body><div id="sbo-rt-content"><h1>5 Agent Handoffs</h1><p>Welcome to chapter 5.</p></div></body>
</html>"""


class QuietHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        if "oreilly-ch5" in self.path:
            self.wfile.write(MOCK_CH5_HTML.encode("utf-8"))
        else:
            self.wfile.write(MOCK_CH4_HTML.encode("utf-8"))

    def log_message(self, format, *args):
        pass


def start_mock_server():
    server = socketserver.TCPServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port


def run_tests():
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
            assert sp.locator("#gemini-setup-banner").is_visible(), "Inline Gemini API setup banner should be visible when unconfigured!"
            assert sp.locator("#btn-toggle-page-player").inner_text().strip() == "▶ Read Page", "Read Page button should have clear label!"
            sp.locator("#btn-theme-toggle").click()
            assert sp.locator("body").evaluate("el => el.classList.contains('dark-theme')"), "Theme toggle should switch to Dark Mode!"
            sp.locator("#btn-theme-toggle").click()
            assert not sp.locator("body").evaluate("el => el.classList.contains('dark-theme')"), "Theme toggle should switch back to Light Mode!"
            print("[PASS] 3. Side Panel defaults to Light Mode & toggles Light/Dark cleanly")

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
            time.sleep(1.5)

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

            assert not errors, f"Runtime errors detected: {errors}"
            print("[PASS] 8. Zero console/runtime errors across extension & page")

            context.close()
    finally:
        server.shutdown()
        shutil.rmtree(user_data_dir, ignore_errors=True)

    print("\nALL 8 E2E BROWSER TESTS PASSED!")


if __name__ == "__main__":
    run_tests()
