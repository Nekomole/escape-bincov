/**
 * #83 mk-a29 natural route play on the real clock: deploy from the yard's departure panel (the ordinary street entry,
 * now the market world), walk the front or the service route of docs/story/CH01-MARKET-SLICE.md section 2.2 with real
 * keys, open the tool cabinet with E, take what it holds by double-click, (service route) check the breaker on the way,
 * then walk to the nearest active exit and hold E to extract. Enemy AI runs as in play; the bot only shoots back at a
 * visible enemy close by. The test hook only reads state: no teleports, clock changes, health or inventory edits.
 * Usage: node --import tsx scripts/market-route-play.mjs --route=front|service [--seed=42] [--out=test-results/market-route]
 * A bot run is evidence for reachability and timing, not a human playtest.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { deployFromYard } from './yard-entry.mjs';
import { corridor, spacePath } from '../src/spatial.ts';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const routeName = option('route', 'front'), seed = Number(option('seed', '42'));
assert.ok(['front', 'service'].includes(routeName), '--route=front|service');
const out = resolve(option('out', 'test-results/market-route')); await mkdir(out, { recursive: true });
const html = await readFile(option('html', 'dist/index.html'), 'utf8');
const T = 32, at = (x, y) => ({ x: (x + .5) * T, y: (y + .5) * T });
const APPROACH = at(5, 33);
// Section 2.2 waypoints after the common approach point; the last one is the stand point before the cabinet.
const ROUTES = {
  front: [[20, 33], [25, 33], [25, 36], [26, 37], [27, 38]],
  service: [[5, 43], [25, 43], [25, 41], [25, 40], [26, 40], [28, 40], [27, 38]],
};
const report = { route: routeName, seed, startedAt: new Date().toISOString(), marks: [], hits: 0, shots: 0, errors: [] };
const browser = await chromium.launch(browserOptions);
const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } });
await ctx.route('https://route.test/**', r => r.fulfill({ contentType: 'text/html', body: html }));
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', e => report.errors.push(String(e.message)));
const state = () => page.evaluate(() => {
  const a = window.__bincov.app, h = window.__bincovSample?.host;
  if (a.state !== 'run' || !h?.lastBatch) return { state: a.state, result: a.save.lastResult ?? null };
  const b = h.lastBatch, f = b.frame;
  return { state: a.state, t: b.stamp.simulationTime, left: f.hud.timeLeft, hp: f.hud.hp, maxHp: f.hud.maxHp, high: f.hud.highTide, x: f.player.x, y: f.player.y, panel: h.panel,
    mag: f.hud.weapon.mag, magSize: f.hud.weapon.magSize, reloading: f.hud.weapon.reloading, heals: f.hud.heals, kills: window.__bincovSample.driver.killCount(),
    map: { cells: b.map.cells, tile: b.map.tile, doors: b.map.doors, entries: b.map.entries, id: b.stamp.world.mapId }, doors: f.doors,
    exits: b.map.exits.map(e => ({ id: e.id, name: e.name, ...e.at })), interaction: f.interaction && { kind: f.interaction.kind, label: f.interaction.label, hold: f.interaction.hold },
    enemies: f.actors.filter(e => e.alive && e.uid !== 'player').map(e => ({ x: e.x, y: e.y })), clues: h.services.story().recall.map(r => r.id),
    breaker: h.services.storySources().some(s => s.ref.id === 'ch01-sc-breaker' && s.available), bag: a.loadout.bag.items.map(i => [i.id, i.qty]) };
});
let held = new Set();
async function keys(next) {
  for (const k of held) if (!next.has(k)) await page.keyboard.up(k);
  for (const k of next) if (!held.has(k)) await page.keyboard.down(k);
  held = next;
}
const mark = (label, s, extra = {}) => { const row = { label, t: +(s.t ?? 0).toFixed(1), left: +(s.left ?? 0).toFixed(1), hp: Math.round(s.hp ?? 0), kills: s.kills ?? 0, ...extra }; report.marks.push(row); console.log(JSON.stringify(row)); };
const space = s => ({ definition: s.map, doors: s.doors, highTide: s.high });
let healedAt = 0;
/**
 * Survive the way a plain player would: heal with Q below 55% (one use per 4 s), reload an empty magazine with R, and
 * shoot back at the nearest visible enemy within 260 px (aim on the chest plane, one click per loop).
 */
async function defend(s) {
  if (s.hp < s.maxHp * .55 && s.heals > 0 && Date.now() - healedAt > 4000) { healedAt = Date.now(); await page.keyboard.press('q'); report.heals = (report.heals ?? 0) + 1; }
  if (s.magSize && s.mag === 0 && !s.reloading) await page.keyboard.press('r');
  const e = s.enemies.map(e => ({ ...e, d: Math.hypot(e.x - s.x, e.y - s.y) })).filter(e => e.d < 260 && corridor(space(s), s, e, 'sight')).sort((a, b) => a.d - b.d)[0];
  if (!e) return false;
  const p = await page.evaluate(q => window.__bincovSample.host.view.worldToClient({ x: q.x, y: q.y - 22 }), e);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up(); report.shots++;
  return true;
}
/** Walk to `goal` along the Runtime's own corridors with WASD; returns the last state. */
async function walk(goal, label, near = 10) {
  let s = await state(), path = [], repath = 0, stuck = { x: s.x, y: s.y, at: Date.now() };
  for (;;) {
    s = await state();
    if (s.state !== 'run') { await keys(new Set()); return s; }
    if (Math.hypot(goal.x - s.x, goal.y - s.y) <= near) { await keys(new Set()); mark(label, s); return s; }
    if (s.panel) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); continue; }
    if (Date.now() > repath || !path.length) { path = spacePath(space(s), s, goal, true); repath = Date.now() + 1500; if (!path.length) path = [goal]; }
    while (path.length > 1 && Math.hypot(path[0].x - s.x, path[0].y - s.y) < 12) path.shift();
    const n = path[0], dx = n.x - s.x, dy = n.y - s.y, next = new Set();
    if (dx > 4) next.add('d'); if (dx < -4) next.add('a'); if (dy > 4) next.add('s'); if (dy < -4) next.add('w');
    await keys(next);
    if (await defend(s)) await page.waitForTimeout(60);
    if (Math.hypot(s.x - stuck.x, s.y - stuck.y) > 8) stuck = { x: s.x, y: s.y, at: Date.now() };
    else if (Date.now() - stuck.at > 2500) { path = []; stuck.at = Date.now(); await keys(new Set(['w'])); await page.waitForTimeout(150); }
    await page.waitForTimeout(40);
  }
}

