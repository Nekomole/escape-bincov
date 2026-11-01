import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/domain';
import { departureWarnings, questMarks, questProgress, exitBearing } from '../src/qol';
import { gridHtml } from '../src/station-view/grid';
import { createSessionState, SaveSession } from '../src/session';
import { CoastRaidRuntime } from '../src/raid-runtime/runtime';
import { wrapCoastRuntime } from '../src/raid-runtime/host';
import { InventoryPanel } from '../src/coast-view/inventory';

test('departure warnings use matching ammo in the backpack and distinguish safe-only treatment', () => {
    const s = D.newSave(); s.bag.items = []; s.safe.items = []; s.equipment.weapon = 'pistol';
    D.addItem(s.bag, 'shell', 4); D.addItem(s.safe, 'ammo9', 12); D.addItem(s.safe, 'medkit');
    assert.deepEqual(departureWarnings(s), ['背包缺少备用9 毫米弹', '止血用品仅在安全箱，快捷治疗不可用']);
    D.addItem(s.bag, 'ammo9'); D.addItem(s.bag, 'bandage'); assert.deepEqual(departureWarnings(s), []);
    s.equipment.weapon = null; s.safe.items = []; s.bag.items = [];
    assert.deepEqual(departureWarnings(s), ['未装备主武器', '未携带止血用品']);
});
test('raid tracking separates stored and carried materials without double-counting the safe checkpoint', () => {
    const s = D.newSave(); s.stash.items = []; s.bag.items = []; s.safe.items = [];
    D.addItem(s.stash, 'scrap', 2); D.addItem(s.safe, 'scrap'); D.addItem(s.bag, 'scrap', 2);
    const loadout = D.beginRun(s, 42), progress = questProgress(s, loadout);
    assert.deepEqual(progress[0].needs[0], { id: 'scrap', needed: 3, stored: 2, carried: 3 });
    s.quests.repair = true; assert.ok(!questProgress(s, loadout).some(q => q.key === 'repair'));
});
test('navigation reports compass bearing and straight-line tile distance in every quadrant', () => {
    for (const [x,y,dir] of [[32,0,'东'],[32,32,'东南'],[0,32,'南'],[-32,32,'西南'],[-32,0,'西'],[-32,-32,'西北'],[0,-32,'北'],[32,-32,'东北']] as const) {
        const result = exitBearing({x:0,y:0},{x,y}); assert.equal(result.direction,dir); assert.equal(result.distance,Math.hypot(x,y)/32);
    }
    assert.equal(exitBearing({x:1,y:2},{x:1,y:2}).distance,0);
});

