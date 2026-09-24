#!/usr/bin/env node
/**
 * Browser smoke test for the parts Node cannot reach: the WebCodecs encode
 * path, the demo wiring, and the assembled Motion Photo bytes.
 *
 * It drives a headless Chromium over the DevTools protocol using Node's built-in
 * `fetch` and `WebSocket`, so it adds no dependencies.
 *
 *   npm run build
 *   npm run preview          # serves dist-demo on http://localhost:4173
 *   npm run test:e2e         # or: node tools/e2e.mjs http://localhost:4173/
 *
 * Set CHROME_PATH to point at a specific Chrome/Chromium/Edge binary.
 *
 * This exists because a `MessagePort` that is never started (using
 * `addEventListener` instead of `onmessage`) hangs the encoder *only* in a real
 * browser — Node resolves it happily, so unit tests cannot catch that class of
 * bug.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const url = process.argv[2] ?? 'http://localhost:4173/';

// ------------------------------------------------------------------ browser

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ],
};

function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No Chrome/Chromium/Edge found for ${process.platform}. Set CHROME_PATH to the binary.`,
  );
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------------ page script

// NOTE: this is a String.raw template literal. Use '+' for concatenation inside
// it — a backtick or a ${...} sequence here terminates the outer literal.
const PAGE_SCRIPT = String.raw`(async () => {
  const out = {};
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for the app to boot. If it never does, say so plainly — a bare
  // TypeError on a missing element is indistinguishable from a server that
  // simply is not running yet.
  for (let i = 0; i < 100 && !document.querySelector('.chip'); i++) await sleep(100);
  if (!document.querySelector('.chip')) {
    throw new Error(
      'the demo never rendered an effect chip - is the page reachable? ' +
        '(readyState=' +
        document.readyState +
        ', title=' +
        document.title +
        ')',
    );
  }
  const chips = [...document.querySelectorAll('.chip')];
  out.chipCount = chips.length;
  out.chipLabels = chips.map((c) => c.textContent);
  out.exportEnabled = !$('export').disabled;

  // Check rendered visibility, not just the hidden property: an author
  // display rule silently overrides the hidden attribute.
  const shown = (id) => getComputedStyle($(id)).display !== 'none';
  out.initialVisibility = {
    drop: shown('drop'),
    workbench: shown('workbench'),
    progress: shown('progress'),
    result: shown('result'),
  };

  // Locale toggle must actually relabel the UI.
  const before = chips[0] ? chips[0].textContent : '';
  $('locale').click();
  await sleep(250);
  out.labelAfterToggle = document.querySelector('.chip')?.textContent ?? '';
  out.localeChanged = out.labelAfterToggle !== before;
  $('locale').click();
  await sleep(250);

  // Feed a synthetic photo through the real file input.
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 480, 360);
  grad.addColorStop(0, '#12305a');
  grad.addColorStop(0.5, '#e8d8a8');
  grad.addColorStop(1, '#5a1020');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 360);
  ctx.fillStyle = '#fff';
  ctx.fillRect(60, 50, 150, 110);
  ctx.fillStyle = '#101010';
  ctx.fillRect(280, 190, 150, 120);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'test.jpg', { type: 'image/jpeg' }));
  const input = $('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  for (let i = 0; i < 200 && $('workbench').hidden; i++) await sleep(100);
  out.workbenchVisible = !$('workbench').hidden;
  await sleep(1200);

  // The preview canvas must have been painted with real content.
  const preview = $('preview');
  out.previewSize = [preview.width, preview.height];
  const px = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data;
  const colours = new Set();
  for (let i = 0; i < px.length; i += 4 * 17) colours.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
  out.previewColours = colours.size;

  // Capture exported blobs instead of downloading them.
  const captured = [];
  const originalCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    if (b instanceof Blob) captured.push(b);
    return originalCreate(b);
  };

  $('duration').value = '1';
  $('duration').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(900);

  const exportOnce = async (label) => {
    const before2 = captured.length;
    $('export').click();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (!$('result').hidden && captured.length > before2) break;
      await sleep(200);
    }
    const rec = { label, produced: captured.length > before2 };
    const blob = captured[captured.length - 1];
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const latin = new TextDecoder('latin1').decode(bytes);
      rec.bytes = bytes.length;
      rec.jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      rec.motionPhoto = latin.includes('MotionPhoto');
      rec.opCamera = latin.includes('OpCamera');
      rec.oplusFingerprint = latin.includes('pixel_melt_photos');
      rec.icc = latin.includes('ICC_PROFILE');
      rec.mpf = latin.includes('MPF\u0000');
      rec.ftyp = latin.includes('ftyp');
      rec.moov = latin.includes('moov');
      rec.downloadName = $('download').getAttribute('download');
      rec.diagnostics = $('diagnostics').textContent;
    }
    rec.completed = $('progress-text').textContent;
    rec.resultRendered = getComputedStyle($('result')).display !== 'none';
    return rec;
  };

  out.google = await exportOnce('google');

  $('profile').value = 'oplus';
  $('profile').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
  out.oplus = await exportOnce('oplus');

  URL.createObjectURL = originalCreate;
  return out;
})()`;

// ------------------------------------------------------------------ run

const browser = findBrowser();
const profileDir = join(tmpdir(), `pixel-reveal-e2e-${Date.now()}`);
mkdirSync(profileDir, { recursive: true });
const port = 9333 + Math.floor(Math.random() * 400);

console.log(`pixel-reveal e2e\n  browser: ${browser}\n  target : ${url}\n`);

const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--window-size=1100,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    url,
  ],
  { stdio: 'ignore' },
);

const cleanup = () => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};

let ws;
let failures = 0;
try {
  let wsUrl = null;
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('no DevTools target appeared — is the page reachable?');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const consoleProblems = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      consoleProblems.push(details.exception?.description ?? details.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleProblems.push(message.params.args.map((a) => a.description ?? a.value).join(' '));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');

  // A remote page (GitHub Pages, a slow origin) can still be tearing down and
  // recreating execution contexts after `readyState` says "complete", which
  // rejects the evaluation with "Execution context was destroyed". Retry.
  const ready = async () => {
    const state = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    return state.result?.value === 'complete';
  };
  for (let i = 0; i < 80; i++) {
    try {
      if (await ready()) break;
    } catch {
      /* context still swapping */
    }
    await sleep(250);
  }
  await sleep(400);

  let evaluated = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await send('Runtime.evaluate', {
        expression: PAGE_SCRIPT,
        awaitPromise: true,
        returnByValue: true,
      });
      if (!result.exceptionDetails) {
        evaluated = result;
        break;
      }
      // The script itself threw: report it rather than retrying a real failure.
      evaluated = result;
      break;
    } catch (error) {
      const destroyed = String(error.message ?? error).includes('Execution context was destroyed');
      if (!destroyed || attempt === 5) throw error;
      await sleep(1500);
    }
  }
  if (!evaluated) throw new Error('the page never became evaluable');
  if (evaluated.exceptionDetails) {
    throw new Error(
      evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text,
    );
  }
  const report = evaluated.result.value;

  console.log('checks');
  check('demo loaded 9 effects', report.chipCount === 9, `${report.chipCount} chips`);
  check('locale toggle relabels the UI', report.localeChanged, report.labelAfterToggle);
  check('export button enabled', report.exportEnabled);
  check(
    'only the drop zone is rendered before a photo is chosen',
    report.initialVisibility?.drop === true &&
      report.initialVisibility?.workbench === false &&
      report.initialVisibility?.progress === false &&
      report.initialVisibility?.result === false,
    JSON.stringify(report.initialVisibility),
  );
  check('workbench appears after choosing a photo', report.workbenchVisible);
  check('preview canvas is painted', report.previewColours > 5, `${report.previewColours} colours`);
  check(
    'preview decoded at a sane size',
    report.previewSize?.[0] === 480,
    String(report.previewSize),
  );

  const google = report.google ?? {};
  const oplus = report.oplus ?? {};
  check('export (google profile) produced a file', google.produced, google.completed);
  check('  the result panel is rendered after export', google.resultRendered);
  check('  it is a JPEG', google.jpeg);
  check('  it carries Motion Photo metadata', google.motionPhoto);
  check('  it contains an MP4 (ftyp + moov)', google.ftyp && google.moov);
  check('  it carries the ICC profile and MPF segment', google.icc && google.mpf);
  check('  it does NOT carry device identity', !google.opCamera && !google.oplusFingerprint);

  check('export (oplus profile) produced a file', oplus.produced);
  check('  opting in writes OpCamera metadata', oplus.opCamera);
  check(
    '  the two profiles differ',
    oplus.bytes !== google.bytes,
    `${google.bytes} vs ${oplus.bytes}`,
  );

  const realConsoleProblems = consoleProblems.filter((entry) => !/favicon/i.test(entry));
  check('no console errors', realConsoleProblems.length === 0, realConsoleProblems.join(' | '));

  failures = checks.filter((entry) => !entry.ok).length;
} catch (error) {
  console.error(`\ne2e failed: ${error.message}`);
  failures = 1;
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  cleanup();
}

if (checks.length === 0) {
  console.error('the run aborted before any check could execute');
  process.exit(1);
}
console.log(`\n${checks.length - failures}/${checks.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
