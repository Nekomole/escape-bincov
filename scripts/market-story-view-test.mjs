/**
 * #83 market story front end on the packaged offline build: 小蔡's conversation and the recall in the yard, the market
 * raid's three sources (freezer, tool cabinet, breaker) with subtitles and recall, and the default street deploy now
 * starting the market world. Real localStorage, real keyboard / mouse / touch. ?test=1 only places the player, writes
 * story fixtures through SaveSession's own transaction while the yard is closed, injects storage faults and reads state.
 * Usage: pnpm test:market-view [--only=M1,M5]   ->  test-results/market-view/{report.json, *.png}
 */
/** A base holding the repair order (3 / 2 / 1), built with the game's own domain code like the station suite's presets. */
function partsBase() {
  const s = D.newSave();
  for (const [id, n] of [['scrap', 3], ['wire', 2], ['fuse', 1]]) assert.equal(D.addItem(s.stash, id, n), 0, `fixture: no room for ${id}`);
  return { stash: s.stash, bag: s.bag, safe: s.safe, equipment: s.equipment };
}
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { deployFromYard, skipOpening } from './yard-entry.mjs';
import { stepFilter } from './step-filter.mjs';
import * as D from '../src/domain.ts';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = resolve(option('out', 'test-results/market-view'));
const htmlPath = option('html', 'dist/index.html'), html = await readFile(htmlPath, 'utf8');
const ORIGIN = 'https://market.test/', KEY = 'escape-bincov.session.v2';
await mkdir(out, { recursive: true });
const filter = stepFilter();
const browser = await chromium.launch(browserOptions);
const report = { html: htmlPath, sha256: createHash('sha256').update(html).digest('hex'), browser: browser.version(), startedAt: new Date().toISOString(),
  methodology: 'Packaged offline build routed at https://market.test/ (no network). Real session/localStorage and DOM input in headless Chrome; phone sizes are viewport/touch emulation. ?test=1 places the player, writes story fixtures through SaveSession transactions while the yard is closed, injects storage faults and reads state; it never observes a clue or makes a choice for the player.',
  steps: [], errors: [], external: [] };
let ctx = null, page = null;

// ---------------- harness ----------------
async function newPage({ size = [1280, 720], mobile = false } = {}) {
  if (ctx) await ctx.close().catch(() => {});
  ctx = await browser.newContext({ offline: true, viewport: { width: size[0], height: size[1] }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  await ctx.route(`${ORIGIN}**`, r => r.fulfill({ contentType: 'text/html', body: html }));
  ctx.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(ORIGIN)) report.external.push(r.url()); });
  page = await ctx.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(String(e.stack ?? e.message)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  return page;
}
async function step(name, fn) {
  if (!filter.selects(name)) return;
  const row = { name, status: 'running' }, t0 = Date.now(), errors0 = report.errors.length; report.steps.push(row);
  try {
    row.detail = await fn() ?? '';
    assert.deepEqual(report.errors.slice(errors0), [], 'page errors'); assert.deepEqual(report.external, [], 'network');
    row.status = 'passed'; console.log('PASS', name, typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail));
  } catch (e) {
    row.status = 'failed'; row.error = String(e.stack ?? e); process.exitCode = 1; console.log('FAIL', name, e.message ?? e);
    await page?.screenshot({ path: resolve(out, `fail-${report.steps.length}.png`) }).catch(() => {});
  }
  row.ms = Date.now() - t0;
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
}
const shot = name => page.screenshot({ path: resolve(out, `${name}.png`) });
const record = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const until = async (fn, label, arg, ms = 10000) => { await page.waitForFunction(fn, arg, { timeout: ms }).catch(() => { throw new Error(`timeout: ${label}`); }); };
const fault = on => page.evaluate(([on, key]) => {
  window.__write ??= Storage.prototype.setItem;
  Storage.prototype.setItem = on ? function (k, v) { if (k === key) throw new DOMException('fixture', 'QuotaExceededError'); return window.__write.call(this, k, v); } : window.__write;
}, [on, KEY]);