try {
  await page.goto('https://route.test/?test=1');
  await page.locator('[data-action="enter"]').click();
  await deployFromYard(page, { world: 'buildings', seed });
  await page.waitForFunction(() => window.__bincovSample?.host?.lastBatch?.frame.phase === 'running', null, { timeout: 30000 });
  let s = await state();
  assert.equal(await page.evaluate(() => window.__bincovSample.host.lastBatch.stamp.world.worldVersion), 'coast-story-v1');
  report.spawn = { x: Math.round(s.x / T), y: Math.round(s.y / T) }; report.exits = s.exits.map(e => e.name); report.highTide = s.high;
  mark('spawn', s);
  s = await walk(APPROACH, 'approach (5,33)', 14);
  for (const [x, y] of ROUTES[routeName]) {
    if (s.state !== 'run') break;
    s = await walk(at(x, y), `waypoint (${x},${y})`, 14);
    // The service route passes the switch room first: step up to the breaker and check it when the prompt names it.
    if (routeName === 'service' && s.state === 'run' && x === 28 && y === 40) {
      s = await walk(at(29.1, 40.2), 'at the breaker', 8);
      const prompt = await page.evaluate(() => document.querySelector('.coast-sample [data-prompt]')?.textContent ?? '');
      if (s.breaker && prompt.includes('检查 · 配电箱')) { await page.keyboard.press('e'); await page.waitForTimeout(400); s = await state(); mark('breaker checked', s, { clues: s.clues }); }
      else mark('breaker not offered', s, { prompt });
    }
  }
  if (s.state === 'run') {
    s = await walk(at(28, 38), 'cabinet', 18);
    // Read the prompt as a player does: the market box can stand beside the cabinet. Step closer, or wheel to it.
    const named = () => page.evaluate(() => document.querySelector('.coast-sample [data-prompt]')?.textContent ?? '');
    if (!(await named()).includes('蔡建平')) { s = await walk({ x: 28.5 * T, y: 37.9 * T }, 'closer to the cabinet', 5); }
    for (let i = 0; i < 4 && !(await named()).includes('蔡建平'); i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(150); }
    report.cabinetPrompt = await named();
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__bincovSample.host.panel === 'loot', null, { timeout: 5000 });
    for (let i = 0; i < 6; i++) {
      const item = page.locator('.cs-inv-panel .grid:not([data-grid="bag"]):not([data-grid="safe"]) .item').first();
      if (!await item.count()) break;
      await item.dblclick(); await page.waitForTimeout(250);
    }
    s = await state(); mark('cabinet emptied', s, { bag: s.bag.filter(([id]) => ['scrap', 'wire', 'fuse'].includes(id)), clues: s.clues });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    s = await state();
    const exit = s.exits.map(e => ({ ...e, d: spacePath(space(s), s, e, true).length })).sort((a, b) => a.d - b.d)[0];
    report.exit = exit.name;
    s = await walk(exit, `exit ${exit.name}`, 20);
    // Hold E in the ring; let go to fight back when someone is close, then hold again (a held exit restarts its count).
    for (let tries = 0; s.state === 'run' && tries < 40; tries++) {
      await page.keyboard.down('e');
      const t0 = Date.now();
      while (Date.now() - t0 < 3600) { await page.waitForTimeout(120); s = await state(); if (s.state !== 'run') break; if (s.enemies.some(e => Math.hypot(e.x - s.x, e.y - s.y) < 200 && corridor(space(s), s, e, 'sight'))) break; }
      await page.keyboard.up('e');
      if (s.state === 'run') { await defend(s); await page.waitForTimeout(200); s = await state(); if (s.state === 'run' && Math.hypot(exit.x - s.x, exit.y - s.y) > 30) s = await walk(exit, `back to ${exit.name}`, 20); }
    }
  }
  await page.waitForFunction(() => window.__bincov.app.state !== 'run', null, { timeout: 20000 }).catch(() => {});
  s = await state();
  report.outcome = s.result?.outcome ?? s.state; report.resultMessage = s.result?.message ?? null;
  console.log('outcome', report.outcome);
} catch (e) {
  report.errors.push(String(e.stack ?? e)); process.exitCode = 1; console.log('FAIL', e.message);
  await page.screenshot({ path: resolve(out, `fail-${routeName}-${seed}.png`) }).catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(out, `${routeName}-${seed}.json`), JSON.stringify(report, null, 2));
  await browser.close();
}
