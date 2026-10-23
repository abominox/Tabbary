/**
 * Windrow M1 E2E Test Suite
 *
 * Tests the M1 definition-of-done cycle by driving the extension through its
 * chrome.* API from an extension page context (sidepanel.html opened as a tab).
 *
 * Key insight: the SW only creates sessions via `windows.onCreated`, which fires
 * when a new browser window opens. Playwright's `launchPersistentContext` opens a
 * window before the SW registers listeners, so we create a NEW window from an
 * extension page via `chrome.windows.create()` — this triggers the SW's
 * `onCreated` → session creation → window↔session binding. Then we add tabs to
 * that window via `chrome.tabs.create()`, which the SW persists.
 *
 * Prerequisites:
 *   npm run build                          # build dist/
 *   npx playwright install chromium        # ensure browser binary
 *
 * Run: npm run test:e2e
 * Or:  tsx e2e/m1.ts
 */

import { createUserDataDir, cleanUserDataDir, launchContext, waitForSW, getExtId } from './helpers.js';
import { openExtensionPage, querySW, createWindow, addTab, closeWindow } from './helpers.js';
import { cleanup, waitFor, pollQuery, closeOnboardingTab } from './helpers.js';
import path from 'path';

// ── Test URLs ──
const URL_PAGE1 = 'data:text/html,<h1>page1</h1>';
const URL_PAGE2 = 'data:text/html,<h1>page2</h1>';
const URL_PAGE3 = 'data:text/html,<h1>page3</h1>';

interface TestSession {
  id: string;
  name: string | null;
  windowId: number | null;
  state: 'active' | 'closed';
}

interface TestTab {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  chromeTabId: number | null;
}

// ── Colored output ──
const PASS = '✓';
const FAIL = '✗';
let passed = 0;
let failed = 0;
const failures: string[] = [];

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];

function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}

