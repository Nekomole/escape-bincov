import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * #163 batch 2: interface colours come from src/ui-tokens.css. A rule writes rgb(var(--ui-…)) or a named variable; a
 * colour literal is only allowed in a custom property's own definition (a local name such as --cs-hit) or as pure
 * black / white (shadows, highlights). The opening cutscene is art and keeps its own colours.
 */
const SHEETS = ['src/style.css', 'src/title.css', 'src/tactical.css', 'src/coast-view/coast.css', 'src/gunsmith-view/bench.css',
    'src/station-view/station.css', 'src/range/range.css'];
const tokens = readFileSync('src/ui-tokens.css', 'utf8');
const defined = new Set([...tokens.matchAll(/(--ui-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d[^)]*\)/g;
const blackOrWhite = (c: string) => /^#(0{3,4}|0{6}|0{6}[0-9a-f]{2}|0{3}[0-9a-f]|f{3,4}|f{6}|f{6}[0-9a-f]{2}|f{3}[0-9a-f])$/i.test(c)
    || /^rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*(,|\))/.test(c);
/** Declarations (property, value) of a stylesheet; selectors and comments skipped. */
function declarations(css: string) {
    const parts = css.replace(/\/\*[\s\S]*?\*\//g, '').split(/([{};])/), out: [string, string][] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i], colon = seg.indexOf(':');
        if (parts[i + 1] === '{' || colon < 0) continue;
        out.push([seg.slice(0, colon).trim(), seg.slice(colon + 1).trim()]);
    }
    return out;
}

test('stylesheets take interface colours from the shared tokens', () => {
    const stray: string[] = [];
    for (const file of SHEETS) for (const [prop, value] of declarations(readFileSync(file, 'utf8'))) {
        if (prop.startsWith('--')) continue;
        for (const c of value.match(COLOUR) ?? []) if (!blackOrWhite(c)) stray.push(`${file}: ${prop}: ${c}`);
    }
    assert.deepEqual(stray, []);
});

test('every --ui- token a stylesheet uses is defined, and the page loads the tokens first', () => {
    const missing = new Set<string>();
    for (const file of SHEETS) for (const m of readFileSync(file, 'utf8').matchAll(/var\((--ui-[a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.add(`${file}: ${m[1]}`);
    assert.deepEqual([...missing], []);
    const build = readFileSync('scripts/build.mjs', 'utf8');
    assert.ok(build.indexOf("'src/ui-tokens.css'") >= 0 && build.indexOf("'src/ui-tokens.css'") < build.indexOf("'src/style.css'"), 'ui-tokens.css must come before the other page sheets');
});
