import * as D from './domain';
import { TILE } from './world';

export function departureWarnings(save: D.SaveDataV1): string[] {
    const warnings: string[] = [], weapon = save.equipment.weapon && D.WEAPONS[save.equipment.weapon];
    if (!weapon) warnings.push('未装备主武器');
    else if (weapon.ammo && !D.count(save.bag, weapon.ammo)) warnings.push(`背包缺少备用${D.ITEMS[weapon.ammo].name}`);
    const medicine = (inv: D.Inventory) => D.count(inv, 'bandage') + D.count(inv, 'medkit');
    if (!medicine(save.bag)) warnings.push(medicine(save.safe) ? '止血用品仅在安全箱，快捷治疗不可用' : '未携带止血用品');
    return warnings;
}
export function questProgress(save: D.SaveDataV1, loadout: D.RunLoadout | null) {
    return Object.entries(D.QUESTS).filter(([key]) => !save.quests[key]).map(([key, q]) => ({
        key, name: q.name, requirements: D.questRequirements(save, key), needs: Object.entries(q.needs).map(([id, needed]) => ({
            id, needed,
            stored: loadout ? D.count(save.stash, id) : [save.stash, save.bag, save.safe].reduce((n, inv) => n + D.count(inv, id), 0),
            carried: loadout ? D.count(loadout.bag, id) + D.count(loadout.safe, id) : 0,
        })),
    }));
}
/** Item ids to ring in an inventory grid as quest needs; see questMarks. */
export interface QuestMarks { own: ReadonlySet<string>; wanted: ReadonlySet<string> }
/**
 * Quest-item rings (maintainer 2026-11-02). `own`: every item an unfinished radio quest asks for, rung wherever the
 * player already holds it (bag, safe, stash, the sell list), until the quest is handed in. `wanted`: only the items the
 * player still holds fewer of than the quests ask for, rung outside too (a raid container or body, the arms counter, the
 * buy list); once enough are held, outside copies go plain while the held ones stay rung. "Held" is the quest card's
 * count: stash plus carried during a raid, stash, bag and safe at the station.
 */
export function questMarks(save: D.SaveDataV1, loadout: D.RunLoadout | null): QuestMarks {
    const need = new Map<string, number>(), held = new Map<string, number>();
    for (const quest of questProgress(save, loadout)) for (const n of quest.needs) {
        need.set(n.id, (need.get(n.id) ?? 0) + n.needed); held.set(n.id, n.stored + n.carried);
    }
    return { own: new Set(need.keys()), wanted: new Set([...need].filter(([id, n]) => (held.get(id) ?? 0) < n).map(([id]) => id)) };
}
export function exitBearing(player: { x: number; y: number }, exit: { x: number; y: number }) {
    const dx = exit.x - player.x, dy = exit.y - player.y, angle = Math.atan2(dy, dx);
    return { angle, direction: ['东', '东南', '南', '西南', '西', '西北', '北', '东北'][(Math.round(angle / (Math.PI / 4)) + 8) % 8], distance: Math.hypot(dx, dy) / TILE };
}
