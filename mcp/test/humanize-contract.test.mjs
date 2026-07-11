import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchCloakBrowser } from 'hyper-cloaking-engine';
import { createSessionManager } from '../src/session-manager.mjs';
import { makeInteractTools } from '../src/tools/interact.mjs';

// Phase-2 load-bearing gate: cloak_click / cloak_type drive the ENGINE humanized
// input path. This asserts humanized motion AND proves the assertion has teeth by
// showing a non-humanized (synthetic DOM-dispatched) click produces no such motion.
//
// Set HYPER_CLOAKING_SPIKE=skip to bypass on hosts without a CloakBrowser chromium.

const MULTISTEP_POINTER_MIN = 5;
const PACED_KEYSTROKE_MIN_MS = 150;

const PAGE_HTML =
  '<!doctype html><meta charset=utf8><body>' +
  '<button aria-label="Go">Go</button> <input aria-label="Field">' +
  '<script>' +
  'window.__moves=[];window.__keys=[];' +
  "addEventListener('mousemove',e=>__moves.push({trusted:e.isTrusted}),true);" +
  "addEventListener('keydown',e=>__keys.push({t:performance.now(),trusted:e.isTrusted}),true);" +
  '</script></body>';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

test('cloak_click/cloak_type produce humanized motion; synthetic click does not (teeth)', async (t) => {
  if (process.env.HYPER_CLOAKING_SPIKE === 'skip') {
    t.skip('HYPER_CLOAKING_SPIKE=skip');
    return;
  }
  let page;
  const manager = createSessionManager();
  const launched = await manager.launch(async () => {
    const { browser } = await launchCloakBrowser({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE_HTML), {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    return { browser, context, page };
  });
  assert.equal(launched.status, 'launched');

  const [, clickTool, typeTool] = makeInteractTools(manager);
  try {
    await page.evaluate(() => { window.__moves = []; });
    const click = payload(await clickTool.handler({ selector: 'button' }));
    assert.equal(click.status, 'ok');
    const clickMoves = await page.evaluate(() => window.__moves);
    assert.ok(clickMoves.length > MULTISTEP_POINTER_MIN, 'cloak_click emits a multi-step pointer path');
    assert.ok(clickMoves.every((m) => m.trusted), 'cloak_click pointer events are isTrusted');

    await page.evaluate(() => { window.__keys = []; });
    const type = payload(await typeTool.handler({ selector: 'input', text: 'hello' }));
    assert.equal(type.status, 'ok');
    const keys = await page.evaluate(() => window.__keys);
    assert.ok(keys.length >= 5 && keys.every((k) => k.trusted), 'cloak_type keystrokes are trusted');
    const deltas = keys.slice(1).map((k, i) => k.t - keys[i].t).sort((x, y) => x - y);
    assert.ok(deltas[Math.floor(deltas.length / 2)] >= PACED_KEYSTROKE_MIN_MS, 'cloak_type is paced');

    // Teeth: a synthetic (non-humanized) DOM click emits NO trusted pointer motion,
    // so the humanized assertion above would fail for a non-humanized implementation.
    await page.evaluate(() => {
      window.__moves = [];
      document.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const syntheticMoves = await page.evaluate(() => window.__moves);
    assert.equal(syntheticMoves.length, 0, 'synthetic click produces no humanized pointer motion');
  } finally {
    await manager.teardown({ force: true });
  }
});
