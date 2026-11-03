/**
 * The look of the special rounds (special-rounds.ts) beyond their trails, which syncBullets draws: a dragon's breath
 * shot's cone of fire, the burst where each pellet lands (flash, fireball, shock ring, embers, debris, smoke, scorch and
 * a light that lights the street), the ground fires and burning bodies the Runtime publishes in the frame, and the star
 * a tracer flashes where it strikes. Everything here belongs to the view only: it reads the frame and the events and
 * never feeds back. Region rules as for every effect: nothing shows in a room the Runtime has not revealed.
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import type { ActorView, FireView, Point, TracerColor } from '../raid-runtime/contract';
import type { Textures } from './textures';
import type { Fx } from './fx';
import type { Light, Lighting } from './lighting';
import { hash, radialLight } from './art/paint';
import { FIREBALL_FRAMES, FLAME_FRAMES, paintFireball, paintFlame, paintStar } from './art/fire';

/** The colours of one tracer: outer glow, trail, hot core, the light it casts, its impact star's tint and its sparks. */
export interface TracerPalette { glow: number; mid: number; core: number; light: number; star: number; sparks: readonly number[] }
const PRESETS: Readonly<Record<Exclude<TracerColor, 'rainbow'>, TracerPalette>> = {
    red: { glow: 0xff3a1a, mid: 0xff5a2a, core: 0xffd8b0, light: 0xff7a4a, star: 0xffb27a, sparks: [0xffc06a, 0xff7448] },
    green: { glow: 0x1eff3a, mid: 0x52ff5e, core: 0xdcffd4, light: 0x5aff74, star: 0xb4ffb0, sparks: [0xbaff9a, 0x46e05a] },
    yellow: { glow: 0xffae16, mid: 0xffd23a, core: 0xfff6cc, light: 0xffd060, star: 0xffeaa0, sparks: [0xfff0a0, 0xffb840] },
    white: { glow: 0x9ab8ff, mid: 0xe6eeff, core: 0xffffff, light: 0xe0e8ff, star: 0xffffff, sparks: [0xffffff, 0xc8d8ff] },
    blue: { glow: 0x1a5aff, mid: 0x4a92ff, core: 0xd4e6ff, light: 0x5a9aff, star: 0xa8c8ff, sparks: [0xa8d0ff, 0x4a7aff] },
    purple: { glow: 0x9a1aff, mid: 0xc25aff, core: 0xf2dcff, light: 0xb86aff, star: 0xe0b0ff, sparks: [0xe0a8ff, 0xa04aff] },
};
/** A colour from hue `h` (0..1, wrapping), saturation and value. */
export function hsv(h: number, s: number, v: number): number {
    const f = (n: number) => { const k = (n + (h - Math.floor(h)) * 6) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    return (f(5) << 16) | (f(3) << 8) | f(1);
}
/**
 * A tracer's colours. A preset is fixed; `rainbow` is the palette at hue `hue` (0..1), which the trail and its light
 * sweep through over time and along the trail, its sparks spread over the whole wheel.
 */
export function tracerPalette(color: TracerColor, hue = 0): TracerPalette {
    if (color !== 'rainbow') return PRESETS[color];
    return { glow: hsv(hue, 1, 1), mid: hsv(hue, .72, 1), core: hsv(hue, .18, 1), light: hsv(hue, .65, 1), star: hsv(hue, .3, 1),
        sparks: [hsv(hue + .17, .65, 1), hsv(hue + .5, .75, 1), hsv(hue + .83, .65, 1)] };
}

/** Seconds a burst's fireball plays, and how long its shock ring takes to spread. */
const BLAST_LIFE = .52, RING_LIFE = .3;
/** A burst within this distance of one begun in the last BLAST_JOIN seconds swells it instead of drawing another. */
const JOIN_DIST = 18, BLAST_JOIN = .08;

interface Blast { ball: Sprite; glow: Sprite; ring: Graphics; x: number; y: number; r: number; t: number | null; swell: number; seen: boolean }
interface Flame { s: Sprite; ox: number; oy: number; phase: number; size: number }
interface FireGfx { flames: Flame[]; glow: Sprite; light: Light; x: number; y: number; r: number; ember: number }
interface BurnGfx { flames: Flame[]; light: Light; ember: number }

export class FireFx {
    private blasts: Blast[] = [];
    private stars: { s: Sprite; t: number | null }[] = [];
    private fires = new Map<number, FireGfx>();
    private burning = new Map<string, BurnGfx>();
    private time = 0;
    /** Bursts and tracer stars begun since the scene was built (diagnostics and checks). */
    private made = { blasts: 0, stars: 0 };

    constructor(private tex: Textures, private sorted: Container, private flat: Container, private fx: Fx, private light: Lighting,
        private rnd: () => number, private reduced: () => boolean) {}

    private ball(frame: number) { return this.tex.ensure(`fx:fireball:${frame}`, () => paintFireball(frame)); }
    private flameTex(frame: number) { return this.tex.ensure(`fx:flame:${frame}`, () => paintFlame(frame)); }
    private glowTex() { return this.tex.ensure('light:radial', () => radialLight(64, 6)); }

    /**
     * A dragon's breath shot leaves the barrel at `tip` (drawn, height included) along `angle`; `ground` is the shooter's
     * foot row. A tongue of fire and burning flecks pour out of the muzzle and light the street orange.
     */
    muzzle(tip: Point, ground: number, angle: number, region: string | null) {
        const h = Math.max(0, ground - tip.y), c = Math.cos(angle), s = Math.sin(angle);
        for (let i = 0; i < 16; i++) {
            const a = angle + (this.rnd() - .5) * .7, v = 110 + this.rnd() * 210, hot = i % 3 === 0;
            this.fx.spawn({ x: tip.x + c * 3, y: ground + s * 3, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .7, vh: 10 + this.rnd() * 40,
                ttl: .14 + this.rnd() * .2, color: hot ? 0xfff0b8 : i % 2 ? 0xffb347 : 0xff7a2e, g: 40, size: this.rnd() < .5 ? 2 : 1, add: true });
        }
        this.light.lights.push({ x: tip.x + c * 26, y: ground + s * 26, r: 150, color: 0xff9a48, k: 1, ttl: .16, region });
    }

    /**
     * A pellet burst at ground point (`x`, `y`) with the Runtime's reach `radius`. Pellets of one shot landing together
     * swell one fireball instead of stacking six. Returns whether a new burst began (the scene shakes the camera for it).
     */
    blast(x: number, y: number, radius: number, region: string | null, seed: number): boolean {
        const join = this.blasts.find(b => (b.t === null || b.t < BLAST_JOIN) && Math.hypot(b.x - x, b.y - y) < JOIN_DIST);
        this.fx.scorch(x, y, seed);
        this.embers(x, y, join ? 6 : 16, 1);
        if (join) { join.swell = Math.min(1.45, join.swell + .09); return false; }
        this.made.blasts++;
        const ball = new Sprite(this.ball(0)); ball.anchor.set(.5, .62); ball.position.set(Math.round(x), Math.round(y)); ball.zIndex = y + .5;
        const glow = new Sprite(this.glowTex()); glow.anchor.set(.5); glow.blendMode = 'add'; glow.tint = 0xffb060; glow.position.set(Math.round(x), Math.round(y - 10)); glow.zIndex = y + .6;
        const ring = new Graphics();
        this.sorted.addChild(ball, glow); this.flat.addChild(ring);
        this.blasts.push({ ball, glow, ring, x, y, r: radius, t: null, swell: 1, seen: false });
        // Debris and soot thrown out, then a column of smoke.
        for (let i = 0; i < 8; i++) {
            const a = this.rnd() * Math.PI * 2, v = 50 + this.rnd() * 90;
            this.fx.spawn({ x, y, h: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6, vh: 90 + this.rnd() * 110, ttl: 1.1, color: i % 2 ? 0x3a332c : 0x5b4f43, g: 420, size: 2, settle: 'stay', decor: true });
        }
        for (let i = 0; i < 7; i++) this.fx.spawn({ x: x + (this.rnd() - .5) * 18, y: y + (this.rnd() - .5) * 8, h: 8 + this.rnd() * 10, vx: -8 - this.rnd() * 10, vy: (this.rnd() - .5) * 6,
            vh: 14 + this.rnd() * 16, ttl: 1.3 + this.rnd() * .9, color: i % 2 ? 0x4a4542 : 0x645d57, g: -10, size: 3 + (this.rnd() < .4 ? 1 : 0), decor: true });
        this.light.lights.push({ x, y, r: 190, color: 0xff9440, k: 1, ttl: .42, region }, { x, y: y - 6, r: 80, color: 0xfff1c6, k: 1, ttl: .13, region });
        return true;
    }

    /** `n` burning flecks thrown up from (`x`, `y`), faster with `force`. */
    private embers(x: number, y: number, n: number, force: number, h = 6) {
        for (let i = 0; i < n; i++) {
            const a = this.rnd() * Math.PI * 2, v = (30 + this.rnd() * 120) * force;
            this.fx.spawn({ x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6, vh: (60 + this.rnd() * 160) * force, ttl: .5 + this.rnd() * .7,
                color: i % 3 === 0 ? 0xfff2b0 : i % 3 === 1 ? 0xffb347 : 0xff6a2a, g: 260, add: true });
        }
    }

    /** A tracer round strikes at drawn point (`x`, `y` - `h`): a star in its colours, a spray of sparks along `n` and a short light. */
    star(x: number, y: number, h: number, n: Point, region: string | null, pal: TracerPalette) {
        const s = new Sprite(this.tex.ensure('fx:star', paintStar)); s.anchor.set(.5); s.blendMode = 'add'; s.tint = pal.star;
        s.position.set(Math.round(x), Math.round(y - h)); s.zIndex = y + .4; s.rotation = this.rnd() < .5 ? 0 : Math.PI / 4;
        this.sorted.addChild(s); this.stars.push({ s, t: null }); this.made.stars++;
        for (let i = 0; i < 10; i++) {
            const a = Math.atan2(n.y, n.x) + (this.rnd() - .5) * 2.6, v = 90 + this.rnd() * 170;
            this.fx.spawn({ x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6, vh: 40 + this.rnd() * 110, ttl: .2 + this.rnd() * .3, color: pal.sparks[i % pal.sparks.length], add: true });
        }
        this.light.lights.push({ x, y, r: 64, color: pal.light, k: .9, ttl: .1, region });
    }

    /**
     * Once per presented frame: the ground fires and burning bodies of `fires` and `actors` (absent fires: none), each
     * hidden while `shown` says its spot is in an unrevealed room.
     */
    sync(fires: readonly FireView[] | undefined, actors: readonly ActorView[], shown: (p: Point) => boolean, regionAt: (p: Point) => string | null) {
        const live = new Set<number>();
        for (const f of fires ?? []) {
            live.add(f.id);
            let g = this.fires.get(f.id);
            if (!g) {
                const flames: Flame[] = [];
                const n = 9;
                for (let i = 0; i < n; i++) {
                    // Bigger flames in the middle, smaller ones at the edge of the patch.
                    const a = hash(f.id, i, 41) * Math.PI * 2, u = i === 0 ? 0 : Math.sqrt(hash(f.id, i, 43)), d = u * f.r * .8;
                    const s = new Sprite(this.flameTex(0)); s.anchor.set(.5, 1);
                    flames.push({ s, ox: Math.cos(a) * d, oy: Math.sin(a) * d * .7, phase: hash(f.id, i, 47) * FLAME_FRAMES, size: (1.35 - u * .55) * (.85 + hash(f.id, i, 53) * .3) });
                    this.sorted.addChild(s);
                }
                const glow = new Sprite(this.glowTex()); glow.anchor.set(.5); glow.blendMode = 'add'; glow.tint = 0xff7a2a;
                glow.position.set(Math.round(f.x), Math.round(f.y)); glow.scale.set(f.r * 1.5 / 64, f.r * 1.1 / 64);
                this.flat.addChild(glow);
                const light: Light = { x: f.x, y: f.y, r: f.r * 3.4, color: 0xff8a3c, k: .6, region: regionAt(f) };
                this.light.lights.push(light);
                g = { flames, glow, light, x: f.x, y: f.y, r: f.r, ember: 0 };
                this.fires.set(f.id, g);
            }
            // Up within a fifth of a second, down over the last ~0.7 s.
            const k = Math.min(1, (f.total - f.left) / .2 + .25) * Math.min(1, f.left / .7), show = shown(f);
            this.flames(g.flames, f.x, f.y, k, show, 0);
            g.glow.visible = show; g.glow.alpha = .45 * k;
            g.light.k = show ? .62 * k * this.flicker(f.id) : 0;
            if (show && k > .3) {
                g.ember -= 1;
                if (g.ember <= 0) {
                    g.ember = 3 + Math.floor(this.rnd() * 4);
                    const fl = g.flames[Math.floor(this.rnd() * g.flames.length)];
                    this.fx.spawn({ x: f.x + fl.ox, y: f.y + fl.oy, h: 8, vx: (this.rnd() - .5) * 16, vy: (this.rnd() - .5) * 6, vh: 30 + this.rnd() * 40, ttl: .6 + this.rnd() * .5,
                        color: this.rnd() < .5 ? 0xffc35a : 0xff7b33, g: -6, add: true, decor: true });
                    if (this.rnd() < .35) this.fx.spawn({ x: f.x + fl.ox, y: f.y + fl.oy, h: 14, vx: -6 - this.rnd() * 6, vy: 0, vh: 10 + this.rnd() * 10, ttl: 1.2 + this.rnd() * .6,
                        color: 0x4f4844, g: -6, size: 3, decor: true });
                }
            }
        }
        for (const [id, g] of this.fires) if (!live.has(id)) { this.dropFire(g); this.fires.delete(id); }

        const lit = new Set<string>();
        for (const a of actors) {
            if (!a.alive || !a.burning) continue;
            lit.add(a.uid);
            let g = this.burning.get(a.uid);
            if (!g) {
                const flames: Flame[] = [[-5, 1, 1.05], [5, 0, .95], [-3, -9, .85], [4, -14, .75], [0, -21, .7]].map(([ox, oy, size], i) => {
                    const s = new Sprite(this.flameTex(0)); s.anchor.set(.5, 1); this.sorted.addChild(s);
                    return { s, ox, oy, phase: i * 1.3, size };
                });
                const light: Light = { x: a.x, y: a.y, r: 70, color: 0xff8a3c, k: .5, region: a.regionId };
                this.light.lights.push(light);
                g = { flames, light, ember: 0 };
                this.burning.set(a.uid, g);
            }
            const k = Math.min(1, a.burning / .5), show = shown(a);
            this.flames(g.flames, a.x, a.y, k, show, .25);
            g.light.x = a.x; g.light.y = a.y; g.light.region = a.regionId; g.light.k = show ? .55 * k * this.flicker(a.x) : 0;
            if (show) {
                g.ember -= 1;
                if (g.ember <= 0) { g.ember = 2 + Math.floor(this.rnd() * 3); this.embers(a.x + (this.rnd() - .5) * 10, a.y, 1, .5, 10 + this.rnd() * 14); }
            }
        }
        for (const [uid, g] of this.burning) if (!lit.has(uid)) { this.dropBurn(g); this.burning.delete(uid); }
    }

    /** Place and animate a set of flames around ground point (x, y): height scaled by `k`, in front of a body by `z`. */
    private flames(flames: Flame[], x: number, y: number, k: number, show: boolean, z: number) {
        for (const fl of flames) {
            fl.s.visible = show && k > .02;
            if (!fl.s.visible) continue;
            const frame = Math.floor(this.time * 11 + fl.phase) % FLAME_FRAMES;
            fl.s.texture = this.flameTex(frame);
            const lick = 1 + .18 * Math.sin(this.time * 17 + fl.phase * 5);
            fl.s.position.set(Math.round(x + fl.ox), Math.round(y + fl.oy));
            fl.s.scale.set(fl.size, Math.max(.1, fl.size * k * lick));
            fl.s.zIndex = y + Math.max(0, fl.oy) + z;
        }
    }

    /** A fire's light wavers a little, never on a reduced-motion screen. */
    private flicker(seed: number) {
        if (this.reduced()) return 1;
        const t = this.time;
        return .82 + .12 * Math.sin(t * 13 + seed) + .06 * Math.sin(t * 31 + seed * 3);
    }

    /** Age the bursts and stars by `dt`; a piece made this frame is first drawn as it is (it survives its first frame). */
    update(dt: number) {
        this.time += dt;
        for (let i = this.blasts.length - 1; i >= 0; i--) {
            const b = this.blasts[i];
            if (b.t === null) { b.t = 0; this.pose(b); continue; }
            b.t += dt;
            if (b.t >= BLAST_LIFE) { b.ball.destroy(); b.glow.destroy(); b.ring.destroy(); this.blasts.splice(i, 1); continue; }
            this.pose(b);
        }
        for (let i = this.stars.length - 1; i >= 0; i--) {
            const s = this.stars[i];
            if (s.t === null) { s.t = 0; continue; }
            s.t += dt; s.s.alpha = 1 - s.t / .09; s.s.scale.set(1 + s.t * 6);
            if (s.t >= .09) { s.s.destroy(); this.stars.splice(i, 1); }
        }
    }
    private pose(b: Blast) {
        const t = b.t!, p = t / BLAST_LIFE;
        b.ball.texture = this.ball(Math.min(FIREBALL_FRAMES - 1, Math.floor(p * FIREBALL_FRAMES)));
        b.ball.scale.set(b.swell * (b.r / 34));
        b.ball.alpha = p < .8 ? 1 : 1 - (p - .8) / .2;
        const flash = Math.max(0, 1 - t / .2);
        b.glow.alpha = flash; b.glow.scale.set((.35 + (1 - flash) * .5) * b.swell * (b.r / 34));
        b.glow.visible = flash > 0;
        b.ring.clear();
        if (t < RING_LIFE) {
            const q = 1 - (1 - t / RING_LIFE) ** 3, rr = 4 + q * b.r * 1.5 * b.swell;
            b.ring.circle(Math.round(b.x), Math.round(b.y), rr).stroke({ width: 2, color: 0xffe2b0, alpha: .7 * (1 - t / RING_LIFE) });
            b.ring.circle(Math.round(b.x), Math.round(b.y), rr * .82).stroke({ width: 1, color: 0xff9a50, alpha: .4 * (1 - t / RING_LIFE) });
        }
    }

    /** Hide or show the bursts and stars whose spot is in an unrevealed room. */
    reveal(shown: (p: Point) => boolean) {
        for (const b of this.blasts) { const on = shown(b); b.ball.visible = on; b.glow.visible = on && b.glow.alpha > 0; b.ring.visible = on; }
    }

    private dropFire(g: FireGfx) {
        for (const f of g.flames) f.s.destroy();
        g.glow.destroy();
        this.light.lights = this.light.lights.filter(l => l !== g.light);
    }
    private dropBurn(g: BurnGfx) {
        for (const f of g.flames) f.s.destroy();
        this.light.lights = this.light.lights.filter(l => l !== g.light);
    }

    /** Counts for checks: bursts playing, ground fires and burning bodies drawn, and bursts and stars made so far. */
    get counts() { return { blasts: this.blasts.length, fires: this.fires.size, burning: this.burning.size, made: { ...this.made } }; }

    /** The scene was cleared (its layers' children destroyed): forget every piece, and take the fire lights out. */
    clear() {
        const owned = new Set<Light>([...this.fires.values(), ...this.burning.values()].map(g => g.light));
        this.light.lights = this.light.lights.filter(l => !owned.has(l));
        this.blasts = []; this.stars = []; this.fires.clear(); this.burning.clear(); this.made = { blasts: 0, stars: 0 };
    }
}
