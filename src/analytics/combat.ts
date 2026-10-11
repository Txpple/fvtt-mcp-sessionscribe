/**
 * The combat analytics behind analyze-combat, ported VERBATIM from fvtt-mcp-dnd5e's
 * src/tools/combat-stats.ts (get-combat-stats, retired there by the 2026-09-23 break-out), and
 * grown here since: the 2026-09-01 / 2026-09-05 families (the gate's reminders, chips spent,
 * damage shields, the maneuver / cast / emanation moments).
 * Fold By the Books' (Battle Flow's until 3.0.0) stat-stamped chat messages into a per-combat
 * ledger and render the reports: damage dealt/taken, healing + overheal, verdict-flip credits, spend economy (pools
 * AND slots), buff-die (Bless) margins, and session flavor (nat 20s/1s, advantage economy,
 * death saves).
 *
 * The scan is page-side (src/page/combat-stats.ts, run by the reader child — read-only, one
 * sweep); everything below is plain Node over the returned JSON, exported pure so the unit
 * tests pin the arithmetic:
 * reverts subtracted (the module's ruling R-B), explicit-null combat = "out of combat" vs ABSENT
 * = pre-plane legacy (excluded but counted), healing as negative `taken` with
 * overheal = rolled − applied, synthetic token actors aggregated by archetype name.
 *
 * ALL output is GM-facing by default (a ruling, not a default to guess) — filtering happens at call
 * time via the sections/actor params, not by baked-in redaction.
 */

export const SECTIONS = [
  'damage',
  'healing',
  'flips',
  'spends',
  'moments',
  'bless',
  'flavor',
] as const;
export type Section = (typeof SECTIONS)[number];

/* --- the fold (pure, unit-tested) ----------------------------------------------------------- */

export interface ActorAgg {
  name: string;
  dealt: number;
  hits: number;
  taken: number;
  timesHit: number;
  healed: number;
  overheal: number;
  healReceived: number;
  effectsApplied: number;
  flips: number;
  tokens: string[] | number;
  folds: Array<{ kind: string; testKind: string; flipped: boolean; outcome: string }>;
  moments: Record<string, number>;
  pools: Record<string, { spent: number; max: number }>;
  slots: Record<string, { level: number | null; spent: number; max: number }>;
  slotLevels: number;
  /** accuracy, from rollCtx-stamped attack rolls: swings made / swings that met an AC */
  attacksMade: number;
  attacksHit: number;
  /** how many attack rolls chose this actor as a target (AC pressure) */
  targeted: number;
  /** save outcomes where this actor was the roller (demanded saves + concentration) */
  savesMade: number;
  savesFailed: number;
  /** damage DEALT by type, post-trait (from receipt parts) */
  damageByType: Record<string, number>;
  /** damage this actor's traits denied (resist/immune) or invited (vulnerable), vs the roll */
  mitigated: number;
  amplified: number;
  /** the gate's reminders on this actor's rolls (attacks, and saves / concentration checks): how
   *  many, the net they named, how many rolls went out the way the net said (honoured), the hits
   *  among the reminded attacks, and the saves made among the reminded saves with a known outcome */
  reminded: number;
  remindedHonoured: number;
  remindedNet: Record<string, number>;
  remindedAttacks: number;
  remindedHits: number;
  remindedSaves: number;
  remindedSavesJudged: number;
  remindedSavesMade: number;
  /** chips this attacker's swings used up (Sapped, Vexed …), by name */
  chips: Record<string, number>;
  chipsNotHonoured: number;
  /** this defender's damage shields that struck back. The damage itself is already in `dealt`
   *  (the ward's own receipt), so this only counts the strikes. */
  wards: Record<string, { n: number; total: number }>;
  /** clock riders that rode this attacker's hits (Dreadful Strike, Divine Strike …), by name.
   *  Their damage is already in `dealt`, through the receipt. */
  riders: Record<string, number>;
  /** Fighting Styles that CHANGED this attacker's damage rolls (By the Books' `fightingStyle`,
   *  2026-09-26), by name: how many rolls, and the damage the style ADDED (Great Weapon Fighting's
   *  raised dice, Thrown's and Dueling's +2, Two-Weapon's modifier). The damage itself is already
   *  in `dealt`, through the receipt; `gain` says how much of it the style was. */
  styles: Record<string, { n: number; gain: number }>;
  /** the auras this actor's emanations stood, each named once: the card is reposted every time
   *  the aura stands again, so a count would measure bookkeeping, not play */
  auras: string[];
}

