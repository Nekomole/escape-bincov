import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/domain';
import { emptyIntent } from '../src/raid-runtime/runtime';
import type { PublishedView, RaidIntent, StampedEvent } from '../src/raid-runtime/contract';
import { DRAGON, FireField, roundFits, TRACER_COLORS, type TracerColor } from '../src/special-rounds';
import { createRangeRaid, ShootingRange } from '../src/range/raid';

// 曳光弹 and 龙息弹 (src/special-rounds.ts, maintainer 2026-11-02): step 1 fires them in the 试枪场 only.

test('special rounds: a tracer fits every gun, dragon\'s breath only shells, and the knife neither', () => {
    for (const ammo of ['ammo9', 'shell', 'ammoR', 'ammo45', 'ammoPDW', 'ammoHeavy']) assert.equal(roundFits('tracer', ammo), true, ammo);
    assert.equal(roundFits('dragon', 'shell'), true);
    for (const ammo of ['ammo9', 'ammoR', 'ammo45', 'ammoPDW', 'ammoHeavy']) assert.equal(roundFits('dragon', ammo), false, ammo);
    assert.equal(roundFits('tracer', null), false);
    assert.equal(roundFits('dragon', null), false);
});

test('fire field: a body burns DRAGON.burn.damage every tick for the burn time, and catching fire again restarts the count', () => {
    const field = new FireField(), body = { uid: 'e1', x: 0, y: 0, hp: 50 }, ticks = Math.round(DRAGON.burn.seconds / DRAGON.burn.tick);
    assert.equal(field.ignite('e1'), true);
    assert.equal(field.ignite('e1'), false, 'already burning');
    let damage = 0, at: number[] = [];
    for (let t = 0; t < 10; t += .05) for (const tick of field.step(.05, [body])) { damage += tick.damage; at.push(Math.round((t + .05) * 100) / 100); }
    assert.equal(damage, DRAGON.burn.damage * ticks);
    assert.deepEqual(at, Array.from({ length: ticks }, (_, i) => (i + 1) * DRAGON.burn.tick));
    assert.equal(field.burning.size, 0);
    assert.equal(field.active, false);
    // A second ignition halfway keeps the rhythm and gives the full count again from there.
    field.ignite('e1'); damage = 0; at = [];
    for (let t = 0; t < 10; t += .05) {
        if (Math.abs(t - 1.5) < 1e-9) field.ignite('e1');
        for (const tick of field.step(.05, [body])) { damage += tick.damage; at.push(Math.round((t + .05) * 100) / 100); }
    }
    assert.equal(at.length, 3 + ticks, JSON.stringify(at));
    assert.equal(damage, (3 + ticks) * DRAGON.burn.damage);
});

test('fire field: a dead or missing body stops burning; ground fire sets standing bodies alight, burns down and merges', () => {
    const field = new FireField();
    field.ignite('dead'); field.ignite('gone');
    assert.deepEqual(field.step(1, [{ uid: 'dead', x: 0, y: 0, hp: 0 }]), []);
    assert.equal(field.burning.size, 0);
    const patch = field.kindle({ x: 100, y: 100 });
    assert.equal(field.kindle({ x: 100 + DRAGON.merge - 1, y: 100 }), patch, 'a burst close by feeds the same patch');
    assert.equal(field.fires.length, 1);
    const inside = { uid: 'in', x: 100 + DRAGON.fire.radius - 1, y: 100, hp: 30 }, outside = { uid: 'out', x: 100 + DRAGON.fire.radius + 1, y: 100, hp: 30 };
    field.step(.1, [inside, outside]);
    assert.deepEqual([...field.burning.keys()], ['in']);
    assert.ok(field.left('in') > DRAGON.burn.seconds - .2);
    assert.equal(field.left('out'), 0);
    for (let t = .1; t < DRAGON.fire.seconds + .05; t += .1) field.step(.1, []);
    assert.equal(field.fires.length, 0, 'the patch burned out');
    field.kindle({ x: 0, y: 0 }); field.ignite('x'); field.clear();
    assert.equal(field.active, false);
});