// ---------------- yard ----------------
async function yard({ size, mobile, story = null, parts = false } = {}) {
  await newPage({ size, mobile });
  await page.goto(`${ORIGIN}?test=1`);
  await page.locator('[data-action="enter"]').click();
  await skipOpening(page);
  await until(() => window.__station?.mounted && window.__station.host.frames > 8, 'yard');
  if (story || parts) {
    await page.evaluate(([clues, base]) => window.__station.reseed(() => {
      const s = window.__bincov.saveSession, t = s.prepareExpansionMutation(d => {
        for (const c of clues ?? []) d.story.clues.push(c);
        if (base) for (const k of ['stash', 'bag', 'safe', 'equipment']) d.profile[k] = structuredClone(base[k]);
      });
      if (s.commitExpansionMutation(t) !== 'committed') throw new Error('fixture write failed');
    }), [story, parts ? partsBase() : null]);
    await until(() => window.__station?.mounted && window.__station.host.frames > 8, 'yard after fixture');
  }
  await page.waitForTimeout(200);
}
const ui = sel => page.locator(`#station-yard ${sel}`).first();
const press = async (sel, mobile = false) => { if (mobile) await ui(sel).tap(); else await ui(sel).click(); await page.waitForTimeout(120); };
const talk = () => page.evaluate(() => {
  const r = document.querySelector('#station-yard').shadowRoot, box = r.querySelector('.talk-box');
  const b = box?.getBoundingClientRect();
  return { lines: [...r.querySelectorAll('.talk-lines p')].map(p => p.textContent), options: [...r.querySelectorAll('.talk-opts button')].map(o => o.dataset.act),
    error: r.querySelector('.talk-err')?.textContent ?? null, duty: r.querySelector('.duty')?.textContent ?? null, box: b ? [b.x, b.y, b.width, b.height].map(Math.round) : null,
    topics: [...r.querySelectorAll('.talk-topics button')].map(t => [t.dataset.act, t.textContent, t.disabled]) };
});
const storyOf = async () => (await record()).story;

// ---------------- raid ----------------
async function raidFromTabs({ size, mobile, seed = '42', volume = null } = {}) {
  await newPage({ size, mobile });
  await page.goto(`${ORIGIN}?test=1&entry=tabs&freezeAI=1`);
  await until(() => !!window.__bincov, 'app');
  assert.equal((await page.evaluate(() => window.__bincov.hideoutRuntime.enter())).ok, true);
  if (volume !== null) assert.equal((await page.evaluate(v => window.__bincov.hideoutRuntime.setVolume(v), volume)).ok, true);
  const r = await page.evaluate(seed => window.__bincov.hideoutRuntime.deploy({ world: 'buildings', seed, marketStory: true }), seed);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await page.evaluate(id => window.__bincov.startPreparedHideoutRaid(id), r.runId), true);
  await until(() => window.__bincovSample?.host?.lastBatch?.frame.phase === 'running', 'raid running');
  await page.waitForTimeout(300);
}
const hud = () => page.evaluate(() => {
  const h = window.__bincovSample.host, q = s => document.querySelector(`.coast-sample ${s}`), shown = s => q(s) && !q(s).hidden ? q(s).textContent : null;
  const box = s => { const r = q(s)?.getBoundingClientRect(); return r && !q(s).hidden ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  return { panel: h.panel, phase: h.lastBatch.frame.phase, world: h.lastBatch.stamp.world.worldVersion, prompt: shown('[data-prompt]'), list: shown('[data-choices]'),
    story: shown('[data-story]'), storyBox: box('[data-story]'), recall: shown('[data-recall]'), act: q('[data-act]').textContent,
    clues: h.services.story().recall.map(r => r.id), cues: h.eventLog.filter(e => e.type === 'story-cue').map(e => e.detail.source),
    risk: box('[data-panel] [data-risk] > *'), close: box('[data-panel] [data-do="close"]') };
});
const place = (x, y) => page.evaluate(([x, y]) => window.__bincovSample.driver.placePlayer({ x: x * 32, y: y * 32 }), [x, y]);
const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(200); };
const tapRaid = async sel => { await page.locator(`.coast-sample ${sel}`).first().tap(); await page.waitForTimeout(200); };
// Tiles. Seed 42 puts an ordinary box at (28.5, 39.5), between the cabinet and the breaker: the breaker spot is nearer the breaker.
const SPOT = { freezer: [24.7, 39.5], cabinet: [28.5, 38.3], breaker: [29.3, 40.4] };
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