export interface CombatLedger {
  combats: Record<string, { rounds: number; actors: Record<string, ActorAgg> }>;
  legacy: number;
  bless: Array<{
    kind: string;
    who: string;
    versus: string;
    total: number;
    threshold: number;
    bonus: number;
    dice: string;
    heuristic: boolean;
  }>;
  flavor: {
    nat20: Record<string, number>;
    nat1: Record<string, number>;
    adv: Record<string, number>;
    dis: Record<string, number>;
    death: Record<string, { made: number; failed: number }>;
  };
  /** decision latency under the clock: answeredAt vs the moment's own deadline/window */
  latency: Array<{ who: string; kind: string; ms: number }>;
}

/** What this target actually TOOK — `taken` when recorded, else the pool's own movement. */
export const takenOf = (e: any): number =>
  typeof e?.taken === 'number' ? e.taken : -((e?.delta?.value ?? 0) + (e?.delta?.temp ?? 0));

/** combat stamp "combatId:round:turn" → bucket. Explicit null → out-of-combat; ABSENT → legacy. */
export function bucketOf(rec: any): { key: string | null; round?: number; legacy: boolean } {
  if (!('combat' in (rec ?? {}))) return { key: null, legacy: true };
  if (rec.combat === null) return { key: 'out-of-combat', legacy: false };
  const [combatId, round] = String(rec.combat).split(':');
  return { key: combatId, round: Number(round), legacy: false };
}

