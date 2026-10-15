// Page-side: the combat-stats SCAN — one read-only sweep of game.messages for By the Books' stat
// stamps (Battle Flow until its 3.0.0 rename) plus the raw d20 rolls the buff-margin and
// advantage meters need.
//
// THE READ CONTRACT is fvtt-mod-bythebooks' ARCHITECTURE.md §4 "The data plane — stat stamps".
// The flags are read as an EXTERNAL WIRE FORMAT (a data contract, not a code dependency — user
// constraint 2026-08-27): nothing here imports the module. Contract essentials:
//   • TWO SCOPES, one shape. By the Books 3.0.0 (renamed from Battle Flow, 2026-10-11) stamps new
//     cards under `flags["fvtt-mod-bythebooks"]`; every card written before a world upgraded, and
//     every card a table still on Battle Flow 2.x writes, keeps `flags["fvtt-mod-battleflow"]`
//     forever (the module never migrates chat messages). One session's log can hold both, so the
//     scope is chosen PER MESSAGE, not per world: `stampScope` reads the new scope first and
//     falls back to the old on that same message, family by family.
//   • every stamped record carries `combat` ("combatId:round:turn", null = out of combat) and
//     `sourceUuid` (null = no honest source); an ABSENT field marks a pre-plane legacy record —
//     never conflate absent with explicit null.
//   • unlinked tokens stamp their SYNTHETIC actor uuid (THAT goblin); the fold normalizes to
//     archetype identity Node-side.
//   • the fold (src/analytics/combat.ts) subtracts `reverted` — ruling R-B.
//
// Ported verbatim from fvtt-mcp-dnd5e's src/page/combat-stats.ts, adding `until`. This is the
// only copy since that repo's 4.0.0 retired get-combat-stats, and it has since grown the
// 2026-09-01 and 2026-09-05 families (see BF_KEYS).
//
// READ-ONLY by design: no writes, no settings, no fixtures — safe beside a live session.
// The scan returns raw JSON; all folding happens Node-side so it is unit-testable.

const BTB_MOD = 'fvtt-mod-bythebooks';
const LEGACY_BF_MOD = 'fvtt-mod-battleflow';

/**
 * One message's stamps: By the Books' scope first, Battle Flow's as the fallback on the same
 * message. Both present (an old card touched after the upgrade) merges family by family, the new
 * scope winning; neither is undefined.
 */
export function stampScope(flags: any): Record<string, any> | undefined {
  const fresh = flags?.[BTB_MOD];
  const legacy = flags?.[LEGACY_BF_MOD];
  if (fresh && legacy) return { ...legacy, ...fresh };
  return fresh ?? legacy ?? undefined;
}
// Families folded from `stamped`: every key By the Books writes on a chat card that records
// something that HAPPENED at the table, stamped with who and when (its contracts/card-flags.json:
// `stamp`). The 28 the contract table named first, then (2026-10-15, the suite's contract pass)
// every other moment record that is a consequence or a use, so per-actor moments and spends are no
// longer under-counted. rollCtx and combatRoster are deliberately NOT here: rollCtx rides the d20
// entries (its message IS the roll), and combatRoster feeds `rosters`. The families left out on
// purpose are SKIPPED_FAMILIES, each with its reason; the scan counts what it skipped and the
// report says so.
export const BF_KEYS = [
  'receipt',
  'effectReceipt',
  'd20fold',
  'precision',
  'mastery',
  'bashOffer',
  'riposte',
  'topple',
  'saves',
  'hold',
  'holdSkipped',
  'volley',
  'concentration',
  'spend',
  // 2026-09-01: the gate's reminders and the chips an attack used up (on the attack message)
  'reminder',
  'chipSpend',
  // 2026-09-05: wards, maneuvers, bare damage casts, emanations
  'damageShield',
  'shieldMark',
  'superiorityUse',
  'superiorityRide',
  'baitSwitch',
  'command',
  'damageCast',
  'emanationHeal',
  'emanationRemind',
  // in the table since 2026-09-23: a clock rider riding a hit, and an aura's card
  'clockRiders',
  'emanationCard',
  // 2026-09-26: a Fighting Style's number on a damage roll
  'fightingStyle',
  // 2026-10-15, the moment records the scan had missed (By the Books' contracts/card-flags.json)
  // ... the maneuvers and riders that rode a hit
  'hitManeuver',
  'commandRide',
  'sweepCard',
  'sneakDamage',
  'spellRiderCard',
  // ... a reaction or an offer answered
  'damageHold',
  'dropToOne',
  'deathSaveOffer',
  'rebuke',
  'bystanderRoll',
  'initiativeSwap',
  'initiativeGrant',
  'conditionEnd',
  'grappleDamage',
  'kitTend',
  'restSong',
  // ... the dice changed after the roll
  'diceChange',
  'healReroll',
  // ... a summon, a transformation, metamagic
  'summon',
  'transform',
  'metamagic',
  // ... a pool, a chip or a coating spent
  'poolSpend',
  'useChip',
  'coatUse',
  'coatHit',
  'cardChip',
];