try {
  // ================= yard =================
  await step('M1 院子：电台面板的小蔡入口，打开话题、追问，关闭不写任何选择', async () => {
    await yard();
    await press('[data-quick="radio"]');
    await until(() => window.__station.host.ui.kind === 'radio', 'radio panel');
    assert.equal(await ui('.talk-entry').isVisible(), true);
    await shot('M1-tasks-1280x720');
    const before = JSON.stringify(await storyOf());
    await press('[data-act="radio-tab:talk"]');
    let t = await talk(); assert.equal(t.lines.length, 1); assert.match(t.lines[0], /选一个话题/);
    assert.deepEqual(t.topics.find(x => x[0] === 'talk:call'), ['talk:call', '还有件事。', true], 'the call topic waits for the call');
    const idle = t.box;
    await press('[data-act="talk:start"]'); t = await talk();
    assert.match(t.lines[0], /泵机零件修净水泵/); assert.deepEqual(t.options, ['say:location', 'say:father', 'say:submit', 'say:exit']);
    assert.deepEqual(t.box, idle, 'the box keeps its place and size');
    await press('[data-act="say:location"]'); t = await talk(); assert.match(t.lines[0], /旧交易厅后头的配电区/); assert.deepEqual(t.box, idle);
    await press('[data-act="say:radio"]'); t = await talk(); assert.match(t.lines[0], /按两下通话键/);
    await shot('M1-talk-1280x720');
    await page.keyboard.press('Escape'); await until(() => window.__station.host.ui.kind === null, 'closed');
    assert.equal(JSON.stringify(await storyOf()), before, 'reading and closing save nothing');
    return { box: idle };
  });

  await step('M2 院子：报告总闸、暂不说再告诉，值班册只写说过的事实', async () => {
    await yard({ story: ['breaker-down', 'heard-call', 'freezer-knocks'] });
    await press('[data-quick="radio"]');
    assert.equal(await ui('.talk-entry .news').evaluate(e => getComputedStyle(e).visibility), 'visible', 'news mark');
    await press('[data-act="radio-tab:talk"]');
    await press('[data-act="talk:breaker"]'); let t = await talk();
    assert.deepEqual(t.options, ['say:report', 'say:exit']);
    await press('[data-act="say:report"]'); t = await talk();
    assert.match(t.lines.join(''), /市场总闸已拉下/); assert.equal((await storyOf()).memory.xiaocai.breakerReported, true);
    assert.deepEqual(t.options, ['say:call']);
    await press('[data-act="say:call"]'); await press('[data-act="say:defer"]');
    assert.equal((await storyOf()).choices.call, 'defer');
    t = await talk(); assert.match(t.lines[0], /有什么话等回来再说/);
    await press('[data-act="say:exit"]'); t = await talk(); assert.match(t.lines[0], /选一个话题/);
    await press('[data-act="talk:call"]'); await press('[data-act="say:tell"]'); t = await talk();
    assert.match(t.lines.join(''), /总闸拉下来了，周围没人/); assert.equal((await storyOf()).choices.call, 'told');
    assert.match(t.duty, /市场总闸已拉下。.*配电区听到喊声/);
    await shot('M2-tell-1280x720');
    await press('[data-act="radio-tab:recall"]');
    const recall = await page.evaluate(() => [...document.querySelector('#station-yard').shadowRoot.querySelectorAll('.recall b')].map(b => b.textContent));
    assert.deepEqual(recall.sort(), ['冷柜响动', '市场总闸', '配电区的喊声'].sort());
    await shot('M2-recall-1280x720');
    return { recall };
  });

  await step('M3 院子：选择写入失败，保留原话题和选项；重试保存后再点同一选项才前进', async () => {
    await yard({ story: ['breaker-down'] });
    await press('[data-quick="radio"]'); await press('[data-act="radio-tab:talk"]'); await press('[data-act="talk:breaker"]');
    const before = await talk();
    await fault(true);
    await press('[data-act="say:report"]');
    let t = await talk();
    assert.deepEqual(t.lines, before.lines, 'same reply'); assert.deepEqual(t.options, before.options, 'same options'); assert.match(t.error, /没有记下/);
    assert.equal((await storyOf()).memory.xiaocai.breakerReported, false, 'nothing saved');
    assert.equal(await page.evaluate(() => window.__station.host.ui.dialogKind), 'storage');
    await shot('M3-save-failed-1280x720');
    await fault(false);
    await press('.dialog [data-act="retry-save"]');
    await press('[data-act="say:report"]'); t = await talk();
    assert.match(t.lines.join(''), /市场总闸已拉下/); assert.equal(t.error, '');
    assert.equal((await storyOf()).memory.xiaocai.breakerReported, true);
  });

  await step('M4 院子：经对话交付维修物资，供电序列后回到小蔡的回应，奖励只发一次', async () => {
    await yard({ parts: true });
    const cash = (await record()).profile.cash;
    await press('[data-quick="radio"]'); await press('[data-act="radio-tab:talk"]'); await press('[data-act="talk:start"]');
    await press('[data-act="say:submit"]');
    await until(() => window.__station.host.debug.seq === 'power', 'power sequence', undefined, 4000);
    const r = await record(); assert.equal(r.profile.quests.repair, true); assert.equal(r.profile.cash, cash + 420);
    await until(() => window.__station.host.debug.seq === null && window.__station.host.ui.kind === 'radio', 'back at the radio', undefined, 12000);
    const t = await talk(); assert.match(t.lines.join(''), /电台通了/); assert.match(t.lines.join(''), /旧冻库也送了电/);
    assert.equal((await record()).profile.cash, cash + 420, 'paid once');
    await shot('M4-delivered-1280x720');
    await press('[data-act="say:exit"]');
    await press('[data-act="talk:start"]'); assert.match((await talk()).lines[0], /新线圈绕组稳住了/);
  });

  await step('M5 两个出击入口：院子出击面板与旧页签都默认进入市场新世界', async () => {
    await yard();
    await deployFromYard(page, { world: 'buildings', seed: 42 });
    await until(() => document.documentElement.dataset.coastSample !== undefined && !!document.querySelector('.coast-sample canvas'), 'raid view', undefined, 30000);
    await until(() => JSON.parse(localStorage.getItem('escape-bincov.session.v2'))?.expansion?.raid?.worldVersion, 'raid saved');
    const yardWorld = (await record()).expansion.raid.worldVersion;
    await newPage();
    await page.goto(`${ORIGIN}?test=1&entry=tabs`);
    await page.locator('[data-action="enter"]').click(); await skipOpening(page);
    await page.locator('#run-world').selectOption('buildings'); await page.locator('#seed').fill('43'); await page.locator('[data-action="deploy"]').click();
    await until(() => !!document.querySelector('.coast-sample canvas'), 'tab raid', undefined, 30000);
    const tabWorld = (await record()).expansion.raid.worldVersion;
    assert.equal(yardWorld, 'coast-story-v1'); assert.equal(tabWorld, 'coast-story-v1');
    return { yardWorld, tabWorld };
  });

  // ================= raid =================
  await step('M6 行动（静音）：冷柜近距、开柜喊声、主动检查总闸，字幕与见闻完整，提交后才出现', async () => {
    await raidFromTabs({ volume: 0 });
    assert.equal((await record()).profile.settings.volume, 0);
    let h = await hud(); assert.equal(h.world, 'coast-story-v1'); assert.equal(h.recall, '见闻 · 0'); assert.equal(h.story, null);
    await place(...SPOT.freezer); await until(() => window.__bincovSample.host.services.story().recall.length === 1, 'freezer clue');
    await page.waitForTimeout(250); h = await hud();
    assert.match(h.story, /冷柜响了两下，又停了。/); assert.deepEqual(h.cues, ['ch01-sc-freezer']);
    await shot('M6-freezer-1280x720');
    await place(...SPOT.cabinet); await page.waitForTimeout(300); h = await hud();
    assert.match(h.prompt, /搜刮 · 蔡建平 · 备用工具柜/);
    await key('e'); await until(() => window.__bincovSample.host.panel === 'loot', 'cabinet open');
    await page.waitForTimeout(250); h = await hud();
    assert.match(h.story, /拉闸……水上来了……/); assert.deepEqual(h.cues, ['ch01-sc-freezer', 'ch01-sc-call']);
    await shot('M6-cabinet-1280x720');
    await key('Escape');
    await place(...SPOT.breaker); await page.waitForTimeout(300); h = await hud();
    assert.match(h.prompt, /检查 · 配电箱/); assert.equal(h.act, '检查'); assert.deepEqual(h.clues.sort(), ['freezer-knocks', 'heard-call'].sort(), 'drawing the prompt observes nothing');
    await shot('M6-breaker-prompt-1280x720');
    await key('e'); await until(() => window.__bincovSample.host.services.story().recall.length === 3, 'breaker clue');
    await page.waitForTimeout(250); h = await hud();
    assert.match(h.story, /总闸已经拉下，闸柄上结着盐/); assert.equal(h.recall, '见闻 · 3');
    assert.ok(!/检查 · 配电箱/.test(h.prompt ?? ''), 'the breaker is checked once');
    await key('j'); h = await hud(); assert.equal(h.panel, 'recall');
    const recall = await page.evaluate(() => [...document.querySelectorAll('.coast-sample .cs-recall b')].map(b => b.textContent));
    assert.deepEqual(recall, ['冷柜响动', '配电区的喊声', '市场总闸']);
    await shot('M6-recall-1280x720');
    await key('j'); assert.equal((await hud()).panel, null);
    const r = await record(); assert.deepEqual(r.story.currentRun.cues, ['ch01-sc-freezer', 'ch01-sc-call']);
    return { cues: h.cues };
  });

  await step('M7 危险消息优先：电台预警盖住时剧情字幕让开，过时字幕丢弃不排队', async () => {
    await raidFromTabs({ seed: '44' });
    await place(...SPOT.freezer); await until(() => window.__bincovSample.host.services.story().recall.length === 1, 'freezer clue');
    await page.evaluate(() => window.__bincovSample.host.radio('电台预警：离开浅滩。', 3));
    await page.waitForTimeout(150); assert.equal((await hud()).story, null, 'yields to the radio warning');
    await page.waitForTimeout(3300); assert.match((await hud()).story ?? '', /冷柜响了两下/, 'back once the warning is gone');
    await page.waitForTimeout(2200); assert.equal((await hud()).story, null, 'its time ran out');
    await place(...SPOT.cabinet); await page.waitForTimeout(250); await key('e');
    await until(() => window.__bincovSample.host.panel === 'loot', 'cabinet open'); await key('Escape');
    await page.evaluate(() => window.__bincovSample.host.radio('电台预警：离开浅滩。', 7));
    await page.waitForTimeout(150); assert.equal((await hud()).story, null);
    await page.waitForTimeout(7300); assert.equal((await hud()).story, null, 'a stale line is dropped, not replayed');
    assert.equal((await hud()).recall, '见闻 · 2', 'the recall keeps it');
  });

  await step('M8 刷新恢复：已触发的线索不重播，再开柜不再喊，见闻保留', async () => {
    await raidFromTabs({ seed: '45' });
    await place(...SPOT.cabinet); await page.waitForTimeout(250); await key('e');
    await until(() => window.__bincovSample.host.panel === 'loot', 'cabinet open'); await key('Escape');
    await page.reload();
    await page.locator('[data-action="enter"]').click();
    await until(() => window.__bincovSample?.host?.lastBatch, 'resumed');
    await page.locator('.coast-sample [data-do="resume"]').click();
    await until(() => window.__bincovSample.host.lastBatch.frame.phase === 'running', 'running');
    await page.waitForTimeout(400);
    let h = await hud(); assert.deepEqual(h.cues, [], 'no replay'); assert.equal(h.story, null); assert.equal(h.recall, '见闻 · 1');
    await place(...SPOT.cabinet); await page.waitForTimeout(300); await key('e');
    await until(() => window.__bincovSample.host.panel === 'loot', 'cabinet open again'); await page.waitForTimeout(200);
    h = await hud(); assert.deepEqual(h.cues, []); assert.equal(h.story, null);
    return { recall: h.recall };
  });

  await step('M9 失焦与超时：见闻面板随失焦关闭、暂停释放输入；行动结束时不留面板', async () => {
    await raidFromTabs({ seed: '46' });
    await place(...SPOT.freezer); await until(() => window.__bincovSample.host.services.story().recall.length === 1, 'freezer clue');
    await key('j'); assert.equal((await hud()).panel, 'recall'); assert.equal((await hud()).phase, 'blocked');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await until(() => window.__bincovSample.host.panel === 'pause', 'paused on blur');
    await page.locator('.coast-sample [data-do="resume"]').click(); await until(() => window.__bincovSample.host.lastBatch.frame.phase === 'running', 'running');
    await key('j'); assert.equal((await hud()).panel, 'recall');
    await page.evaluate(() => window.__bincovSample.driver.clock(599.5));
    await until(() => ['ending', null].includes(window.__bincovSample?.host?.panel ?? null) && window.__bincov.app.state !== 'run', 'ended', undefined, 15000);
    return { state: await page.evaluate(() => window.__bincov.app.state) };
  });

  await step('M10 手机横屏触控：检查按钮、附近列表、见闻；搜刮满屏时字幕不压危险信息和关闭按钮', async () => {
    await raidFromTabs({ size: [844, 390], mobile: true, seed: '42' });
    await place(...SPOT.cabinet); await page.waitForTimeout(300);
    await tapRaid('[data-act]'); await until(() => window.__bincovSample.host.panel === 'loot', 'cabinet open'); await page.waitForTimeout(250);
    let h = await hud(); assert.match(h.story, /拉闸/);
    assert.equal(overlap(h.storyBox, h.risk), false, 'danger line clear'); assert.equal(overlap(h.storyBox, h.close), false, 'close button clear');
    await shot('M10-cabinet-844x390');
    await tapRaid('[data-panel] [data-do="close"]'); await page.waitForTimeout(200);
    // The box beside the breaker: both are listed by name, the nearer one (the breaker) takes the button.
    await place(...SPOT.breaker); await page.waitForTimeout(300); h = await hud();
    assert.equal(h.act, '检查'); assert.match(h.list ?? '', /检查 · 配电箱/); assert.match(h.list ?? '', /水产市场物资箱/);
    await shot('M10-breaker-844x390');
    await tapRaid('[data-choices] [data-story]'); await until(() => window.__bincovSample.host.services.story().recall.length === 2, 'breaker clue');
    await page.waitForTimeout(200); h = await hud(); assert.equal(h.act, '搜刮', 'then the box takes the button');
    await tapRaid('[data-recall]'); assert.equal((await hud()).panel, 'recall');
    await shot('M10-recall-844x390');
    await tapRaid('[data-panel] [data-do="close"]'); assert.equal((await hud()).panel, null);
  });

  await step('M11 1920×1080 与手机横屏：院子对话与行动提示截图', async () => {
    for (const [size, mobile, name] of [[[1920, 1080], false, '1920x1080'], [[844, 390], true, '844x390']]) {
      await yard({ size, mobile, story: ['breaker-down', 'heard-call'] });
      if (mobile && !await ui('[data-quick="radio"]').isVisible()) await press('[data-quickmenu]', true);
      await press('[data-quick="radio"]', mobile); await press('[data-act="radio-tab:talk"]', mobile);
      await press('[data-act="talk:call"]', mobile);
      const t = await talk(); assert.deepEqual(t.options, ['say:tell', 'say:defer', 'say:exit']);
      await shot(`M11-call-${name}`);
    }
    await raidFromTabs({ size: [1920, 1080], seed: '42' });
    await place(...SPOT.breaker); await page.waitForTimeout(400);
    const h = await hud(); assert.match(h.prompt ?? '', /检查 · 配电箱/); assert.equal(h.recall, '见闻 · 0');
    await shot('M11-raid-1920x1080');
  });

  await step('M12 院子失焦：切窗口、页面隐藏、离开页面都结束小蔡对话并释放会话，聚焦或按住的回答不会被选', async () => {
    await yard({ story: ['breaker-down'], parts: true });
    // Spy on the conversations the yard opens: a released cursor answers view() with null.
    await page.evaluate(() => {
      const rt = window.__bincov.hideoutRuntime, open = rt.openStory.bind(rt);
      window.__talks = []; rt.openStory = e => { const c = open(e); if (c) window.__talks.push(c); return c; };
    });
    // Synthetic window / page signals with the return to the page; headless keeps the real page focused and visible.
    const signal = name => page.evaluate(name => {
      if (name === 'blur') { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); return; }
      if (name === 'pagehide') { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); return; }
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      try { document.dispatchEvent(new Event('visibilitychange')); } finally { delete document.hidden; }
      document.dispatchEvent(new Event('visibilitychange'));
    }, name);
    const released = () => page.evaluate(() => window.__talks.length > 0 && window.__talks.at(-1).view() === null);
    const kind = () => page.evaluate(() => window.__station.host.ui.kind);
    await press('[data-quick="radio"]'); await press('[data-act="radio-tab:talk"]');
    const idle = (await talk()).box, before = JSON.stringify(await storyOf()), checks = [];
    const left = async label => {
      const t = await talk();
      assert.deepEqual(t.options, [], `${label}: no answer left on screen`); assert.match(t.lines[0], /选一个话题/, label);
      assert.deepEqual(t.box, idle, `${label}: the box keeps its place and size`); assert.equal(await kind(), 'radio', `${label}: the radio panel stays`);
      assert.equal(await released(), true, `${label}: conversation released`);
      assert.equal(JSON.stringify(await storyOf()), before, `${label}: nothing chosen`);
      checks.push(label);
    };
    // Keyboard focus on the answer that would write; Enter and Space on returning land on nothing.
    for (const name of ['blur', 'hidden']) {
      await press('[data-act="talk:breaker"]'); assert.deepEqual((await talk()).options, ['say:report', 'say:exit']);
      await ui('[data-act="say:report"]').focus();
      await signal(name);
      await page.keyboard.press('Enter'); await page.keyboard.press(' '); await page.waitForTimeout(120);
      await left(`${name} + keyboard`);
    }
    // A mouse press held on the answer across the window switch: the release clicks nothing.
    await press('[data-act="talk:breaker"]');
    const b = await ui('[data-act="say:report"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await signal('blur'); await page.mouse.up(); await page.waitForTimeout(120);
    await left('blur + held mouse');
    const stale = await page.evaluate(() => window.__talks.at(-1).choose('report'));
    assert.equal(stale.ok, false, 'a released cursor cannot answer'); assert.equal(JSON.stringify(await storyOf()), before);
    // A delivery holds its conversation over the lamp sequence; hiding the page then releases that one too.
    const cash = (await record()).profile.cash;
    await press('[data-act="talk:start"]'); await press('[data-act="say:submit"]');
    await until(() => window.__station.host.debug.seq === 'power', 'power sequence', undefined, 4000);
    await signal('hidden');
    await until(() => window.__station.host.debug.seq === null, 'lamps on', undefined, 12000); await page.waitForTimeout(200);
    assert.equal(await kind(), null, 'the released conversation does not come back after the lamps');
    assert.equal(await released(), true, 'held conversation released');
    assert.equal((await record()).profile.cash, cash + 420, 'the delivery paid once'); checks.push('hidden over the power sequence');
    // Leaving the page (pagehide, last: it also gives up save ownership).
    await press('[data-quick="radio"]'); await press('[data-act="radio-tab:talk"]'); await press('[data-act="talk:start"]');
    assert.ok((await talk()).options.length > 0);
    const after = JSON.stringify(await storyOf());
    await signal('pagehide');
    const t = await talk(); assert.deepEqual(t.options, []); assert.equal(await released(), true, 'pagehide: conversation released');
    assert.equal(JSON.stringify(await storyOf()), after, 'pagehide: nothing chosen'); checks.push('pagehide');
    return { checks };
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.steps.filter(s => s.status === 'passed').length, failed: report.steps.filter(s => s.status === 'failed').length };
  for (const problem of filter.problems(report.steps.length)) { console.log('FAIL', problem); report.summary.failed++; process.exitCode = 1; }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`market-view: ${report.summary.passed} passed, ${report.summary.failed} failed -> ${out}`);
}