export function foldCombatLedger(scan: any): CombatLedger {
  // Wire-carried names as the fallback layer: roster combatants and stamped targets record
  // `name` beside the uuid, and those outlive token deletion — a synthetic actor uuid
  // (Scene…Token…Actor…) stops resolving live once its token is gone, which left the scan's
  // names map sparse and the report printing raw uuids (session-6 bug). Without a name the
  // archetype KEY degrades to the uuid too, so ×N aggregation silently never merged.
  const wireNames: Record<string, string> = {};
  const learn = (u: unknown, n: unknown) => {
    if (typeof u === 'string' && u && typeof n === 'string' && n && !wireNames[u]) wireNames[u] = n;
  };
  for (const r of Object.values<any>(scan.rosters ?? {}))
    for (const c of r?.combatants ?? []) learn(c?.actorUuid, c?.name);
  for (const m of scan.stamped ?? []) {
    for (const f of Object.values<any>(m.flags ?? {}))
      for (const t of f?.targets ?? []) learn(t?.uuid, t?.name);
    // The 2026-09 families name their actors outside `targets`.
    const F = m.flags ?? {};
    for (const s of F.chipSpend?.spent ?? []) learn(s?.uuid, s?.bearer);
    learn(F.damageShield?.attackerUuid, F.damageShield?.attackerName);
    learn(F.damageShield?.sourceUuid, F.damageShield?.defenderName);
    learn(F.command?.attackerUuid, F.command?.attackerName);
    learn(F.command?.ally?.uuid, F.command?.ally?.name);
  }
  const name = (u: string | null | undefined) =>
    scan.names?.[u ?? ''] ?? wireNames[u ?? ''] ?? u ?? '(unattributed)';
  // Synthetic token actors (Scene…Token…Actor…) aggregate by NAME — the contract's own
  // guidance: THAT skeleton's uuid is deliberate in the stamp; the report wants the archetype.
  const keyOf = (uuid: string | null | undefined) => {
    if (!uuid) return '(unattributed)';
    return uuid.includes('.Token.') ? `archetype:${name(uuid)}` : uuid;
  };
  const combats: CombatLedger['combats'] = {};
  const tokenSets = new Map<ActorAgg, Set<string>>();
  // Rolls the gate reminded: the reminder rides the roll's own message (the d20 entry)
  const remindedIds = new Set<string>();
  let legacy = 0;

  const at = (bucket: string, uuid: string | null | undefined): ActorAgg => {
    combats[bucket] ??= { rounds: 0, actors: {} };
    const c = combats[bucket];
    const k = keyOf(uuid);
    let a = c.actors[k];
    if (!a) {
      a = c.actors[k] = {
        name: name(uuid),
        dealt: 0,
        hits: 0,
        taken: 0,
        timesHit: 0,
        healed: 0,
        overheal: 0,
        healReceived: 0,
        effectsApplied: 0,
        flips: 0,
        tokens: 0,
        folds: [],
        moments: {},
        pools: {},
        slots: {},
        slotLevels: 0,
        attacksMade: 0,
        attacksHit: 0,
        targeted: 0,
        savesMade: 0,
        savesFailed: 0,
        damageByType: {},
        mitigated: 0,
        amplified: 0,
        reminded: 0,
        remindedHonoured: 0,
        remindedNet: {},
        remindedAttacks: 0,
        remindedHits: 0,
        remindedSaves: 0,
        remindedSavesJudged: 0,
        remindedSavesMade: 0,
        chips: {},
        chipsNotHonoured: 0,
        wards: {},
        riders: {},
        styles: {},
        auras: [],
      };
      tokenSets.set(a, new Set());
    }
    if (uuid?.includes('.Token.')) tokenSets.get(a)!.add(uuid);
    return a;
  };
  const bump = (bucket: string, round: number | undefined) => {
    if (Number.isFinite(round)) {
      combats[bucket] ??= { rounds: 0, actors: {} };
      const c = combats[bucket];
      c.rounds = Math.max(c.rounds, round as number);
    }
  };

  for (const m of scan.stamped ?? []) {
    const F = m.flags ?? {};

    // Pre-mitigation side of the traits meter: the receipt message's own damage rolls, by type.
    const rollsByType: Record<string, number> = {};
    if (F.receipt) {
      for (const r of m.rolls ?? []) {
        if (r?.type) rollsByType[r.type] = (rollsByType[r.type] ?? 0) + (r.total ?? 0);
      }
    }
    for (const t of F.receipt?.targets ?? []) {
      const b = bucketOf(t);
      if (b.legacy) {
        legacy++;
        continue;
      }
      if (t.reverted) continue; // R-B: the table took it back
      bump(b.key!, b.round);
      const taken = takenOf(t);
      if (taken > 0) {
        const src = at(b.key!, t.sourceUuid);
        src.dealt += taken;
        src.hits++;
        const tgt = at(b.key!, t.uuid);
        tgt.taken += taken;
        tgt.timesHit++;
        // parts: [{type, amount}] POST-trait (second-pass field). Positive parts feed the
        // dealt-by-type meter; against the message rolls (pre-mitigation) they yield what the
        // target's traits denied (resist/immune, a modification) or invited (vulnerable).
        //
        // The entry's `multiplier` is the SAVE's (or a reaction's) halving, passed by By the
        // Books into calculateDamage, so the expected part without traits is roll × multiplier,
        // and the traits' share is what is left. The entry's `traits[]` label is NOT consulted:
        // dnd5e folds that same multiplier into the per-part `active.multiplier` that By the
        // Books reads the label from, so on a halved save "saved, no resistance" is labelled
        // resistant and "saved and resistant" (× 0.25) gets no label at all (session 8's dragon
        // breath, 2026-09-24: Gren 32 → 8 unlabelled, Morgash 32 → 16 "resistant"). The
        // arithmetic is right in both cases. Sub-point rounding noise is ignored.
        for (const p of t.parts ?? []) {
          if (p.amount > 0) src.damageByType[p.type] = (src.damageByType[p.type] ?? 0) + p.amount;
        }
        const mult = typeof t.multiplier === 'number' && t.multiplier > 0 ? t.multiplier : 1;
        for (const p of t.parts ?? []) {
          const pre = rollsByType[p.type];
          if (pre === undefined || p.amount < 0) continue;
          const diff = pre * mult - p.amount;
          if (diff >= 1) tgt.mitigated += diff;
          else if (diff <= -1) tgt.amplified += -diff;
        }
      } else if (taken < 0) {
        const rolled = -taken;
        const applied = Math.max(0, (t.delta?.value ?? 0) + (t.delta?.temp ?? 0));
        const src = at(b.key!, t.sourceUuid);
        src.healed += rolled;
        src.overheal += Math.max(0, rolled - applied);
        at(b.key!, t.uuid).healReceived += applied;
      }
    }

    for (const t of F.effectReceipt?.targets ?? []) {
      for (const e of t.effects ?? []) {
        const b = bucketOf(e);
        if (b.legacy) {
          legacy++;
          continue;
        }
        if (e.reverted) continue;
        bump(b.key!, b.round);
        at(b.key!, e.sourceUuid).effectsApplied++;
      }
    }

    if (F.spend) {
      const b = bucketOf(F.spend);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.spend.sourceUuid);
        for (const r of F.spend.rows ?? []) {
          a.pools[r.pool] ??= { spent: 0, max: r.max };
          a.pools[r.pool].spent += r.spent;
        }
        for (const s of F.spend.slots ?? []) {
          a.slots[s.slot] ??= { level: s.level ?? null, spent: 0, max: s.max };
          a.slots[s.slot].spent += s.spent;
          a.slotLevels += (s.level ?? 0) * s.spent;
        }
      }
    }

    if (F.d20fold) {
      const b = bucketOf(F.d20fold);
      if (b.legacy) legacy++;
      else if (F.d20fold.spends?.length) {
        bump(b.key!, b.round);
        const a = at(b.key!, F.d20fold.sourceUuid ?? F.d20fold.actorUuid);
        // A flip: the base total missed/failed and the folded verdict landed. Attacks carry
        // per-target margins (margin > 0 = base missed); checks/saves carry outcome only.
        const flipped = (F.d20fold.targets ?? []).filter(
          (t: any) => t.margin > 0 && ['hit', 'success', true].includes(t.verdict)
        ).length;
        a.folds.push({
          kind: F.d20fold.spends.map((s: any) => s.kind).join('+'),
          testKind: F.d20fold.testKind,
          flipped: flipped > 0,
          outcome: F.d20fold.outcome,
        });
        if (flipped) a.flips += flipped;
      }
    }

    for (const k of [
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
      // 2026-09-05, one per use: maneuvers, a ward raised, a bare damage cast, an emanation's
      // heal (its healing is already in the receipt) or its turn reminder
      'superiorityUse',
      'superiorityRide',
      'baitSwitch',
      'command',
      'shieldMark',
      'damageCast',
      'emanationHeal',
      'emanationRemind',
    ]) {
      if (!F[k]) continue;
      const b = bucketOf(F[k]);
      if (b.legacy) {
        legacy++;
        continue;
      }
      bump(b.key!, b.round);
      const a = at(b.key!, F[k].sourceUuid);
      // A ride is one record per damage roll, with one entry per superiority die that rode it.
      const n = k === 'superiorityRide' ? Math.max(1, F[k].rode?.length ?? 0) : 1;
      a.moments[k] = (a.moments[k] ?? 0) + n;
    }

    // The gate's reminder, stamped on the roll it met: an attack, or a save / concentration check
    // (the contract table says attacks only; the live log has both). It records the net it named
    // (advantage / disadvantage / normal) and whether the roll went out that way.
    if (F.reminder) {
      const b = bucketOf(F.reminder);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.reminder.sourceUuid);
        a.reminded++;
        if (F.reminder.honoured) a.remindedHonoured++;
        const net = F.reminder.net ?? 'normal';
        a.remindedNet[net] = (a.remindedNet[net] ?? 0) + 1;
        remindedIds.add(m.id);
      }
    }

    // Chips an attack used up. `honoured` says whether the roll carried the chip's bend.
    if (F.chipSpend) {
      const b = bucketOf(F.chipSpend);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.chipSpend.sourceUuid);
        for (const s of F.chipSpend.spent ?? []) {
          const chip = s?.name ?? s?.key ?? 'chip';
          a.chips[chip] = (a.chips[chip] ?? 0) + 1;
          if (s?.honoured === false) a.chipsNotHonoured++;
        }
      }
    }

    // A damage shield striking back, credited to the defender. Only a rolled strike counts:
    // `rolled: false` is the card saying the dice could not be read, and no damage followed.
    if (F.damageShield?.rolled) {
      const b = bucketOf(F.damageShield);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.damageShield.sourceUuid);
        const ward = F.damageShield.key ?? F.damageShield.effectName ?? 'ward';
        a.wards[ward] ??= { n: 0, total: 0 };
        a.wards[ward].n++;
        a.wards[ward].total += Number(F.damageShield.total) || 0;
      }
    }

    // Clock riders on a damage message, one entry per feature that rode the hit
    if (F.clockRiders) {
      const b = bucketOf(F.clockRiders);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.clockRiders.sourceUuid);
        for (const d of F.clockRiders.riders ?? []) {
          const rider = d?.label ?? d?.key ?? 'rider';
          a.riders[rider] = (a.riders[rider] ?? 0) + 1;
        }
      }
    }

    // A Fighting Style's number on a damage roll, per style that changed it (an `off` entry adds 0)
    if (F.fightingStyle) {
      const b = bucketOf(F.fightingStyle);
      if (b.legacy) legacy++;
      else {
        bump(b.key!, b.round);
        const a = at(b.key!, F.fightingStyle.sourceUuid);
        for (const st of F.fightingStyle.styles ?? []) {
          const gain = Number(st?.gain) || 0;
          if (gain <= 0) continue;
          const style = st?.feature ?? st?.key ?? 'style';
          a.styles[style] ??= { n: 0, gain: 0 };
          a.styles[style].n++;
          a.styles[style].gain += gain;
        }
      }
    }

    // An aura's card: named once per bucket, never counted (see ActorAgg.auras)
    if (F.emanationCard) {
      const b = bucketOf(F.emanationCard);
      if (b.legacy) legacy++;
      else {
        const a = at(b.key!, F.emanationCard.sourceUuid);
        const aura = F.emanationCard.key ?? 'aura';
        if (!a.auras.includes(aura)) a.auras.push(aura);
      }
    }

    // Save outcomes, roller-side: the saves flag's per-target outcomes and the concentration
    // flag's own outcome — exact records, no roll parsing needed.
    if (F.saves) {
      const b = bucketOf(F.saves);
      if (!b.legacy) {
        for (const t of F.saves.targets ?? []) {
          if (t.outcome !== 'saved' && t.outcome !== 'failed') continue;
          const a = at(b.key!, t.uuid);
          if (t.outcome === 'saved') a.savesMade++;
          else a.savesFailed++;
        }
      }
    }
    if (F.concentration?.outcome && typeof F.concentration.outcome.success === 'boolean') {
      const b = bucketOf(F.concentration);
      if (!b.legacy) {
        const a = at(b.key!, F.concentration.actorUuid ?? F.concentration.sourceUuid);
        if (F.concentration.outcome.success) a.savesMade++;
        else a.savesFailed++;
      }
    }
  }

  const flavor: CombatLedger['flavor'] = { nat20: {}, nat1: {}, adv: {}, dis: {}, death: {} };

  // Decision latency: every moment answer carries `answeredAt` (second-pass field), and timed
  // moments carry `deadline` (epoch-ms) + `window` (seconds) — the clock started at
  // deadline − window·1000, so the latency is arithmetic. Locations vary by family (the flag,
  // its outcome, its per-target entries); discovered defensively, clamped to sane values.
  const latency: CombatLedger['latency'] = [];
  const nameOfUuid = name;
  for (const m of scan.stamped ?? []) {
    for (const [kind, f] of Object.entries<any>(m.flags ?? {})) {
      if (!f || typeof f !== 'object') continue;
      const window = Number(f.window);
      const deadline = Number(f.deadline);
      if (!Number.isFinite(window) || !Number.isFinite(deadline) || window <= 0) continue;
      const start = deadline - window * 1000;
      const answers: Array<{ at: number; who: string }> = [];
      const flagWho = nameOfUuid(f.actorUuid ?? f.sourceUuid);
      if (Number.isFinite(f.answeredAt)) answers.push({ at: f.answeredAt, who: flagWho });
      if (Number.isFinite(f.outcome?.answeredAt))
        answers.push({ at: f.outcome.answeredAt, who: flagWho });
      if (Number.isFinite(f.answer?.answeredAt))
        answers.push({ at: f.answer.answeredAt, who: flagWho });
      for (const t of f.targets ?? []) {
        if (Number.isFinite(t?.answeredAt))
          answers.push({ at: t.answeredAt, who: nameOfUuid(t.uuid) });
      }
      for (const { at: answeredAt, who } of answers) {
        const ms = answeredAt - start;
        if (ms >= 0 && ms <= 10 * 60_000) latency.push({ who, kind, ms });
      }
    }
  }

  // Buff-die (Bless-style) margins. Bonus-die attribution is exact where the roll's own terms
  // parse; a same-size overlap (two 1d4 buffs) is labeled heuristic — never silent. Save-side
  // thresholds join EXACTLY: the concentration and saves flags both record the rollMessageId
  // of the answering roll, so the demand's DC and the roll's bonus dice meet on the message id
  // (actor+time proximity only as fallback for records predating the id). Ties succeed in 5e,
  // so `< dc` is the honest flip test.
  const demandByRoll = new Map<
    string,
    { dc: number; kind: string; label: string; nearMatched?: boolean }
  >();
  const concDemands: Array<{ ts: number; actorUuid: string; dc: number; label: string }> = [];
  // A save's outcome by the id of the roll that answered it (saved / kept = true)
  const saveOutcomeByRoll = new Map<string, boolean>();
  for (const m of scan.stamped ?? []) {
    const c = m.flags?.concentration;
    if (c?.outcome?.rollMessageId && typeof c.outcome.success === 'boolean')
      saveOutcomeByRoll.set(c.outcome.rollMessageId, c.outcome.success);
    for (const t of m.flags?.saves?.targets ?? [])
      if (t?.rollMessageId && (t.outcome === 'saved' || t.outcome === 'failed'))
        saveOutcomeByRoll.set(t.rollMessageId, t.outcome === 'saved');
    if (c?.dc != null) {
      const label = `DC ${c.dc} concentration${c.names?.length ? ` (kept ${c.names.join(', ')})` : ''}`;
      concDemands.push({ ts: m.ts, actorUuid: c.actorUuid, dc: c.dc, label });
      if (c.outcome?.rollMessageId)
        demandByRoll.set(c.outcome.rollMessageId, { dc: c.dc, kind: 'concentration', label });
    }
    const s = m.flags?.saves;
    if (s?.dc != null)
      for (const t of s.targets ?? []) {
        if (t.rollMessageId)
          demandByRoll.set(t.rollMessageId, {
            dc: s.dc,
            kind: 'save',
            label: `DC ${s.dc} ${s.item?.name ?? 'save'}`,
          });
      }
  }
  const bless: CombatLedger['bless'] = [];
  for (const r of scan.d20s ?? []) {
    const who =
      scan.names?.[r.actorUuid ?? ''] ??
      wireNames[r.actorUuid ?? ''] ??
      r.speakerAlias ??
      r.actorUuid;
    if (r.rollType === 'death') {
      flavor.death[who] ??= { made: 0, failed: 0 };
      const t = flavor.death[who];
      if (r.d20?.result === 20 || r.total >= 10) t.made++;
      else t.failed++;
      continue;
    }
    // A reminded save or concentration check: made or not, where its demand recorded the outcome
    if (
      (r.rollType === 'save' || r.rollType === 'concentration') &&
      r.ctx &&
      remindedIds.has(r.id)
    ) {
      const b = bucketOf(r.ctx);
      if (!b.legacy) {
        const a = at(b.key!, r.ctx.sourceUuid ?? r.actorUuid);
        a.remindedSaves++;
        const made = saveOutcomeByRoll.get(r.id);
        if (made !== undefined) {
          a.remindedSavesJudged++;
          if (made) a.remindedSavesMade++;
        }
      }
    }
    if (r.d20?.result === 20) flavor.nat20[who] = (flavor.nat20[who] ?? 0) + 1;
    if (r.d20?.result === 1) flavor.nat1[who] = (flavor.nat1[who] ?? 0) + 1;
    if (r.adv === 1) flavor.adv[who] = (flavor.adv[who] ?? 0) + 1;
    if (r.adv === -1) flavor.dis[who] = (flavor.dis[who] ?? 0) + 1;
    // Accuracy + AC pressure, from rollCtx-stamped attack rolls: the stamp gives the honest
    // combat bucket; a roll with no stamp (pre-plane) stays out rather than being inferred.
    if (r.rollType === 'attack' && r.ctx) {
      const b = bucketOf(r.ctx);
      if (!b.legacy) {
        bump(b.key!, b.round);
        const src = at(b.key!, r.ctx.sourceUuid ?? r.actorUuid);
        const judged = (r.targets ?? []).filter((t: any) => t.ac != null);
        const hit = judged.some((t: any) => r.total >= t.ac);
        src.attacksMade++;
        if (hit) src.attacksHit++;
        if (remindedIds.has(r.id)) {
          src.remindedAttacks++;
          if (hit) src.remindedHits++;
        }
        for (const t of r.targets ?? []) at(b.key!, t.uuid).targeted++;
      }
    }
    if (!r.bonusDice?.length) continue;
    const bonus = r.bonusDice.reduce((s: number, d: any) => s + d.total, 0);
    const dice = r.bonusDice.map((d: any) => `d${d.faces}=${d.total}`).join('+');
    const heuristic = r.bonusDice.length > 1;
    if (r.rollType === 'attack') {
      for (const t of r.targets ?? []) {
        if (t.ac == null) continue;
        if (r.total >= t.ac && r.total - bonus < t.ac) {
          bless.push({
            kind: 'attack',
            who,
            versus: `${t.name} (AC ${t.ac})`,
            total: r.total,
            threshold: t.ac,
            bonus,
            dice,
            heuristic,
          });
        }
      }
    } else if (r.rollType === 'save') {
      let d = demandByRoll.get(r.id);
      if (!d) {
        const near = concDemands
          .filter(c => c.actorUuid === r.actorUuid && Math.abs(c.ts - r.ts) < 120_000)
          .sort((a, b) => Math.abs(a.ts - r.ts) - Math.abs(b.ts - r.ts))[0];
        if (near) d = { dc: near.dc, kind: 'concentration', label: near.label, nearMatched: true };
      }
      if (d && r.total >= d.dc && r.total - bonus < d.dc) {
        bless.push({
          kind: d.kind,
          who,
          versus: d.label,
          total: r.total,
          threshold: d.dc,
          bonus,
          dice,
          heuristic: heuristic || Boolean(d.nearMatched),
        });
      }
    }
  }

  for (const c of Object.values(combats)) {
    for (const a of Object.values(c.actors)) {
      const set = tokenSets.get(a);
      const n = set?.size ?? 0;
      if (n > 1) a.name = `${a.name} (×${n})`;
      a.tokens = n; // Sets don't serialize; the count does
    }
  }
  return { combats, legacy, bless, flavor, latency };
}