/**
 * By the Books' families the scan reads past on purpose, each with why: a decision whose
 * consequence another family stamps, sheet upkeep at a rest, or a record with no stamp. The scan
 * counts every family it skipped (these and any it does not know) and the report names them.
 */
export const SKIPPED_FAMILIES: Record<string, string> = {
  castApply: 'a decision, unstamped by ruling; the effect it picks is in effectReceipt',
  areaChoice: 'a decision: who the area affects; the saves and effects are stamped where they land',
  typePick: 'a decision: the damage type; the damage is in the receipt',
  masteryPick: 'a decision: which mastery; the mastery record is the resolve',
  masterySwap: 'sheet upkeep at a long rest, not play',
  formSwap: 'sheet upkeep at a long rest, not play',
  tacticalRefund: 'carries no stat stamp; the fold it refunds is in d20fold',
};

/** Keys read elsewhere than the families: the roll's own context and the combat roster. */
const READ_ELSEWHERE = new Set(['rollCtx', 'combatRoster']);
const D20_TYPES = new Set(['attack', 'save', 'ability', 'skill', 'tool', 'concentration', 'death']);

export interface ScanCombatStatsArgs {
  since?: number | undefined;
  /** Inclusive upper bound (epoch ms); absent = to the end of the log. */
  until?: number | undefined;
}

// --- dnd5e message-data readers (PURE, unit-tested) --------------------------------------------
// dnd5e 6.0 moved a card's identity out of flags into typed ChatMessage system data:
//   message.type ∈ attack | save | check | damage | healing | usage | generic | hitDie | hitPoints…
//   system.item {id,type,uuid} · system.activity {…} · system.origin (message id) ·
//   system.targets[] {actor (uuid), token (uuid), name, ac, img}   (no `uuid` field any more)
// The 5.x flags (flags.dnd5e.roll.type / item / use / targets / originatingMessage) are read as a
// fallback only — the world migration rewrites old messages into the typed shape.

/** The 5.x-vocabulary roll type of a message (attack/save/death/concentration/ability/skill/tool/…). */
export function messageRollType(m: any): string | undefined {
  const type = typeof m?.type === 'string' ? m.type : '';
  const sys = m?.system ?? {};
  switch (type) {
    case 'attack':
    case 'damage':
    case 'healing':
    case 'hitDie':
    case 'hitPoints':
    case 'generic':
      return type;
    case 'save':
      return sys.type === 'death' || sys.type === 'concentration' ? sys.type : 'save';
    case 'check':
      if (sys.skill) return 'skill';
      if (sys.tool) return 'tool';
      return sys.type === 'initiative' ? 'initiative' : 'ability';
    default:
      return m?.flags?.dnd5e?.roll?.type ?? undefined;
  }
}

/** The item/spell behind a message (system.item, else the 5.x use → item flags). */
export function messageItemUuid(m: any): string | null {
  const sys = m?.system ?? {};
  return (
    sys.item?.uuid ??
    sys.item?.id ??
    m?.flags?.dnd5e?.use?.itemUuid ??
    m?.flags?.dnd5e?.item?.uuid ??
    m?.flags?.dnd5e?.item?.id ??
    null
  );
}

