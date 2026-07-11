import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchCloakBrowser,
  humanClick,
  humanType,
  humanScroll
} from 'hyper-cloaking-engine';

// P0-a (Phase-0 hard gate): on a REAL humanize:true CloakBrowser context, prove
// the DEFAULT engine-routed input path (locator -> humanClick/humanType/humanScroll)
// is behaviorally humanized (multi-step trusted pointer motion + paced keystrokes),
// and emit a per-method humanized/NOT matrix covering the Option-C emit paths so the
// A-vs-C decision and the refused-path set are grounded in measured behavior.
//
// Set HYPER_CLOAKING_SPIKE=skip to bypass on hosts without a CloakBrowser chromium.

const here = path.dirname(fileURLToPath(import.meta.url));
const matrixPath = path.join(here, '..', '..', 'artifacts', 'humanize-spike-matrix.json');
const artifactsDir = path.join(here, '..', '..', 'artifacts');
const screenshotPath = path.join(artifactsDir, 'humanize-spike-screenshot.png');
const transcriptPath = path.join(artifactsDir, 'humanize-spike-transcript.json');

// Paced human typing produces clearly super-bot inter-keystroke gaps. The engine
// CPM band is 250-270 (=222-240ms/char); observed deltas add a few ms of call
// overhead, so we assert a robust floor well above bot speed (<20ms) rather than
// an exact band.
const PACED_KEYSTROKE_MIN_MS = 180;
const MULTISTEP_POINTER_MIN = 5;

const PAGE_HTML =
  '<!doctype html><meta charset=utf8>' +
  '<body style="margin:0;font-family:sans-serif">' +
  '<header style="background:#1b3a5b;color:#fff;padding:24px">' +
  '<h1>Hyper Cloaking humanize spike</h1>' +
  '<p>Real CloakBrowser context — humanize:true forced.</p></header>' +
  '<main style="padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
  '<section style="background:#e8462b;color:#fff;padding:32px;border-radius:8px">Panel A</section>' +
  '<section style="background:#2b9348;color:#fff;padding:32px;border-radius:8px">Panel B</section>' +
  '<section style="background:#f4a300;color:#111;padding:32px;border-radius:8px">Panel C</section>' +
  '<section style="background:#5a189a;color:#fff;padding:32px;border-radius:8px">Panel D</section>' +
  '</main>' +
  '<div style="padding:24px"><button aria-label="Go" style="padding:12px 24px;font-size:18px">Go</button> ' +
  '<input aria-label="Field" style="padding:12px;font-size:18px;border:2px solid #1b3a5b"></div>' +
  '<canvas id="noise" width="1024" height="240" style="display:block;width:100%;height:240px"></canvas>' +
  '<div style="height:3000px;background:linear-gradient(#fff,#9db4c0)"></div>' +
  '<script>' +
  'window.__moves=[];window.__keys=[];window.__scroll=0;' +
  "(function(){var c=document.getElementById('noise'),x=c.getContext('2d'),d=x.createImageData(c.width,c.height),a=d.data;for(var i=0;i<a.length;i+=4){a[i]=Math.random()*256;a[i+1]=Math.random()*256;a[i+2]=Math.random()*256;a[i+3]=255;}x.putImageData(d,0,0);})();" +
  "addEventListener('mousemove',e=>__moves.push({t:performance.now(),trusted:e.isTrusted}),true);" +
  "addEventListener('keydown',e=>__keys.push({t:performance.now(),trusted:e.isTrusted}),true);" +
  "addEventListener('wheel',e=>__scroll++,true);" +
  '</script></body>';

async function makePage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE_HTML), {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  return page;
}

async function reset(page) {
  await page.evaluate(() => {
    window.__moves = [];
    window.__keys = [];
    window.__scroll = 0;
  });
}

async function metrics(page) {
  return page.evaluate(() => ({
    moves: window.__moves.length,
    movesTrusted: window.__moves.length > 0 && window.__moves.every((m) => m.trusted),
    keys: window.__keys.length,
    keysTrusted: window.__keys.length > 0 && window.__keys.every((k) => k.trusted),
    keyDeltas: window.__keys.slice(1).map((k, i) => Math.round(k.t - window.__keys[i].t)),
    scroll: window.__scroll
  }));
}