/* --- the report (pure) ---------------------------------------------------------------------- */

export interface RenderOptions {
  combat?: string | undefined;
  sections?: readonly Section[] | undefined;
  actor?: string | undefined;
}

export function renderCombatReport(
  scan: any,
  ledger: CombatLedger,
  opts: RenderOptions = {}
): string {
  const on = (s: Section) => !opts.sections || opts.sections.includes(s);
  const nameOk = (n: string) => !opts.actor || n.toLowerCase().includes(opts.actor.toLowerCase());
  const lines: string[] = [];
  const P = (s: string) => lines.push(s);

  P(
    `**COMBAT STATS** — world "${scan.world}", ${scan.stamped?.length ?? 0} stamped messages` +
      ` (of ${scan.totalMessages ?? '?'} total), scanned ${new Date(scan.scannedAt).toISOString()}`
  );
  if (ledger.legacy)
    P(`_(${ledger.legacy} pre-plane legacy records excluded — the ledger starts 2026-08-27)_`);

  for (const [key, c] of Object.entries(ledger.combats)) {
    if (opts.combat && key !== opts.combat) continue;
    const roster = scan.rosters?.[key];
    const title =
      key === 'out-of-combat'
        ? 'OUT OF COMBAT'
        : `COMBAT ${scan.combats?.[key] ?? `${key} (encounter since deleted)`}` +
          `${c.rounds ? ` — ${c.rounds} round${c.rounds > 1 ? 's' : ''}` : ''}` +
          `${roster?.endedRound ? ` (ended round ${roster.endedRound})` : ''}`;
    P(`\n## ${title}`);
    const rows = Object.values(c.actors)
      .filter(a => nameOk(a.name))
      .sort((a, b) => b.dealt - a.dealt);
    for (const a of rows) {
      const bits: string[] = [];
      if (on('damage') && a.dealt)
        bits.push(
          `dealt ${a.dealt}${c.rounds ? ` (${(a.dealt / c.rounds).toFixed(1)}/rd)` : ''} in ${a.hits} hit${a.hits > 1 ? 's' : ''}`
        );
      if (on('damage') && a.attacksMade)
        bits.push(
          `accuracy ${a.attacksHit}/${a.attacksMade} (${Math.round((100 * a.attacksHit) / a.attacksMade)}%)`
        );
      if (on('damage')) {
        const types = Object.entries(a.damageByType)
          .sort((x, y) => y[1] - x[1])
          .map(([t, n]) => `${t} ${Math.round(n)}`)
          .join(', ');
        if (types) bits.push(`by type: ${types}`);
      }
      if (on('damage') && a.taken) bits.push(`took ${a.taken} over ${a.timesHit}`);
      if (on('damage') && a.targeted) bits.push(`targeted ${a.targeted}×`);
      if (on('damage') && (a.mitigated || a.amplified)) {
        const tr: string[] = [];
        if (a.mitigated) tr.push(`traits denied ${Math.round(a.mitigated)}`);
        if (a.amplified) tr.push(`vulnerability invited ${Math.round(a.amplified)}`);
        bits.push(tr.join(', '));
      }
      if (on('moments') && (a.savesMade || a.savesFailed))
        bits.push(`saves ${a.savesMade}/${a.savesMade + a.savesFailed}`);
      if (on('healing') && a.healed)
        bits.push(`healed ${a.healed}${a.overheal ? ` (${a.overheal} overheal)` : ''}`);
      if (on('healing') && a.healReceived) bits.push(`received ${a.healReceived} healing`);
      if (on('moments') && a.effectsApplied)
        bits.push(`applied ${a.effectsApplied} effect${a.effectsApplied > 1 ? 's' : ''}`);
      if (on('flips') && a.flips) bits.push(`FLIPPED ${a.flips} verdict${a.flips > 1 ? 's' : ''}`);
      if (on('flips') && a.folds.length)
        bits.push(`folds spent: ${a.folds.map(f => `${f.kind} (${f.testKind})`).join(', ')}`);
      if (on('moments')) {
        const moments = Object.entries(a.moments)
          .map(([k, n]) => `${k}×${n}`)
          .join(', ');
        if (moments) bits.push(moments);
      }
      if (on('moments') && a.reminded) {
        const why = [
          Object.entries(a.remindedNet)
            .sort((x, y) => y[1] - x[1])
            .map(([net, n]) => `${net === 'normal' ? 'flat' : net} ${n}`)
            .join(', '),
        ];
        const against = a.reminded - a.remindedHonoured;
        if (against) why.push(`${against} rolled against the net`);
        if (a.remindedAttacks) why.push(`attacks hit ${a.remindedHits}/${a.remindedAttacks}`);
        if (a.remindedSavesJudged)
          why.push(`saves made ${a.remindedSavesMade}/${a.remindedSavesJudged}`);
        else if (a.remindedSaves) why.push(`${a.remindedSaves} on saves`);
        bits.push(`reminded ${a.reminded}× (${why.join('; ')})`);
      }
      if (on('moments')) {
        const chips = Object.entries(a.chips)
          .map(([c, n]) => `${c} ×${n}`)
          .join(', ');
        if (chips)
          bits.push(
            `chips spent: ${chips}${a.chipsNotHonoured ? ` (${a.chipsNotHonoured} not honoured)` : ''}`
          );
        const wards = Object.entries(a.wards)
          .map(([w, v]) => `${w} ×${v.n} (${v.total} dmg)`)
          .join(', ');
        if (wards) bits.push(`wards struck: ${wards}`);
        const riders = Object.entries(a.riders)
          .map(([r, n]) => `${r} ×${n}`)
          .join(', ');
        if (riders) bits.push(`riders: ${riders}`);
        const styles = Object.entries(a.styles)
          .map(([st, v]) => `${st} ×${v.n} (+${v.gain} dmg)`)
          .join(', ');
        if (styles) bits.push(`fighting styles: ${styles}`);
        if (a.auras.length) bits.push(`auras: ${a.auras.join(', ')}`);
      }
      if (on('spends')) {
        const pools = Object.entries(a.pools)
          .map(([p, v]) => `${p} ${v.spent}/${v.max}`)
          .join(', ');
        const slots = Object.entries(a.slots)
          .map(([s, v]) => `${s} ×${v.spent}`)
          .join(', ');
        if (pools) bits.push(`pools: ${pools}`);
        if (slots)
          bits.push(`slots: ${slots}${a.slotLevels ? ` (${a.slotLevels} levels burned)` : ''}`);
      }
      if (bits.length) P(`- **${a.name}**: ${bits.join(' · ')}`);
    }
  }

  if (on('bless') && ledger.bless.length) {
    P(`\n## BUFF-DIE FLIPS (Bless-style)`);
    for (const b of ledger.bless.filter(b => nameOk(b.who)))
      P(
        `- ${b.who} vs ${b.versus}: rolled ${b.total} — the +${b.bonus} (${b.dice}) flipped the ` +
          `${b.kind === 'attack' ? 'miss into a hit' : 'failure into a success'}` +
          `${b.heuristic ? ' _[heuristic: overlapping dice]_' : ''}`
      );
  }

  if (on('flavor')) {
    const F = ledger.flavor;
    const rows: string[] = [];
    for (const [who, n] of Object.entries(F.nat20))
      if (nameOk(who)) rows.push(`- ${who}: ${n} natural 20${n > 1 ? 's' : ''}`);
    for (const [who, n] of Object.entries(F.nat1))
      if (nameOk(who)) rows.push(`- ${who}: ${n} natural 1${n > 1 ? 's' : ''}`);
    for (const [who, d] of Object.entries(F.death))
      if (nameOk(who)) rows.push(`- ${who}: death saves ${d.made} made / ${d.failed} failed`);
    const adv = Object.entries(F.adv)
      .filter(([w]) => nameOk(w))
      .map(([w, n]) => `${w} ×${n}`)
      .join(', ');
    const dis = Object.entries(F.dis)
      .filter(([w]) => nameOk(w))
      .map(([w, n]) => `${w} ×${n}`)
      .join(', ');
    if (adv) rows.push(`- advantage rolled: ${adv}`);
    if (dis) rows.push(`- disadvantage rolled: ${dis}`);
    // decision latency under the clock (answeredAt vs the moment's deadline/window)
    const byWho = new Map<string, { total: number; n: number; worst: number; worstKind: string }>();
    for (const l of ledger.latency) {
      if (!nameOk(l.who)) continue;
      let e = byWho.get(l.who);
      if (!e) {
        e = { total: 0, n: 0, worst: 0, worstKind: '' };
        byWho.set(l.who, e);
      }
      e.total += l.ms;
      e.n++;
      if (l.ms > e.worst) {
        e.worst = l.ms;
        e.worstKind = l.kind;
      }
    }
    for (const [who, e] of byWho)
      rows.push(
        `- ${who}: avg decision ${(e.total / e.n / 1000).toFixed(1)}s over ${e.n} timed moment${e.n > 1 ? 's' : ''}` +
          ` (slowest ${(e.worst / 1000).toFixed(1)}s on ${e.worstKind})`
      );
    if (rows.length) {
      P(`\n## SESSION FLAVOR`);
      lines.push(...rows);
    }
  }
  return lines.join('\n');
}