/** Item art paints into a canvas; without a 2D context the grids leave it out. Restored after the test. */
function stubPage(t: { after(fn: () => void): void }, values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) {
        const before = Object.getOwnPropertyDescriptor(globalThis, key);
        t.after(() => { if (before) Object.defineProperty(globalThis, key, before); else delete (globalThis as Record<string, unknown>)[key]; });
        Object.defineProperty(globalThis, key, { configurable: true, value });
    }
}
const noCanvas = { createElement: () => ({ getContext: () => null }) };
/** Whether each item cell in grid markup carries the quest ring, keyed "source/uid". */
function ringed(html: string): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const m of html.matchAll(/<div ([^>]*\bdata-uid="[^"]+"[^>]*)>/g)) {
        const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1] ?? '', cls = attr('class').split(' ');
        if (cls.includes('item')) out.set(`${attr('data-source') || attr('data-src')}/${attr('data-uid')}`, cls.includes('need'));
    }
    return out;
}
test('quest marks ring held quest items until handed in and outside copies only while still short', () => {
    const s = D.newSave(); s.stash.items = []; s.bag.items = []; s.safe.items = [];
    D.addItem(s.stash, 'scrap', 2);
    let m = questMarks(s, null);
    assert.deepEqual([...m.own].sort(), ['fuse', 'ledger', 'sample', 'scrap', 'wire']);
    assert.ok(m.wanted.has('scrap') && m.wanted.has('wire'));
    D.addItem(s.safe, 'scrap'); m = questMarks(s, null);
    assert.ok(m.own.has('scrap') && !m.wanted.has('scrap'), 'stash 2 + safe 1 = the 3 asked for');
    assert.ok(m.wanted.has('wire') && m.wanted.has('fuse'));
    s.quests.repair = true; m = questMarks(s, null);
    assert.ok(!m.own.has('scrap') && !m.wanted.has('scrap') && !m.own.has('wire'), 'a handed-in quest rings nothing');
    assert.ok(m.wanted.has('sample') && m.wanted.has('ledger'));
});
test("during a raid the held count is the quest card's: stash plus carried bag and safe", () => {
    const s = D.newSave(); s.stash.items = []; s.bag.items = []; s.safe.items = [];
    D.addItem(s.stash, 'scrap'); D.addItem(s.bag, 'scrap');
    const loadout = D.beginRun(s, 42);
    assert.ok(questMarks(s, loadout).wanted.has('scrap'), '1 stored + 1 carried < 3');
    D.addItem(loadout.safe, 'scrap');
    assert.ok(!questMarks(s, loadout).wanted.has('scrap') && questMarks(s, loadout).own.has('scrap'));
});
test("station grids ring quest items: wanted on the counter and the buy list, own on the player's grids", t => {
    stubPage(t, { document: noCanvas });
    const s = D.newSave(); s.stash.items = []; s.bag.items = []; s.safe.items = [];
    D.addItem(s.stash, 'scrap', 3); D.addItem(s.stash, 'watch');
    const shelf: D.Inventory = { w: 6, h: 2, items: [{ uid: 'm-scrap', id: 'scrap', qty: 5, x: 0, y: 0 }, { uid: 'm-wire', id: 'wire', qty: 5, x: 1, y: 0 }, { uid: 'm-watch', id: 'watch', qty: 1, x: 2, y: 0 }] };
    const marks = questMarks(s, null);
    const counter = ringed(gridHtml(shelf, 'merchant', 40, null, { marks }));
    assert.deepEqual([...counter], [['merchant/m-scrap', false], ['merchant/m-wire', true], ['merchant/m-watch', false]], "three scrap held: the shelf's scrap goes plain");
    assert.equal(ringed(gridHtml(shelf, 'buy', 40, null, { marks })).get('buy/m-wire'), true);
    const stash = ringed(gridHtml(s.stash, 'stash', 40, null, { marks })), [scrap, watch] = s.stash.items;
    assert.equal(stash.get(`stash/${scrap.uid}`), true, 'held quest items stay ringed'); assert.equal(stash.get(`stash/${watch.uid}`), false);
    assert.equal(ringed(gridHtml(s.stash, 'sell', 40, null, { marks })).get(`sell/${scrap.uid}`), true);
    assert.ok(![...ringed(gridHtml(shelf, 'merchant', 40, null)).values()].some(Boolean), 'no marks, no rings');
    assert.match(gridHtml(shelf, 'merchant', 40, null, { marks }), /aria-label="绝缘线圈 × 5，任务需要"/);
});
test("the raid loot panel rings a container's quest items only while short, and carried ones until handed in", t => {
    stubPage(t, { document: noCanvas, innerHeight: 720, innerWidth: 1280 });
    const state = createSessionState(), data = new Map<string, string>();
    const saves = new SaveSession(state, () => ({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }));
    assert.ok(saves.initialize()); state.state = 'hideout'; assert.ok(saves.beginRun(42, true)); state.state = 'run';
    const runtime = new CoastRaidRuntime(state, saves); runtime.freezeAI = true;
    const save = state.save, loadout = state.loadout!;
    save.stash.items = []; loadout.bag.items = []; loadout.safe.items = [];
    D.addItem(save.stash, 'scrap'); assert.equal(D.addItem(loadout.bag, 'scrap'), 0);
    const box: D.Inventory = { w: 4, h: 2, items: [{ uid: 'c-scrap', id: 'scrap', qty: 2, x: 0, y: 0 }, { uid: 'c-wire', id: 'wire', qty: 1, x: 1, y: 0 }, { uid: 'c-watch', id: 'watch', qty: 1, x: 2, y: 0 }] };
    // The services object is frozen: a copy with the open container standing in for a real one.
    const services = { ...wrapCoastRuntime(runtime, state, saves).services, lootInventory: () => box };
    const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
    const panel = new InventoryPanel(el as unknown as HTMLElement, {
        services, lootRef: () => ({ kind: 'container', id: 'c' }) as never, touch: () => false, toast() {}, saveFailed() {}, close() {},
        magazine: () => 0, questMarks: () => questMarks(state.save, state.loadout),
    });
    const bagScrap = () => `bag/${loadout.bag.items.find(i => i.id === 'scrap')!.uid}`;
    panel.open('loot'); let cells = ringed(el.innerHTML);
    assert.deepEqual([cells.get('container/c-scrap'), cells.get('container/c-wire'), cells.get('container/c-watch'), cells.get(bagScrap())], [true, true, false, true]);
    assert.equal(D.addItem(loadout.bag, 'scrap'), 0); panel.render(); cells = ringed(el.innerHTML);
    assert.deepEqual([cells.get('container/c-scrap'), cells.get('container/c-wire'), cells.get(bagScrap())], [false, true, true], "1 stored + 2 carried: the box's scrap goes plain, the carried ones stay");
    save.quests.repair = true; panel.render();
    assert.ok(![...ringed(el.innerHTML).values()].some(Boolean), 'handed in: nothing ringed');
});