/** The originating message id (system.origin — a document or id — else the 5.x flag). */
export function messageOrigin(m: any): string | null {
  const raw = m?._source?.system?.origin ?? m?.system?.origin;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object' && typeof raw.id === 'string') return raw.id;
  return m?.flags?.dnd5e?.originatingMessage ?? null;
}

/**
 * Target descriptors normalized to the 5.x wire shape the fold reads: `uuid` = the target ACTOR's
 * uuid (a synthetic Scene…Token…Actor uuid for an unlinked token — identical to the 5.x value).
 */
export function messageTargets(
  m: any
): Array<{ uuid: string; name: string; ac: number | null; token?: string | undefined }> | null {
  const sys = m?.system?.targets;
  const raw: any[] | null = Array.isArray(sys)
    ? sys
    : Array.isArray(m?.flags?.dnd5e?.targets)
      ? m.flags.dnd5e.targets
      : null;
  if (!raw) return null;
  return raw.map((t: any) => ({
    uuid: t?.actor ?? t?.uuid ?? '',
    name: t?.name ?? '',
    ac: typeof t?.ac === 'number' ? t.ac : null,
    ...(typeof t?.token === 'string' ? { token: t.token } : {}),
  }));
}

export async function scanCombatStats(args: ScanCombatStatsArgs = {}) {
  const since = Number(args.since) || 0;
  const until = Number(args.until) || Number.POSITIVE_INFINITY;
  const uuids = new Set<string>();
  const stamped: any[] = [];
  const d20s: any[] = [];
  const rosterFlags: any[] = [];
  // Every family on a card in range that the scan does not fold, counted by key with why
  // (SKIPPED_FAMILIES, or a key this build does not know): the report says what it did not read.
  const skipped: Record<string, { n: number; why: string }> = {};

  for (const m of game.messages.contents) {
    if (m.timestamp < since || m.timestamp > until) continue;
    const bf = stampScope(m.flags);
    if (bf)
      for (const k of skippedFamilies(bf)) {
        skipped[k] ??= { n: 0, why: SKIPPED_FAMILIES[k] ?? 'not read by this build' };
        skipped[k].n++;
      }
    // combatRoster: the GM-whispered marker card — the turn→actor map that outlives deletion
    if (bf?.combatRoster) rosterFlags.push(JSON.parse(JSON.stringify(bf.combatRoster)));
    if (bf && BF_KEYS.some(k => bf[k])) {
      stamped.push({
        id: m.id,
        ts: m.timestamp,
        flags: JSON.parse(
          JSON.stringify(Object.fromEntries(BF_KEYS.filter(k => bf[k]).map(k => [k, bf[k]])))
        ),
        deltas: m.system?.deltas ? JSON.parse(JSON.stringify(m.system.deltas)) : null,
        speakerActor: m.speaker?.actor ?? null,
        itemUuid: messageItemUuid(m),
        // damage-roll totals by type off the receipt message's own rolls: PRE-mitigation
        rolls: (m.rolls ?? []).map((r: any) => ({ total: r.total, type: r.options?.type ?? null })),
        dnd5e: {
          targets: messageTargets(m),
          origin: messageOrigin(m),
        },
      });
    }
    // Buff margins, nat 20/1, advantage economy and death saves need the RAW d20 rolls — a
    // buff die rides the roll as its own term, on messages By the Books may never touch.
    const rollType = messageRollType(m);
    if (m.rolls?.length && rollType && D20_TYPES.has(rollType)) {
      const r = m.rolls[0];
      const d20 = r.terms?.find((t: any) => t.faces === 20 && t.results);
      d20s.push({
        id: m.id,
        ts: m.timestamp,
        rollType,
        total: r.total,
        actorUuid: m.speaker?.actor ? `Actor.${m.speaker.actor}` : null,
        speakerAlias: m.speaker?.alias ?? null,
        itemUuid: messageItemUuid(m),
        // rollCtx: By the Books' at-roll-time context stamp — {combat, sourceUuid}
        ctx: bf?.rollCtx ? JSON.parse(JSON.stringify(bf.rollCtx)) : null,
        // advantageMode: dnd5e's own -1 | 0 | 1; `all` keeps both dice for adv/dis outcomes
        adv: r.options?.advantageMode ?? null,
        d20: d20
          ? {
              result: d20.results.find((x: any) => x.active !== false)?.result ?? d20.total,
              all: d20.results.map((x: any) => x.result),
            }
          : null,
        bonusDice: (r.terms ?? [])
          .filter((t: any) => t.faces && t.faces !== 20 && t.results)
          .map((t: any) => ({ faces: t.faces, total: t.total })),
        targets: (messageTargets(m) ?? []).map(t => ({ uuid: t.uuid, name: t.name, ac: t.ac })),
      });
    }
  }

  // Name map for every uuid the ledger will speak about.
  for (const s of stamped) {
    const F = s.flags;
    if (F.receipt?.targets)
      for (const t of F.receipt.targets) {
        uuids.add(t.uuid);
        if (t.sourceUuid) uuids.add(t.sourceUuid);
      }
    if (F.effectReceipt?.targets)
      for (const t of F.effectReceipt.targets) {
        uuids.add(t.uuid);
        for (const e of t.effects ?? []) if (e.sourceUuid) uuids.add(e.sourceUuid);
      }
    for (const k of BF_KEYS) if (F[k]?.sourceUuid) uuids.add(F[k].sourceUuid);
  }
  for (const r of d20s) if (r.actorUuid) uuids.add(r.actorUuid);

  // Names come from TWO sources, wire first, live second. The wire records carry `name`
  // beside every target/combatant uuid, and those outlive deletion — an unlinked monster's
  // synthetic uuid (Scene…Token…Actor…) resolves via fromUuidSync only while its token still
  // exists, and defeated monsters get their tokens deleted (session-6 bug: the report printed
  // raw uuids). A live doc overwrites a wire name where it still resolves (renames win).
  const names: Record<string, string> = {};
  const learn = (u: unknown, n: unknown) => {
    if (typeof u === 'string' && u && typeof n === 'string' && n && !names[u]) names[u] = n;
  };
  for (const s of stamped) {
    const F = s.flags;
    for (const k of BF_KEYS) for (const t of F[k]?.targets ?? []) learn(t?.uuid, t?.name);
  }
  for (const r of d20s) for (const t of r.targets ?? []) learn(t.uuid, t.name);
  for (const rf of rosterFlags) for (const c of rf.combatants ?? []) learn(c?.actorUuid, c?.name);
  for (const c of game.combats.contents) for (const t of c.turns) learn(t.actor?.uuid, t.name);
  for (const u of uuids) {
    try {
      const doc = fromUuidSync(u);
      if (doc?.name) names[u] = doc.name;
    } catch {
      /* stale uuid — the wire name (if any) stands */
    }
  }

  // Rosters: the combatRoster marker flags are the durable source (they outlive deletion);
  // live encounters are archived too as belt-and-braces, without overwriting a flag's snapshot.
  const combats: Record<string, string> = {};
  const rosters: Record<string, unknown> = {};
  for (const rf of rosterFlags) {
    if (!rf.combatId) continue;
    rosters[rf.combatId] = rf;
    combats[rf.combatId] ??= rf.sceneName ?? rf.combatId;
  }
  for (const c of game.combats.contents) {
    // A roster flag's sceneName wins; a live encounter's own name fills in only when real —
    // an unnamed encounter returns '' and must not blank a better label.
    combats[c.id] = combats[c.id] || c.getName?.() || c.name || c.id;
    rosters[c.id] ??= {
      combatId: c.id,
      combatants: c.turns.map((t: any, i: number) => ({
        turn: i,
        actorUuid: t.actor?.uuid ?? null,
        name: t.name,
        initiative: t.initiative,
      })),
    };
  }

  return {
    world: game.world.id,
    scannedAt: Date.now(),
    stamped,
    d20s,
    names,
    combats,
    rosters,
    skipped,
    totalMessages: game.messages.size,
  };
}

/** The families on one message's stamps the scan does not fold (neither BF_KEYS nor read elsewhere). */
export function skippedFamilies(stamps: Record<string, any>): string[] {
  return Object.keys(stamps).filter(k => !BF_KEYS.includes(k) && !READ_ELSEWHERE.has(k));
}