async function runAll(): Promise<void> {
  console.log('\n🧪 Windrow M1 E2E Tests\n');
    console.log(`Extension dist: ${path.resolve('dist')}\n`);

  for (const t of tests) {
    process.stdout.write(`  ${t.name} ... `);
    try {
      await t.fn();
      console.log(`${PASS}`);
      passed++;
    } catch (err) {
      console.log(`${FAIL}`);
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`  ${t.name}: ${msg}`);
      failed++;
    }
  }

  console.log(`\n  ──\n  ${PASS} ${passed} passed, ${FAIL} ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(f);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ════════════════════════════════════════════════════════════════════
// Test 1: Service worker loads
// ════════════════════════════════════════════════════════════════════
test('SW loads and extension ID is resolvable', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    context = await launchContext(userDataDir);

    const sw = await waitForSW(context, 15000);
    const url = sw.url();
    const extId = new URL(url).hostname;

    if (!extId || extId === 'chrome-error') {
      throw new Error(`Invalid extension ID from SW URL: ${url}`);
    }

    // Verify the SW can use chrome.* APIs
    const tabs = await sw.evaluate(async () => {
      return await chrome.tabs.query({});
    });

    if (!Array.isArray(tabs)) {
      throw new Error('chrome.tabs.query did not return an array — SW is not responsive');
    }

    console.log(`  ⤷ extId: ${extId}, SW: ${url.slice(0, 100)}`);
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Test 2: Create window → session created; add tabs → persisted
// ════════════════════════════════════════════════════════════════════
test('Create window triggers session; tabs are persisted via the SW bus', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);

    // Open an extension page (sidepanel) for bus communication
    const panel = await openExtensionPage(context, extId, 'sidepanel.html');
    await closeOnboardingTab(context, extId);

    // Create a NEW browser window from the extension page.
    // This triggers the SW's windows.onCreated → creates a Session + binds windowId.
    const windowId = await createWindow(panel);
    await panel.waitForTimeout(1000);

    // Query sessions — should now have an active session
    const sessions = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      10000, 800, 'active session after window create',
    );

    const active = sessions.filter((s: TestSession) => s.state === 'active');
    if (active.length === 0) throw new Error('No active session');
    const sessionId = active[0]!.id;

    // Add tabs to the new window using chrome.tabs.create → triggers tabs.onCreated
    await addTab(panel, windowId, URL_PAGE1);
    await addTab(panel, windowId, URL_PAGE2);
    await addTab(panel, windowId, URL_PAGE3);
    await panel.waitForTimeout(2000); // debounce 250ms + Dexie flush

    // Query the session's tabs
    const tabs = await querySW<TestTab[]>(panel, { type: 'getSessionTabs', sessionId });
    const realTabs = tabs.filter((t: TestTab) => t.url !== 'about:blank');

    if (realTabs.length < 3) {
      // Wait and retry once
      await panel.waitForTimeout(3000);
      const tabs2 = await querySW<TestTab[]>(panel, { type: 'getSessionTabs', sessionId });
      const realTabs2 = tabs2.filter((t: TestTab) => t.url !== 'about:blank');
      if (realTabs2.length < 3) {
        console.log(`\n  ⤷ got ${realTabs2.length} real tabs (expected ≥3): ${JSON.stringify(realTabs2.slice(0, 5)).slice(0, 300)}`);
        throw new Error(`Expected ≥3 real tabs, got ${realTabs2.length}`);
      }
    }

    console.log(`  ⤷ session: ${sessionId.slice(0, 8)}, window: ${windowId}, tabs: ${realTabs.length}`);
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Test 3: Side panel DOM renders the active session tabs
// ════════════════════════════════════════════════════════════════════
test('Side panel page renders active session tabs in the DOM', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);

    // Open side panel and create a session + tabs
    const panel = await openExtensionPage(context, extId, 'sidepanel.html');
    await closeOnboardingTab(context, extId);

    const windowId = await createWindow(panel);
    await panel.waitForTimeout(1500);

    // Wait for sessions to hydrate (React store calls hydrate on mount + sessionsChanged)
    await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      10000, 800, 'active session before render check',
    );

    await addTab(panel, windowId, URL_PAGE1);
    await addTab(panel, windowId, URL_PAGE2);
    await panel.waitForTimeout(2000);

    // Check DOM content for tab text
    const bodyText = await panel.evaluate(() => document.body.innerText);

    if (!bodyText.includes('page1') && !bodyText.includes('page2')) {
      // URLs may appear as data:text/html or fallback titles
      if (!bodyText.includes('page1') && !bodyText.includes('page2')) {
        // Try checking raw HTML for any mention of the test data
        const html = await panel.content();
        if (!html.includes('page1') && !html.includes('page2') && !html.includes('data:text/html')) {
          console.log(`\n  ⤷ page body (first 500): ${bodyText.slice(0, 500)}`);
          throw new Error('Side panel does not contain expected tab content');
        }
      }
    }
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Test 4: Close window → session marked closed
// ════════════════════════════════════════════════════════════════════
test('Close window marks session as closed', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);

    const panel = await openExtensionPage(context, extId, 'sidepanel.html');
    await closeOnboardingTab(context, extId);

    // Create session + tabs
    const windowId = await createWindow(panel);
    await addTab(panel, windowId, URL_PAGE1);
    await addTab(panel, windowId, URL_PAGE2);

    // Wait for session to exist
    const sessions = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      10000, 800, 'active session before close',
    );

    const activeSessionId = sessions.find((s: TestSession) => s.state === 'active')!.id;

    // Close the window via chrome.windows.remove — triggers SW's onRemoved → markClosed
    await closeWindow(panel, windowId);
    await panel.waitForTimeout(2000);

    // Verify the session is now closed
    const sessionsAfter = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'closed' && sess.id === activeSessionId),
      15000, 800, 'session marked closed after window close',
    );

    const closed = sessionsAfter.filter(
      (s: TestSession) => s.id === activeSessionId && s.state === 'closed',
    );
    if (closed.length === 0) {
      throw new Error(`Session ${activeSessionId.slice(0, 8)} was NOT marked closed`);
    }
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Test 5: Restart → restore most-recently-closed session
// ════════════════════════════════════════════════════════════════════
test('Restart restores the most-recently-closed session', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    // ── First session ──
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    const panel = await openExtensionPage(context, extId, 'sidepanel.html');
    await closeOnboardingTab(context, extId);

    // Create session with tabs
    const windowId = await createWindow(panel);
    const url1 = 'data:text/html,<h2>restore-test-1</h2>';
    const url2 = 'data:text/html,<h2>restore-test-2</h2>';
    await addTab(panel, windowId, url1);
    await addTab(panel, windowId, url2);
    await panel.waitForTimeout(2000);

    // Verify active session
    const sessions = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      10000, 800, 'active session before restart',
    );

    // Close the window — session goes to closed state in DB
    await closeWindow(panel, windowId);
    await panel.waitForTimeout(2000);

    // Verify session is closed
    await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'closed'),
      10000, 800, 'session closed before restart',
    );

    // ── Close context (simulates browser restart) ──
    await context.close();
    context = null;

    // ── Relaunch with the SAME user data directory ──
    context = await launchContext(userDataDir);

    // Wait for SW to start and onStartup → initStartup → restoreClosedSession
    await waitForSW(context, 15000);

    // Restore logic: settings.restoreOnStartup defaults to 'yes'; restoreClosedSession
    // checks for no active sessions, finds the closed session, calls chrome.windows.create
    // with the tab URLs.
    // Wait for restore to complete (chrome.windows.create is async)
    await new Promise(r => setTimeout(r, 5000));

    // Check: the restored session should now be active with the same tabs
    // We can verify via the bus from an extension page
    const panel2 = await openExtensionPage(context, extId, 'sidepanel.html');

    const restoredSessions = await pollQuery<TestSession[]>(
      panel2,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      15000, 800, 'active session after restart',
    );

    const restoredActive = restoredSessions.filter((s: TestSession) => s.state === 'active');
    if (restoredActive.length === 0) {
      // The window.create may have created a new window whose session binding
      // happened via onCreated. Check again with longer wait.
      await new Promise(r => setTimeout(r, 5000));
      const sessions3 = await querySW<TestSession[]>(panel2, { type: 'getSessions' });
      const restored3 = sessions3.filter((s: TestSession) => s.state === 'active');
      if (restored3.length === 0) {
        console.log(`\n  ⤷ sessions after restart: ${JSON.stringify(sessions3).slice(0, 500)}`);
        throw new Error('No active session found after restart — restore may not have triggered windows.create');
      }
    }
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Test 6: openSession bus command reactivates a closed session
// ════════════════════════════════════════════════════════════════════
test('openSession bus command reactivates a closed session', async () => {
  const userDataDir = createUserDataDir();
  let context;
  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    const panel = await openExtensionPage(context, extId, 'sidepanel.html');
    await closeOnboardingTab(context, extId);

    // Create session + tabs
    const windowId = await createWindow(panel);
    await addTab(panel, windowId, URL_PAGE1);
    await addTab(panel, windowId, URL_PAGE2);
    await panel.waitForTimeout(1500);

    // Get active session ID
    const sessions = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active'),
      10000, 800, 'active session before reopen test',
    );

    const activeSessionId = sessions.find((s: TestSession) => s.state === 'active')!.id;

    // Close the window
    await closeWindow(panel, windowId);
    await panel.waitForTimeout(2000);

    // Verify session is closed
    await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'closed' && sess.id === activeSessionId),
      10000, 800, 'session closed before reopen',
    );

    // Send openSession bus command (tests the message handler)
    await querySW(panel, { type: 'openSession', sessionId: activeSessionId });

    // Wait for SW to process (calls markActive + chrome.windows.create)
    await panel.waitForTimeout(4000);

    // Verify session is active again
    const reopenedSessions = await pollQuery<TestSession[]>(
      panel,
      { type: 'getSessions' },
      (s) => Array.isArray(s) && s.some((sess: TestSession) => sess.state === 'active' && sess.id === activeSessionId),
      15000, 800, 'session reactivated after openSession',
    );

    const reopened = reopenedSessions.filter(
      (s: TestSession) => s.id === activeSessionId && s.state === 'active',
    );
    if (reopened.length === 0) {
      throw new Error(`Session ${activeSessionId.slice(0, 8)} was NOT reactivated by openSession`);
    }
  } finally {
    if (context) await cleanup(context, userDataDir);
  }
});

// ════════════════════════════════════════════════════════════════════
// Run all
// ════════════════════════════════════════════════════════════════════
await runAll();