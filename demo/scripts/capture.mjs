/**
 * Drives the live RelayRoom stack through the full product story and records it
 * to video. Each "beat" is paced to the measured length of its narration clip
 * (demo/assets/audio/manifest.json) and its real start offset is written to
 * demo/assets/capture/timeline.json, so Remotion can lock voiceover, captions
 * and picture together without guessing.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const CAP = path.join(DEMO, 'assets', 'capture');
const RAW = path.join(CAP, 'raw');

const ROOM = process.env.ROOM_URL || 'http://localhost:4173';
const VIEW = { width: 1536, height: 864 };
const VIDEO = { width: 1920, height: 1080 };

const manifest = JSON.parse(fs.readFileSync(path.join(DEMO, 'assets', 'audio', 'manifest.json'), 'utf8'));
const durations = Object.fromEntries(manifest.beats.map((b) => [b.id, b.duration]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 3) => Number(n.toFixed(d));

// Filled in once the veil lifts; the mark recorder reads it through this box so
// it can be handed to the UI helpers before t0 exists.
const t0Ref = { value: Date.now() };

async function main() {
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.mkdirSync(RAW, { recursive: true });

  const browser = await chromium.launch({
    args: [
      // Without this the screencast emits CSS-pixel frames and the recording
      // lands at 1536x864 inside a 1920x1080 canvas. 1536 CSS px x 1.25 is
      // exactly 1920x1080 device px, so the capture is native 1080p with no
      // rescaling, while the app still lays out at a comfortable 1536 width.
      '--force-device-scale-factor=1.25',
      '--high-dpi-support=1',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1.25,
    reducedMotion: 'no-preference',
    recordVideo: { dir: RAW, size: VIDEO },
  });
  const contextStart = Date.now();
  await context.addInitScript({ path: path.join(HERE, 'cursor.js') });
  const page = await context.newPage();

  await page.goto(ROOM, { waitUntil: 'networkidle' });
  await page.waitForSelector('.run-button', { timeout: 20000 });
  // Wait until all three partner iframes have registered and been discovered.
  await page.waitForFunction(() => document.querySelectorAll('.origin-chip b').length === 3, null, { timeout: 20000 });
  await sleep(1800);
  await page.evaluate(() => window.__demoCursor.place(760, 620));

  // Every status change the demo points out is recorded here as a real element
  // rectangle at the real moment it happened, so Remotion can draw the
  // highlight exactly over the thing that changed.
  const marks = [];
  const clock = () => (Date.now() - t0Ref.value) / 1000;
  const ui = makeUi(page, marks, clock);
  const beats = buildBeats(ui, page);

  // t0 is the first frame a viewer will actually see.
  await page.evaluate(() => { window.__demoCursor.lift(); window.__demoCursor.show(); });
  const t0 = Date.now();
  t0Ref.value = t0;
  const t0Offset = (t0 - contextStart) / 1000;
  await sleep(420);

  const timeline = [];
  for (const beat of beats) {
    const startSec = (Date.now() - t0) / 1000;
    const budget = durations[beat.id] ?? 8;
    try {
      await beat.run();
    } catch (error) {
      console.warn(`  ! ${beat.id}: ${error.message}`);
    }
    const spent = (Date.now() - t0) / 1000 - startSec;
    const hold = Math.max(0, budget + 0.4 - spent);
    await sleep(hold * 1000);
    const endSec = (Date.now() - t0) / 1000;
    timeline.push({ id: beat.id, startSec: round(startSec), endSec: round(endSec), audioSec: budget, actionSec: round(spent) });
    console.log(`  ${beat.id.padEnd(14)} start ${startSec.toFixed(2).padStart(7)}s  action ${spent.toFixed(2).padStart(6)}s  audio ${budget.toFixed(2)}s`);
  }

  await page.evaluate(() => window.__demoCursor.hide());
  await sleep(1200);
  const wallClock = (Date.now() - contextStart) / 1000;

  const video = page.video();
  await context.close();
  await browser.close();

  const rawPath = await video.path();
  const mp4 = path.join(CAP, 'relayroom-capture.mp4');
  console.log('\nTranscoding to constant-framerate mp4...');
  // Remotion seeks to arbitrary frames, so the intermediate needs a keyframe
  // every second and no B-frames. A sparse GOP produces
  // "No frame found at position" failures partway through a render.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-r', '30', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-movflags', '+faststart', mp4], { stdio: 'inherit' });

  const videoDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', mp4], { encoding: 'utf8' }).trim());

  const out = {
    video: 'relayroom-capture.mp4',
    videoWidth: VIDEO.width,
    videoHeight: VIDEO.height,
    videoDurationSec: round(videoDuration),
    wallClockSec: round(wallClock),
    firstVisibleSec: round(t0Offset),
    clockDriftRatio: round(videoDuration / wallClock, 5),
    // CSS pixels in the page multiplied by this land on video pixels.
    cssScale: round(VIDEO.width / VIEW.width, 5),
    beats: timeline,
    marks,
  };
  fs.writeFileSync(path.join(CAP, 'timeline.json'), JSON.stringify(out, null, 2));
  console.log(`\nvideo ${videoDuration.toFixed(2)}s vs wall clock ${wallClock.toFixed(2)}s (ratio ${out.clockDriftRatio})`);
  console.log(`first visible frame at ${t0Offset.toFixed(2)}s`);
  console.log(`${marks.length} status highlights recorded`);
  console.log(`wrote ${path.join(CAP, 'timeline.json')}`);
}

function makeUi(page, marks, clock) {
  // Records where a status change happened, right now, in page CSS pixels.
  // Only call this when the page will stay still for the hold - a scroll during
  // the hold would leave the highlight stranded.
  async function mark(selector, options = {}) {
    const { index = 0, all = false, tone = 'change', label, hold = 2.2, pad = 9 } = options;
    const locator = page.locator(selector);
    const targets = all ? await locator.all() : [locator.nth(index)];
    const rects = [];
    for (const el of targets) {
      const b = await el.boundingBox().catch(() => null);
      if (b && b.width > 0 && b.height > 0) {
        rects.push({ x: round(b.x - pad), y: round(b.y - pad), width: round(b.width + pad * 2), height: round(b.height + pad * 2) });
      }
    }
    if (!rects.length) {
      console.warn(`  ! mark "${label ?? selector}": ${selector} not measurable`);
      return;
    }
    marks.push({ atSec: round(clock()), holdSec: hold, tone, label, rects });
  }

  async function box(selector, index = 0) {
    const el = page.locator(selector).nth(index);
    await el.waitFor({ state: 'visible', timeout: 12000 });
    const b = await el.boundingBox();
    if (!b) throw new Error(`no bounding box for ${selector}`);
    return b;
  }

  // The drawn pointer is animated in-page; these real mouse.move calls ride
  // along so hover states are genuine. The loop is bounded by wall clock, not
  // by a step count, so CDP round-trip latency can never stretch the take.
  async function glide(x, y, ms = 720) {
    const from = await page.evaluate(() => window.__demoCursor.pos());
    const moving = page.evaluate(([tx, ty, d]) => window.__demoCursor.glide(tx, ty, d), [x, y, ms]);
    const started = Date.now();
    for (;;) {
      const elapsed = Date.now() - started;
      const t = Math.min(1, elapsed / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (t >= 1) break;
      const slack = 55 - (Date.now() - started - elapsed);
      if (slack > 0) await sleep(Math.min(slack, ms - elapsed));
    }
    await moving;
  }

  async function hover(selector, options = {}) {
    const { index = 0, ms = 720, dwell = 380, dx = 0, dy = 0 } = options;
    const b = await box(selector, index);
    await glide(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, ms);
    if (dwell) await sleep(dwell);
    return b;
  }

  async function click(selector, options = {}) {
    const b = await hover(selector, { dwell: options.dwell ?? 260, ...options });
    const x = b.x + b.width / 2 + (options.dx ?? 0);
    const y = b.y + b.height / 2 + (options.dy ?? 0);
    await page.evaluate(() => window.__demoCursor.click());
    await page.mouse.click(x, y);
    await sleep(options.after ?? 320);
    return b;
  }

  async function clickPoint(x, y, ms = 760, after = 400) {
    await glide(x, y, ms);
    await page.evaluate(() => window.__demoCursor.click());
    await page.mouse.click(x, y);
    await sleep(after);
  }

  async function scrollTo(top, ms = 900) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), top);
    await sleep(ms);
  }

  async function scrollToSelector(selector, offset = -110, ms = 950) {
    const y = await page.locator(selector).first()
      .evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY + off, offset);
    await scrollTo(Math.max(0, y), ms);
  }

  return { page, box, glide, hover, click, clickPoint, scrollTo, scrollToSelector, mark };
}

function buildBeats(ui, page) {
  const { hover, click, clickPoint, glide, scrollTo, scrollToSelector, mark } = ui;

  return [
    {
      id: 'b00_open',
      run: async () => {
        await glide(1050, 300, 1500);
        await sleep(500);
        await glide(700, 470, 1400);
      },
    },
    {
      id: 'b01_signin',
      run: async () => {
        await click('.plan-badge', { ms: 850, after: 600 });
        await click('.demo-accounts button', { ms: 700, after: 380 });
        await click('form .access-primary', { ms: 560, after: 260 });
        await page.waitForSelector('.account-card', { timeout: 12000 });
        await sleep(900);
        await click('.access-primary', { ms: 620, after: 420 });
        await mark('.plan-badge', { tone: 'success', label: 'Signed in · all access', hold: 2.0 });
        await sleep(900);
      },
    },
    {
      id: 'b02_trust',
      run: async () => {
        await hover('.trust-title', { ms: 900, dwell: 700 });
        await hover('.origin-chip', { index: 0, ms: 700, dwell: 900 });
        await hover('.origin-chip', { index: 1, ms: 560, dwell: 900 });
        await hover('.origin-chip', { index: 2, ms: 560, dwell: 900 });
      },
    },
    {
      id: 'b03_tools',
      run: async () => {
        await click('.runtime-button', { ms: 900, after: 850 });
        await hover('.popover-tools > div', { index: 0, ms: 700, dwell: 700 });
        await hover('.popover-tools > div', { index: 2, ms: 520, dwell: 700 });
        await hover('.popover-tools > div', { index: 4, ms: 520, dwell: 900 });
        await click('.popover-head button', { ms: 620, after: 400 });
      },
    },
    {
      id: 'b04_portals',
      run: async () => {
        await scrollToSelector('.portal-section', -60, 1000);
        await hover('.portal-frame header', { index: 0, ms: 800, dwell: 800 });
        await hover('.portal-frame header', { index: 1, ms: 560, dwell: 800 });
        await hover('.portal-frame header', { index: 2, ms: 560, dwell: 800 });
        await scrollTo(0, 1000);
      },
    },
    {
      id: 'b05_resolve',
      run: async () => {
        await click('.run-button', { ms: 950, after: 500 });
        await hover('.evidence-card', { index: 0, ms: 800, dwell: 900 });
        await hover('.evidence-card', { index: 1, ms: 560, dwell: 900 });
        await hover('.evidence-card', { index: 2, ms: 560, dwell: 900 });
        await page.waitForSelector('.approve-button:not([disabled])', { timeout: 45000 });
        await mark('.evidence-card', { all: true, tone: 'success', label: '3 partner origins answered', hold: 2.4 });
        await sleep(1000);
        await mark('.evidence-count', { tone: 'success', label: '3/3 verified', hold: 1.8, pad: 6 });
        await sleep(700);
      },
    },
    {
      id: 'b06_plan',
      run: async () => {
        await hover('.planner-pill', { ms: 900, dwell: 700 });
        await mark('.plan-pills', { tone: 'change', label: 'Plan source + feasibility', hold: 2.0, pad: 7 });
        await sleep(900);
        await hover('.feasible-pill', { ms: 520, dwell: 600 });
        await hover('.planner-note', { ms: 620, dwell: 1600 });
        await hover('.evidence-count', { ms: 700, dwell: 900 });
      },
    },
    {
      id: 'b07_route',
      run: async () => {
        await hover('.node-primary', { ms: 850, dwell: 800 });
        await hover('.node-backup', { ms: 620, dwell: 800 });
        await hover('.node-carrier', { ms: 620, dwell: 800 });
        await hover('.node-buyer', { ms: 620, dwell: 700 });
        await hover('.arrival-badge', { ms: 620, dwell: 500 });
        await hover('.plan-metrics', { ms: 700, dwell: 900 });
      },
    },
    {
      id: 'b08_sequence',
      run: async () => {
        await hover('.sequence-step', { index: 0, ms: 800, dwell: 800 });
        await hover('.sequence-step', { index: 1, ms: 480, dwell: 800 });
        await hover('.sequence-step', { index: 2, ms: 480, dwell: 800 });
        await hover('.plan-guardrails', { ms: 620, dwell: 900 });
        await hover('.approval-note', { ms: 620, dwell: 500 });
        await mark('.origin-chip', { all: true, tone: 'attention', label: 'Read + stage tools only — 2 per origin', hold: 2.4, pad: 6 });
        await sleep(1000);
      },
    },
    {
      id: 'b09_approve',
      run: async () => {
        await click('.approve-button', { ms: 820, after: 400 });
        // Ride down to the partner frames while the commits are still landing.
        await scrollToSelector('.portal-section', -180, 850);
        await hover('.portal-frame', { index: 1, ms: 650, dwell: 650 });
        await hover('.portal-frame', { index: 2, ms: 600, dwell: 550 });
        // The receipt pops itself open on success. Wait for that, dismiss it,
        // and only then point at the trust bar - otherwise the approval's real
        // effect (a third tool on every origin) sits behind the drawer
        // backdrop. b10 reopens the receipt deliberately from the header.
        await page.waitForSelector('.audit-drawer', { timeout: 45000 });
        await sleep(450);
        await click('.audit-drawer header button', { ms: 600, after: 450 });
        await page.waitForSelector('.audit-drawer', { state: 'detached', timeout: 10000 });
        // The trust bar is sticky, so it is on screen at this scroll position.
        await mark('.origin-chip', { all: true, tone: 'success', label: 'Commit tools unlocked — 3 per origin', hold: 2.6, pad: 6 });
        await sleep(1400);
      },
    },
    {
      id: 'b10_audit',
      run: async () => {
        await scrollTo(0, 700);
        if (!(await page.locator('.audit-drawer').count())) {
          await click('.header-nav button', { index: 1, ms: 800, after: 550 });
        }
        await page.waitForSelector('.receipt-meta', { state: 'visible', timeout: 20000 });
        await hover('.receipt-meta', { ms: 700, dwell: 800 });
        await hover('.audit-events article', { index: 0, ms: 620, dwell: 700 });
        await page.locator('.audit-events').first().evaluate((el) => el.scrollTo({ top: 260, behavior: 'smooth' }));
        await sleep(700);
        await hover('.audit-drawer footer button', { ms: 700, dwell: 900 });
      },
    },
    {
      id: 'b11_rollback',
      run: async () => {
        await click('.audit-drawer header button', { ms: 700, after: 500 });
        await scrollTo(0, 800);
        // The reducer's `reset` clears failureRehearsal, so the switch has to be
        // flipped after the re-run and before approval - exactly as a real
        // operator would do it.
        await click('.run-button', { ms: 700, after: 400 });
        await page.waitForSelector('.approve-button:not([disabled])', { timeout: 45000 });
        await sleep(400);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const toggle = await ui.box('.failure-toggle');
          await clickPoint(toggle.x + 14, toggle.y + toggle.height / 2, attempt ? 260 : 720, 420);
          if (await page.locator('.failure-toggle input').isChecked()) break;
        }
        await mark('.failure-toggle', { tone: 'attention', label: 'Carrier failure armed', hold: 1.9, pad: 7 });
        if (!(await page.locator('.failure-toggle input').isChecked())) {
          throw new Error('failure rehearsal switch never latched');
        }
        await sleep(500);
        await click('.approve-button', { ms: 700, after: 400 });
        await page.waitForSelector('.audit-drawer', { timeout: 45000 });
        await sleep(700);
        const headline = await page.locator('.audit-drawer header h2').innerText();
        if (!/rollback/i.test(headline)) console.warn(`  ! expected a rollback receipt, got "${headline}"`);
        await mark('.audit-events article:has(.audit-result.error)', { tone: 'fail', label: 'Carrier commit failed', hold: 2.3, pad: 6 });
        await sleep(1500);
        await hover('.audit-events article', { index: 0, ms: 700, dwell: 500 });
        await mark('.audit-events article', { index: 0, tone: 'success', label: 'Supplier hold released — compensated', hold: 2.4, pad: 6 });
        await sleep(1200);
      },
    },
    {
      id: 'b12_close',
      run: async () => {
        await hover('.receipt-meta', { ms: 700, dwell: 900 });
        await click('.audit-drawer header button', { ms: 620, after: 500 });
        await scrollTo(0, 900);
        await hover('.case-heading h1', { ms: 900, dwell: 1400 });
        await glide(1180, 240, 1200);
      },
    },
  ];
}

main().catch((error) => { console.error(error); process.exit(1); });