// The range raid without the page's healing: the targets keep the damage they take.
const open = () => { const raid = createRangeRaid(); return { ...raid, range: new ShootingRange(raid.core) }; };
type Range = ReturnType<typeof open>;
const advance = (r: Range, t: number, intent: Partial<RaidIntent> = {}) => r.core.advance(1000 + t * 1000, { ...emptyIntent(), aim: 0, ...intent });
const target = (r: Range, id: string) => { const p = r.range.positions().find(q => q.id === id)!; return r.core.enemies.find(e => e.uid === p.uid)!; };
const aimAt = (r: Range, id: string) => { const e = target(r, id); return Math.atan2(e.y - r.core.player.y, e.x - r.core.player.x); };
/** Settle the aim, fire once at `id`, then run `seconds` more; every event published from the shot on. */
function fireAt(r: Range, id: string, seconds: number) {
    let t = 0;
    for (; t < 2; t += 1 / 60) advance(r, t, { aim: aimAt(r, id) });
    const events: StampedEvent[] = [], frames: PublishedView[] = [];
    const keep = (b: PublishedView) => { events.push(...b.events); frames.push(b); };
    keep(advance(r, t, { aim: aimAt(r, id), firePressed: true, source: 'mouse-keyboard' }));
    for (const end = t + seconds; t < end; t += 1 / 60) keep(advance(r, t, { aim: aimAt(r, id) }));
    return { events, frames, t };
}

test('dragon\'s breath: slower, lighter pellets that burst, set the target burning and leave ground fire; the player is never hurt', () => {
    const r = open();
    r.range.arm('shotgun');
    assert.equal(r.range.setRound('dragon'), true);
    const hp = r.core.hp, elite = D.ENEMIES.elite.hp, w = D.WEAPONS.shotgun;
    const { events, frames, t: after } = fireAt(r, 'd5', 1.2);
    const shot = events.find(e => e.type === 'shot' && e.shooter === 'player');
    assert.ok(shot && shot.type === 'shot' && shot.round === 'dragon');
    // The first frame with the pellets in flight shows them as dragon's breath at DRAGON.speed.
    const flying = frames.find(b => b.frame.bullets.some(x => !x.enemy))!.frame.bullets.filter(x => !x.enemy);
    assert.ok(flying.length > 0 && flying.every(x => x.round === 'dragon' && Math.abs(Math.hypot(x.vx, x.vy) - DRAGON.speed) < 1e-6));
    const blasts = events.filter(e => e.type === 'blast');
    assert.ok(blasts.length >= 1, 'the pellets burst');
    const e = target(r, 'd5');
    const fire = events.filter(x => x.type === 'hurt' && x.cause === 'fire' && x.uid === e.uid);
    assert.ok(fire.length >= 2, 'the burst and at least one burn tick');
    // Direct pellets at DRAGON.damage of the gun's, one burst, burn ticks: never more than that.
    const direct = events.filter(x => x.type === 'hurt' && x.cause === 'blow' && x.uid === e.uid).reduce((s, x) => s + (x.type === 'hurt' ? x.damage : 0), 0);
    assert.ok(direct <= w.pellets * w.damage * DRAGON.damage + 1e-9, String(direct));
    assert.ok(fire.filter(x => x.type === 'hurt' && x.angle !== null).length <= 1, 'one burst per shot on a body');
    assert.ok(e.hp < elite - direct, 'the fire took health');
    const last = frames.at(-1)!.frame;
    assert.ok((last.actors.find(a => a.uid === e.uid)!.burning ?? 0) > 0, 'the frame shows the target burning');
    assert.ok((last.fires ?? []).length >= 1, 'ground fire is published');
    assert.equal(r.core.hp, hp);
    assert.ok(!events.some(x => x.type === 'hurt' && x.uid === 'player'));
    // A checkpoint with dragon's breath in flight or fire burning still validates: none of it is saved.
    assert.equal(r.saves.persist(), true);
    // Burning runs its course and stops (frame by frame: a long gap would be a stall pause).
    let t = after;
    for (const end = t + DRAGON.burn.seconds + DRAGON.fire.seconds + 1; t < end; t += 1 / 60) advance(r, t);
    assert.equal(r.core.fire.active, false);
    assert.equal(r.core.current().frame.fires, undefined);
});