test('humanize spike: default engine-routed input is behaviorally humanized + matrix', async (t) => {
  if (process.env.HYPER_CLOAKING_SPIKE === 'skip') {
    t.skip('HYPER_CLOAKING_SPIKE=skip');
    return;
  }
  t.diagnostic('launching real CloakBrowser (humanize:true forced)');
  const { browser } = await launchCloakBrowser({ headless: true });
  const matrix = [];
  const transcript = [];
  try {
    // --- DEFAULT engine-routed path (the shipped input surface) ---
    const page = await makePage(browser);

    await reset(page);
    await humanClick(page, page.locator('button'));
    const click = await metrics(page);
    matrix.push({ method: 'engine.humanClick', path: 'default', ...click });
    assert.ok(click.moves > MULTISTEP_POINTER_MIN, 'humanClick emits a multi-step pointer path');
    assert.ok(click.movesTrusted, 'humanClick pointer events are isTrusted (real CDP input)');

    await reset(page);
    await humanType(page, page.locator('input'), 'hello');
    const type = await metrics(page);
    matrix.push({ method: 'engine.humanType', path: 'default', ...type });
    assert.ok(type.keys >= 5, 'humanType emits one keydown per character');
    assert.ok(type.keysTrusted, 'humanType key events are isTrusted');
    const medianDelta = type.keyDeltas.slice().sort((a, b) => a - b)[Math.floor(type.keyDeltas.length / 2)];
    assert.ok(
      medianDelta >= PACED_KEYSTROKE_MIN_MS,
      `humanType is paced (median inter-keystroke ${medianDelta}ms >= ${PACED_KEYSTROKE_MIN_MS}ms)`
    );

    await reset(page);
    await humanScroll(page, { distance: 800, steps: 6 });
    const scroll = await metrics(page);
    matrix.push({ method: 'engine.humanScroll', path: 'default', ...scroll });
    assert.ok(scroll.scroll > 1, 'humanScroll emits multiple wheel increments');

    transcript.push(
      { step: 1, type: 'launch', selector: 'browser', detail: 'launchCloakBrowser({headless:true}) humanize:true forced', verdict: 'ok' },
      { step: 2, type: 'navigate', selector: 'data:', detail: 'data: page with mousemove/keydown/wheel recorders', verdict: 'ok' },
      { step: 3, type: 'humanClick', selector: 'button', detail: `moves=${click.moves} trusted=${click.movesTrusted}`, verdict: 'humanized' },
      { step: 4, type: 'humanType', selector: 'input', detail: `"hello" keys=${type.keys} deltas=${JSON.stringify(type.keyDeltas)}`, verdict: 'humanized' },
      { step: 5, type: 'humanScroll', selector: 'body', detail: `800px/6steps wheel=${scroll.scroll}`, verdict: 'humanized' }
    );
    await fs.mkdir(artifactsDir, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath });
    transcript.push({ step: 6, type: 'screenshot', selector: 'page', detail: screenshotPath, verdict: 'ok' });

    // --- Option-C emit paths: measure which behaviorally humanize ---
    const cases = [
      ['locator.click', async (p) => p.locator('button').click()],
      ['locator.hover', async (p) => p.locator('button').hover()],
      ['locator.fill', async (p) => p.locator('input').fill('abc')],
      ['locator.press', async (p) => p.locator('input').press('a')],
      ['page.keyboard.press(raw)', async (p) => p.keyboard.press('b')]
    ];
    for (const [method, run] of cases) {
      const cp = await makePage(browser);
      await reset(cp);
      try {
        await run(cp);
        const m = await metrics(cp);
        matrix.push({
          method,
          path: 'option-c',
          ...m,
          pointerHumanized: m.moves > MULTISTEP_POINTER_MIN
        });
      } catch (error) {
        matrix.push({ method, path: 'option-c', error: String(error?.message || error) });
      }
      await cp.context().close();
    }
  } finally {
    await browser.close();
  }

  await fs.mkdir(path.dirname(matrixPath), { recursive: true });
  await fs.writeFile(
    matrixPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), decision: 'Option A (engine-routed input)', matrix },
      null,
      2
    ) + '\n'
  );
  await fs.writeFile(
    transcriptPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'browser-automation-transcript',
        tool: 'cloakbrowser+playwright-core',
        surface: 'web',
        engine: 'cloakbrowser (humanize:true)',
        screenshot: screenshotPath,
        actions: transcript.map((a, i) => ({
          timestamp: new Date(Date.now() + i).toISOString(),
          ...a
        }))
      },
      null,
      2
    ) + '\n'
  );
  t.diagnostic(`humanize matrix written to ${matrixPath}`);
});
