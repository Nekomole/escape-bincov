/**
 * Market story props (#83), drawn in code like the other props: 蔡建平's spare tool cabinet, the old chest freezer and
 * the switch room's breaker box. None of them blocks anything; the cabinet is the Runtime's own container (its look
 * follows the crate rule: closed, open while its loot panel is up, searched empty), the other two are scenery.
 */
import { P, canvas, dot, rect } from './paint';

/** Cabinet canvas: 24 x 40, standing on its foot row CABINET_FOOT. */
export const CABINET_FOOT = 36;
const STEEL = '#4f5a52', STEEL_LIGHT = '#66716a', STEEL_DARK = '#3b443e', INSIDE = '#1c1d1a', SHELF = '#6e6c5f';

/** A tall steel locker with a paper label (蔡建平 · 备用). Open, its second shelf holds the newspaper parcel. */
export function paintToolCabinet(look: 'full' | 'empty' | 'open'): HTMLCanvasElement {
  const { c, g } = canvas(24, 40);
  rect(g, 'rgba(20,18,15,.35)', 3, 34, 20, 4);
  rect(g, P.ink, 3, 3, 19, 34);
  rect(g, STEEL_LIGHT, 4, 3, 17, 2); rect(g, STEEL, 4, 5, 17, 31); rect(g, STEEL_DARK, 4, 33, 17, 3);
  if (look === 'full') {
    // Two closed doors, a seam, two handles and the paper label strip with its pencilled marks.
    rect(g, STEEL_DARK, 12, 6, 1, 27); rect(g, '#59655c', 5, 6, 7, 1); rect(g, '#59655c', 13, 6, 7, 1);
    rect(g, '#9a9a88', 10, 17, 1, 4); rect(g, '#9a9a88', 14, 17, 1, 4);
    rect(g, '#d6ccb0', 6, 9, 13, 4); rect(g, '#b9ae90', 6, 12, 13, 1);
    for (const x of [7, 8, 10, 11, 13, 15, 16]) dot(g, '#4a4436', x, 10);
    for (const x of [8, 9, 12, 14, 15]) dot(g, '#4a4436', x, 11);
    rect(g, P.rust, 5, 30, 3, 2); dot(g, P.rustLight, 18, 26);
    return c;
  }
  // Doors open: the left door swung out, the inside dark with three shelves. The second shelf is the one 小蔡 means.
  rect(g, P.ink, 0, 4, 4, 32); rect(g, STEEL_LIGHT, 1, 5, 2, 30); rect(g, '#d6ccb0', 1, 9, 2, 3);
  rect(g, INSIDE, 5, 5, 15, 28);
  for (const y of [13, 21, 29]) { rect(g, SHELF, 5, y, 15, 1); rect(g, '#3a3933', 5, y + 1, 15, 1); }
  rect(g, STEEL_DARK, 20, 5, 1, 28);
  // Third shelf: odds and ends that were never part of the order.
  rect(g, '#5d5a4c', 7, 26, 4, 3); rect(g, '#8a6f45', 13, 27, 5, 2);
  if (look === 'open') {
    // The parcel in old newspaper on the second shelf.
    rect(g, '#cfc4a3', 7, 16, 11, 5); rect(g, '#e2d8b8', 7, 16, 11, 1); rect(g, '#9b917a', 7, 20, 11, 1);
    for (const x of [8, 10, 11, 14, 16]) dot(g, '#6b6455', x, 18);
    rect(g, '#7a5a3a', 12, 16, 1, 5);
  } else {
    // Searched: a torn corner of the newspaper is all that is left.
    rect(g, '#b9ae90', 15, 19, 3, 2); dot(g, '#6b6455', 16, 19);
  }
  return c;
}

/** Freezer canvas: 34 x 24, standing on its foot row FREEZER_FOOT. */
export const FREEZER_FOOT = 21;
/** An old chest freezer, enamel gone grey, rust along the hinge and the drain; its lamp is dark. */
export function paintFreezer(): HTMLCanvasElement {
  const { c, g } = canvas(34, 24);
  rect(g, 'rgba(20,18,15,.35)', 2, 19, 31, 4);
  rect(g, P.ink, 1, 3, 32, 18);
  rect(g, '#c4c1b2', 2, 3, 30, 6); rect(g, '#d6d3c4', 2, 3, 30, 1); rect(g, '#9f9c8e', 2, 8, 30, 1);
  rect(g, '#aeab9c', 2, 9, 30, 10); rect(g, '#8d8a7d', 2, 18, 30, 2);
  rect(g, '#7c7a6e', 13, 9, 8, 2); rect(g, '#5a5850', 14, 10, 6, 1);
  for (let x = 4; x < 30; x += 3) rect(g, '#9a978a', x, 14, 2, 3);
  rect(g, P.rust, 2, 8, 30, 1); rect(g, P.rustLight, 6, 9, 1, 4); rect(g, P.rust, 24, 9, 1, 6); rect(g, P.rust, 27, 17, 3, 2);
  rect(g, '#3b2a24', 29, 11, 2, 2);
  return c;
}

/** Breaker canvas: 24 x 34, standing on its foot row BREAKER_FOOT. */
export const BREAKER_FOOT = 32;
/**
 * The switch room's breaker box on its stand, door hanging open: the knife switch's handle is down, salt crusted on
 * the grip. Down is the state the story records; nothing in the view can push it back up.
 */
export function paintBreaker(): HTMLCanvasElement {
  const { c, g } = canvas(24, 34);
  rect(g, 'rgba(20,18,15,.35)', 5, 30, 18, 4);
  // Stand and box.
  rect(g, P.ink, 12, 22, 4, 10); rect(g, '#6f7571', 13, 22, 2, 10);
  rect(g, P.ink, 6, 1, 17, 23);
  rect(g, '#9aa09b', 7, 1, 15, 2); rect(g, '#7f8681', 7, 3, 15, 19); rect(g, '#5f6662', 7, 21, 15, 2);
  // Hazard band along the top edge.
  for (let x = 7; x < 22; x += 4) { rect(g, '#d4b04c', x, 3, 2, 2); rect(g, '#2b2a24', x + 2, 3, 2, 2); }
  rect(g, '#24282a', 9, 6, 11, 14);
  // The knife switch: two copper jaws, the pivot bar, and the blade swung down to its open position.
  rect(g, '#c08a4a', 11, 7, 2, 3); rect(g, '#c08a4a', 16, 7, 2, 3);
  rect(g, '#a7aca7', 10, 11, 9, 2);
  rect(g, '#e2e3dc', 12, 13, 1, 4); rect(g, '#e2e3dc', 16, 13, 1, 4); rect(g, '#b9bcb5', 12, 16, 5, 1);
  rect(g, '#2a1d18', 12, 17, 5, 3); rect(g, '#a33a2c', 12, 17, 5, 1);
  for (const [x, y] of [[12, 18], [14, 19], [16, 18], [13, 16], [15, 17]]) dot(g, '#f2efe4', x, y);
  // The door hangs open to the left, a warning triangle on it.
  rect(g, P.ink, 1, 2, 6, 21); rect(g, '#8a918c', 2, 3, 4, 19);
  rect(g, '#d4b04c', 2, 8, 4, 4); dot(g, '#2b2a24', 3, 9); dot(g, '#2b2a24', 4, 9); dot(g, '#2b2a24', 3, 10);
  dot(g, '#f2efe4', 9, 21); dot(g, '#f2efe4', 20, 20);
  return c;
}