test('tracer: the gun\'s own speed and damage, marked as a tracer, and no burst', () => {
    const r = open();
    r.range.arm('carbine');
    assert.equal(r.range.setRound('tracer'), true);
    const { events, frames } = fireAt(r, 'd5', .8);
    const shot = events.find(e => e.type === 'shot' && e.shooter === 'player');
    assert.ok(shot && shot.type === 'shot' && shot.round === 'tracer' && shot.color === 'red', 'red unless another colour is picked');
    const flying = frames.find(b => b.frame.bullets.some(x => !x.enemy))!.frame.bullets.filter(x => !x.enemy);
    assert.ok(flying.every(x => x.round === 'tracer' && x.color === 'red' && Math.abs(Math.hypot(x.vx, x.vy) - 760) < 1e-6));
    assert.equal(events.filter(e => e.type === 'blast').length, 0);
    const hit = events.find(e => e.type === 'hurt' && e.uid === target(r, 'd5').uid);
    assert.ok(hit && hit.type === 'hurt' && hit.cause === 'blow');
    assert.ok(hit.damage === D.WEAPONS.carbine.damage || hit.critical, String(hit.damage));
});

test('tracer colours: picking one loads tracers in that colour; dragon\'s breath and ordinary rounds carry none', () => {
    const r = open();
    r.range.arm('mb4a1');
    assert.equal(r.core.round, null);
    assert.equal(r.range.setTracerColor('nope' as TracerColor), false);
    assert.equal(r.range.setTracerColor('rainbow'), true);
    assert.equal(r.core.round, 'tracer', 'a colour loads tracers');
    assert.equal(TRACER_COLORS.length, 7);
    const { events, frames } = fireAt(r, 'd5', .3);
    const shot = events.find(e => e.type === 'shot' && e.shooter === 'player');
    assert.ok(shot && shot.type === 'shot' && shot.color === 'rainbow');
    assert.ok(frames.flatMap(b => b.frame.bullets.filter(x => !x.enemy)).every(x => x.color === 'rainbow'));
    // The shotgun keeps the colour for later tracers, but its dragon's breath has none.
    const s = open();
    s.range.arm('shotgun'); s.range.setTracerColor('green'); s.range.setRound('dragon');
    const dragon = fireAt(s, 'd5', .3);
    const blast = dragon.events.find(e => e.type === 'shot' && e.shooter === 'player');
    assert.ok(blast && blast.type === 'shot' && blast.round === 'dragon' && !('color' in blast));
    assert.ok(dragon.frames.flatMap(b => b.frame.bullets).every(x => !('color' in x)));
    assert.equal(s.core.tracerColor, 'green');
});

test('ordinary rounds stay unmarked, and a round the gun cannot load fires ordinary ones', () => {
    const r = open();
    r.range.arm('shotgun');
    r.range.setRound('dragon');
    r.range.arm('pistol');
    assert.equal(r.core.round, null, 'drawing a pistol drops dragon\'s breath');
    assert.equal(r.range.setRound('dragon'), false, 'a pistol cannot load it');
    // Forced past the range, the Runtime still fires the pistol's ordinary rounds.
    r.core.round = 'dragon';
    const { events, frames } = fireAt(r, 'd5', .6);
    const shot = events.find(e => e.type === 'shot' && e.shooter === 'player');
    assert.ok(shot && shot.type === 'shot' && !('round' in shot) && !('color' in shot));
    assert.ok(frames.every(b => b.frame.bullets.every(x => !('round' in x) && !('color' in x))));
    assert.equal(events.filter(e => e.type === 'blast' || e.type === 'hurt' && e.cause === 'fire').length, 0);
    assert.ok(frames.every(b => !('fires' in b.frame) && b.frame.actors.every(a => !('burning' in a))));
});

test('range: fire is not counted as a hit, and a reset puts every fire out', () => {
    const r = open();
    r.range.arm('shotgun'); r.range.setRound('dragon');
    let t = 0;
    for (; t < 2; t += 1 / 60) r.range.observe(advance(r, t, { aim: aimAt(r, 'd5') }));
    r.range.observe(advance(r, t, { aim: aimAt(r, 'd5'), firePressed: true, source: 'mouse-keyboard' }));
    const fireHurts: StampedEvent[] = [];
    for (const end = t + 1.5; t < end; t += 1 / 60) {
        const b = r.range.observe(advance(r, t, { aim: aimAt(r, 'd5') }));
        fireHurts.push(...b.events.filter(e => e.type === 'hurt' && e.cause === 'fire'));
    }
    assert.ok(fireHurts.length > 0);
    const blows = r.range.stats.hits.d5;
    assert.ok(blows <= D.WEAPONS.shotgun.pellets, `hits ${blows} count pellets only`);
    r.range.reset();
    assert.equal(r.core.fire.active, false);
});
