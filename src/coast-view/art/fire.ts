/**
 * Pixel pictures for the special rounds (special-rounds.ts): the fireball of a dragon's breath burst (FIREBALL_FRAMES
 * frames from flash to smoke), a ground or body flame (FLAME_FRAMES flickering frames), the scorch a burst leaves and the
 * star of a tracer's impact. Painted once on canvases, ordered-dithered to a few flat colours like the rest of the art.
 */
import { canvas, hash } from './paint';

export const FIREBALL_FRAMES = 8;
export const FIREBALL_SIZE = 48;
export const FLAME_FRAMES = 4;
export const FLAME_W = 12;
export const FLAME_H = 18;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => BAYER4[((y & 3) << 2) | (x & 3)] / 16 - .5;
/** Hot to cold: white-hot, yellow, orange, red-orange, deep red, soot. */
const HEAT: readonly [number, number, number][] = [[255, 251, 226], [255, 222, 112], [255, 166, 52], [234, 98, 36], [160, 46, 26], [74, 36, 30]];
const SMOKE: [number, number, number] = [58, 52, 50];
/** The palette entry for a heat 0..1 (1 is white-hot). */
function heatColor(h: number): [number, number, number] {
    if (h > .86) return HEAT[0];
    if (h > .68) return HEAT[1];
    if (h > .5) return HEAT[2];
    if (h > .33) return HEAT[3];
    if (h > .18) return HEAT[4];
    return HEAT[5];
}
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Frame `f` of a burst seen from the side: a cauliflower of hot lobes around a white core that swells, rolls upward and
 * cools through yellow and orange to a ragged red shell, then tears open into soot. Lumps come from 2-3 px noise cells,
 * so the edge reads as pixel fire.
 */
export function paintFireball(f: number): HTMLCanvasElement {
    const S = FIREBALL_SIZE, { c, g } = canvas(S, S), img = g.createImageData(S, S), d = img.data;
    const t = f / (FIREBALL_FRAMES - 1), grow = easeOut(Math.min(1, t * 1.7)), R = S / 2 * (.3 + .56 * grow);
    // The whole ball rises a little as it burns out; the lobes roll outward and up.
    const cx = S / 2, cy = S / 2 + 4 - t * 6;
    const lobes = Array.from({ length: 7 }, (_, k) => {
        const a = k / 7 * Math.PI * 2 + hash(k, 1, 91) * .8, out = R * (.32 + .3 * hash(k, 2, 91)) * (.7 + .5 * grow);
        return { x: cx + Math.cos(a) * out, y: cy + Math.sin(a) * out * .8 - t * R * .35 * (Math.sin(a) < 0 ? 1.4 : .6), r: R * (.42 + .22 * hash(k, 3, 91)) };
    });
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = x + .5, py = y + .5;
        let field = 1 - Math.hypot(px - cx, (py - cy) * (py > cy ? 1.3 : 1)) / (R * .62);
        for (const l of lobes) field = Math.max(field, 1 - Math.hypot(px - l.x, py - l.y) / l.r);
        const n1 = hash(x / 3 | 0, y / 3 | 0, 71 + f), n2 = hash(x >> 1, y >> 1, 13 + f * 3), n3 = hash(x / 4 | 0, y / 4 | 0, 5 + (f >> 2));
        field += (n1 - .5) * .32 + (n2 - .5) * .14;
        if (field <= 0) continue;
        // Late frames tear open from the inside out and leave soot at the rim.
        if (t > .42 && n3 + (n2 - .5) * .35 < (t - .42) * 1.7 * (1.15 - field * .5)) continue;
        const heat = field * (1.55 - t * 1.45) + (n2 - .5) * .2 + bayer(x, y) * .16;
        const smoke = heat < .12 && t > .2;
        const [r, gg, b] = smoke ? SMOKE : heatColor(heat);
        const i = (y * S + x) * 4;
        d[i] = r; d[i + 1] = gg; d[i + 2] = b;
        d[i + 3] = smoke ? Math.round(215 * (1 - t * .65)) : 255;
    }
    g.putImageData(img, 0, 0);
    return c;
}

/**
 * Frame `f` of a flame standing on its base (bottom centre): a full rounded body that narrows into two or three licking
 * tongues, white-yellow at the root, orange through the body and red at the tips, swaying a little. The frames loop.
 */
export function paintFlame(f: number): HTMLCanvasElement {
    const W = FLAME_W, H = FLAME_H, { c, g } = canvas(W, H), img = g.createImageData(W, H), d = img.data;
    const phase = f / FLAME_FRAMES * Math.PI * 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const up = 1 - (y + .5) / H; // 0 at the base, 1 at the tip
        const sway = Math.sin(phase + up * 2.6) * 1.3 * up;
        // A round belly low down that tapers to the tips.
        const half = (W / 2 - .4) * (up < .28 ? .62 + up * 1.35 : Math.pow(Math.max(0, 1 - (up - .28) / .72), .75));
        const dx = x + .5 - (W / 2 + sway);
        // Tongues: the upper body splits where a slow wave runs across it.
        const tongue = up > .45 ? Math.max(0, Math.sin(dx * 1.25 + phase * 1.5 + up * 3)) * (up - .45) * 1.6 : 0;
        const n = hash(x, y, 300 + f * 17);
        const k = Math.abs(dx) / Math.max(.5, half) + tongue + (n - .5) * .38;
        if (k > 1) continue;
        const heat = (1 - k * .8) * (1.05 - up * .95) + bayer(x, y) * .16 + .08;
        const [r, gg, b] = heatColor(heat);
        const i = (y * W + x) * 4;
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
}

/** A burst's scorch on the ground, 34x18: soot spreading from a black centre, ragged at the edge; four variants. */
export function paintScorch(v: number): HTMLCanvasElement {
    const W = 34, H = 18, { c, g } = canvas(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x + .5 - W / 2) / (W / 2), dy = (y + .5 - H / 2) / (H / 2), r = dx * dx + dy * dy + (hash(x >> 1, y >> 1, 500 + v) - .5) * .55;
        if (r > 1) continue;
        // Rays of soot thrown outward: some outer pixels stay bare.
        if (r > .55 && hash(x, y, 520 + v) < .35) continue;
        g.fillStyle = r < .22 ? 'rgba(14,11,10,.78)' : r < .55 ? 'rgba(26,20,17,.6)' : 'rgba(40,32,26,.38)';
        g.fillRect(x, y, 1, 1);
    }
    return c;
}

/**
 * The star a tracer round flashes where it strikes, 11x11: a white-hot cross with short diagonals, fading in grey steps
 * toward its tips, so a tint gives it the tracer's colour.
 */
export function paintStar(): HTMLCanvasElement {
    const S = 11, { c, g } = canvas(S, S), m = 5;
    for (let i = -5; i <= 5; i++) {
        const a = Math.abs(i), col = a < 2 ? '#ffffff' : a < 4 ? '#c8c8c8' : '#8a8a8a';
        g.fillStyle = col; g.fillRect(m + i, m, 1, 1); g.fillRect(m, m + i, 1, 1);
        if (a <= 2) { g.fillStyle = a < 2 ? '#e8e8e8' : '#a0a0a0'; g.fillRect(m + i, m + i, 1, 1); g.fillRect(m + i, m - i, 1, 1); }
    }
    return c;
}
