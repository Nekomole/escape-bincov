/**
 * Special rounds (maintainer 2026-11-02): 曳光弹 (tracer) for every ammunition group and 龙息弹 (dragon's breath) for
 * shotgun shells. Step 1 loads them only in the 试枪场, through CoastRaidRuntime.round: no item, save field or
 * magazine records a special round yet, so an ordinary raid never fires one (step 2 adds the items and the save).
 * The rules here are pure: no DOM, no random numbers, no persistence.
 */
import type { Point } from './world';

export type RoundKind = 'tracer' | 'dragon';
/**
 * A tracer's colour (maintainer 2026-11-02): six fixed presets, and `rainbow`, whose trail cycles through every hue.
 * Only the look: every colour flies and hits the same.
 */
export type TracerColor = 'red' | 'green' | 'yellow' | 'white' | 'blue' | 'purple' | 'rainbow';
export const TRACER_COLORS: readonly TracerColor[] = ['red', 'green', 'yellow', 'white', 'blue', 'purple', 'rainbow'];

/** Whether a gun firing `ammo` can load `kind`: a tracer for any ammunition, dragon's breath only for shells. */
export const roundFits = (kind: RoundKind, ammo: string | null): boolean => !!ammo && (kind === 'tracer' || ammo === 'shell');

/**
 * Dragon's breath: burning pellets, slower and lighter than buckshot, that burst into a small fireball where they land
 * (a wall, a body, or the end of their range). The burst sets every enemy it reaches burning and leaves a patch of fire
 * on the ground that keeps setting enemies who stand in it alight. Fire hurts enemies only, never the player
 * (maintainer decision), and needs a clear line from the burst, so it never reaches through a wall.
 * A tracer round is the gun's own round with a brighter trail: same speed, same damage.
 */
export const DRAGON = {
    /** Pellet speed, px per second (buckshot flies at 760, slow enough to watch the fireballs). */
    speed: 560,
    /** Each pellet's share of the gun's own pellet damage. */
    damage: .6,
    /** The burst's reach from where the pellet landed to an enemy's centre, and its damage: once per enemy per shot. */
    burst: { radius: 34, damage: 12 },
    /** Burning: `damage` every `tick` seconds for `seconds`. Burning ignores armour. Catching fire again starts it over. */
    burn: { seconds: 3, tick: .5, damage: 4 },
    /** Ground fire per burst: an enemy whose centre stands within `radius` catches fire. */
    fire: { radius: 22, seconds: 2.5 },
    /** A burst this close to a burning patch feeds that patch (full time again) instead of lighting another. */
    merge: 16,
} as const;

export interface GroundFire { id: number; x: number; y: number; r: number; left: number; total: number }
/** `ticks`: burn ticks still to come; `next`: seconds to the next one. */
export interface Burning { ticks: number; next: number }

/**
 * The fire on one map: ground patches and burning bodies, advanced by the Runtime after the bullets each substep.
 * Runtime-only state, as the special rounds are; a checkpoint never stores it, so a reload puts every fire out.
 */
export class FireField {
    fires: GroundFire[] = [];
    readonly burning = new Map<string, Burning>();
    private serial = 0;

    get active(): boolean { return this.fires.length > 0 || this.burning.size > 0; }

    /** Light a ground fire at `p`, or feed the patch already burning within DRAGON.merge of it. */
    kindle(p: Point): GroundFire {
        const near = this.fires.find(f => Math.hypot(f.x - p.x, f.y - p.y) <= DRAGON.merge);
        if (near) { near.left = near.total; return near; }
        const fire = { id: ++this.serial, x: p.x, y: p.y, r: DRAGON.fire.radius, left: DRAGON.fire.seconds, total: DRAGON.fire.seconds };
        this.fires.push(fire);
        return fire;
    }

    /** Set `uid` burning for the full time; one already burning keeps its tick rhythm. Whether it was not burning before. */
    ignite(uid: string): boolean {
        const ticks = Math.round(DRAGON.burn.seconds / DRAGON.burn.tick), was = this.burning.get(uid);
        if (was) { was.ticks = ticks; return false; }
        this.burning.set(uid, { ticks, next: DRAGON.burn.tick });
        return true;
    }

    /** Seconds `uid` still burns, 0 when it does not. */
    left(uid: string): number {
        const b = this.burning.get(uid);
        return b ? Math.max(0, (b.ticks - 1) * DRAGON.burn.tick + b.next) : 0;
    }

    /**
     * Advance `dt` seconds. A body that died, or is gone from `bodies`, stops burning; every living body standing in a
     * ground fire catches fire again; then each burning body's ticks that fell due are returned in body order, and the
     * patches burn down. The caller applies the damage.
     */
    step(dt: number, bodies: readonly (Point & { uid: string; hp: number })[]): { uid: string; damage: number }[] {
        const out: { uid: string; damage: number }[] = [];
        for (const uid of [...this.burning.keys()]) if (!bodies.some(b => b.uid === uid && b.hp > 0)) this.burning.delete(uid);
        for (const b of bodies) if (b.hp > 0 && this.fires.some(f => Math.hypot(f.x - b.x, f.y - b.y) <= f.r)) this.ignite(b.uid);
        for (const b of bodies) {
            const burn = this.burning.get(b.uid);
            if (!burn) continue;
            burn.next -= dt;
            while (burn.next <= 1e-9 && burn.ticks > 0) { out.push({ uid: b.uid, damage: DRAGON.burn.damage }); burn.ticks--; burn.next += DRAGON.burn.tick; }
            if (burn.ticks <= 0) this.burning.delete(b.uid);
        }
        for (const f of this.fires) f.left -= dt;
        this.fires = this.fires.filter(f => f.left > 0);
        return out;
    }

    clear() { this.fires = []; this.burning.clear(); }
}
