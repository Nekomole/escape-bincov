import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionState, SaveSession } from '../src/session';
import { CoastRaidRuntime, emptyIntent } from '../src/raid-runtime/runtime';
import { createRuntimeTestDriver } from '../src/raid-runtime/test-support';
import { knownDoor, knownStructurePoint, occupiedStructure, stairLabelBox, stairLabelPlace, structureContains } from '../src/coast-view/structure-guide';

function fixture() {
  const state = createSessionState(), data = new Map<string, string>();
  const saves = new SaveSession(state, () => ({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }));
  assert.equal(saves.initialize(), true); state.state = 'hideout'; assert.equal(saves.beginRun(42, true), true); state.state = 'run';
  const runtime = new CoastRaidRuntime(state, saves), driver = createRuntimeTestDriver(runtime, '?test=1'); driver.freezeAI(true);
  const at = (x: number, y: number, map = 'coast') => { driver.placePlayer({ x, y }, 0, map); return runtime.advance(0, emptyIntent()); };
  return { runtime, driver, at };
}

test('outside a closed building only the exterior doorway is marked, not its internal doors or stairs', () => {
  const f = fixture(), { map, frame } = f.at(464, 448), occupied = occupiedStructure(map, frame.player);
  assert.equal(occupied, null);
  assert.deepEqual(map.doors.filter(d => knownDoor(map, d, frame.revealed, occupied)).map(d => d.id), ['resident-front']);
  assert.equal(map.entries.some(e => knownStructurePoint(map, e.at, frame.revealed, occupied)), false);
  assert.ok(Object.values(frame.revealed).every(v => !v));
});

test('entering cuts away only the occupied building, including its full southern wall', () => {
  const f = fixture(), { map, frame } = f.at(464, 336), occupied = occupiedStructure(map, frame.player);
  assert.ok(occupied); assert.equal(occupied.name, '褪色居民楼');
  assert.ok(map.doors.every(d => knownDoor(map, d, frame.revealed, occupied)));
  assert.ok(map.entries.every(e => knownStructurePoint(map, e.at, frame.revealed, occupied)));
  assert.equal(structureContains(map, occupied, { x: 592, y: 400 }), true);
  assert.equal(structureContains(map, occupied, { x: 640, y: 400 }), false);
  assert.equal(occupiedStructure(map, { x: 464, y: 432 }), null);
});

test('a layered floor includes its landing and perimeter while hidden room permissions stay unchanged', () => {
  const f = fixture(), { map, frame } = f.at(176, 80, 'resident-f2'), before = JSON.stringify(frame);
  const occupied = occupiedStructure(map, frame.player); assert.ok(occupied);
  assert.equal(map.regions.some(r => frame.player.x >= r.x && frame.player.x < r.x + r.w && frame.player.y >= r.y && frame.player.y < r.y + r.h), false);
  assert.equal(structureContains(map, occupied, { x: 16, y: 304 }), true);
  assert.ok(map.doors.every(d => knownDoor(map, d, frame.revealed, occupied)));
  assert.ok(map.entries.every(e => knownStructurePoint(map, e.at, frame.revealed, occupied)));
  const west = map.regions.find(r => r.id.endsWith('/west-home'))!;
  assert.equal(frame.revealed[west.id], false);
  assert.ok(frame.actors.some(a => a.regionId === west.id));
  assert.equal(JSON.stringify(frame), before, 'cutaway reads must not alter dynamic visibility or world state');
  assert.equal(map.key.mapId, 'resident-f2'); assert.ok(map.entries.every(e => e.targetMap === 'coast'));
});

test('unknown overlapping rooms keep static cues covered outside the occupied building', () => {
  const f = fixture(), { map } = f.at(464, 448), point = { x: 464, y: 336 }, region = map.regions[0];
  const overlapped = { ...map, regions: [...map.regions, { ...region, id: 'hidden-overlap' }] };
  assert.equal(knownStructurePoint(overlapped, point, { [region.id]: true }, null), false);
  assert.equal(knownStructurePoint(overlapped, point, { [region.id]: true, 'hidden-overlap': true }, null), true);
});

// The ground-floor up stair (cell 17,8) as drawn: 32x40 from 8 px into the cell above. Its label box is 60x18 (the sprite).
const art = { x: 544, y: 248, w: 32, h: 40 }, W = 60, H = 18, A = ['below', 'above', 'left', 'right'] as const;
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('a stair label rests just under its stairs and every other side stays next to them', () => {
  assert.deepEqual(stairLabelBox(art, W, H, 'below'), { x: 530, y: 294, w: W, h: H }, 'the resting place: anchor (at.x, at.y + 22) as before');
  assert.deepEqual(stairLabelBox(art, W, H, 'above'), { x: 530, y: 228, w: W, h: H });
  assert.deepEqual(stairLabelBox(art, W, H, 'left'), { x: 482, y: 259, w: W, h: H });
  assert.deepEqual(stairLabelBox(art, W, H, 'right'), { x: 578, y: 259, w: W, h: H });
  assert.deepEqual(stairLabelPlace(art, W, H, A, [], []), stairLabelBox(art, W, H, 'below'), 'nothing in the way: no move');
});

test('blocked under its stairs, a stair label goes over them, never down to the player (#26 F07/F11)', () => {
  // Observed 2026-10-30: the player one cell south of the stairs, facing the east door; the old rule put the label at the
  // feet (y 344), on the east door's mark and the way through it, 56 px from its stairs.
  const body = { x: 546, y: 292, w: 28, h: 48 }, way = { x: 480, y: 320, w: 96, h: 32 }, glow = { x: 524, y: 276, w: 8, h: 76 };
  const placed = stairLabelPlace(art, W, H, A, [body, way, glow], [{ x: 514, y: 322, w: 28, h: 28 }]);
  assert.ok(hit(stairLabelBox(art, W, H, 'below'), body), 'positive control: the resting place covers the player');
  assert.deepEqual(placed, stairLabelBox(art, W, H, 'above'));
  for (const r of [body, way, glow]) assert.equal(hit(placed, r), false);
});

test('a covered player or faced-door cue outweighs any amount of soft overlap, and ties keep the earlier side', () => {
  const body = { x: 545, y: 220, w: 95, h: 100 }; // covers under, over and right; the left side is clear of it
  const soft = [{ x: 470, y: 250, w: 20, h: 20 }]; // a door mark under the left side only
  assert.deepEqual(stairLabelPlace(art, W, H, A, [body], soft), stairLabelBox(art, W, H, 'left'), 'soft overlap beats covering the player');
  const everywhere = [{ x: 400, y: 200, w: 300, h: 200 }];
  assert.deepEqual(stairLabelPlace(art, W, H, A, everywhere, []), stairLabelBox(art, W, H, 'below'), 'all sides equal: the first');
  const column = [{ x: 545, y: 220, w: 30, h: 100 }]; // under and over blocked, both sides clear
  assert.deepEqual(stairLabelPlace(art, W, H, ['below', 'above', 'right', 'left'], column, []), stairLabelBox(art, W, H, 'right'), 'the order given picks the side');
  assert.deepEqual(stairLabelPlace(art, W, H, A, column, []), stairLabelBox(art, W, H, 'left'));
});
