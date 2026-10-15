import { describe, it, expect } from 'vitest';
import { bucketOf, foldCombatLedger, renderCombatReport, takenOf } from './combat.js';

/**
 * Ported from fvtt-mcp-dnd5e src/tools/combat-stats.test.ts; only the PC names are changed
 * (synthetic ones: no campaign facts in this repo) and the MCP handler block is replaced by
 * src/tools/analyze-combat.test.ts.
 *
 * Fold pins against the By the Books (formerly Battle Flow) §4 wire format. The fixture mirrors shapes VERIFIED against
 * the live sandbox battle of 2026-08-27 (scan dump), not just the docs: receipt entries
 * (prior/delta/taken/reverted/combat/sourceUuid), effectReceipt records, spend rows/slots,
 * d20fold spends+targets, saves/concentration rollMessageId joins.
 */

const SYNTH = (tok: string, act: string) => `Scene.S1.Token.${tok}.Actor.${act}`;

function fixtureScan() {
  return {
    world: 'test',
    scannedAt: 1756300000000,
    totalMessages: 20,
    combats: { C1: 'Temple Fight' },
    rosters: {
      C1: {
        combatId: 'C1',
        sceneName: 'Temple Fight',
        endedRound: 3,
        combatants: [
          { actorUuid: 'Actor.A', tokenId: 'tokA', name: 'Aldric', initiative: 18, isPC: true },
        ],
      },
    },
    names: {
      'Actor.A': 'Aldric',
      'Actor.B': 'Brenna',
      [SYNTH('t1', 'g1')]: 'Goblin',
      [SYNTH('t2', 'g2')]: 'Goblin',
    },
    stamped: [
      {
        id: 'm1',
        ts: 1,
        flags: {
          receipt: {
            targets: [
              // damage: 7 dealt by Aldric to goblin token 1
              {
                uuid: SYNTH('t1', 'g1'),
                name: 'Goblin',
                prior: { value: 10, temp: 0 },
                delta: { value: -7, temp: 0 },
                taken: 7,
                traits: [],
                reverted: false,
                combat: 'C1:2:0',
                sourceUuid: 'Actor.A',
              },
              // damage to goblin token 2 (second archetype token)
              {
                uuid: SYNTH('t2', 'g2'),
                name: 'Goblin',
                prior: { value: 3, temp: 0 },
                delta: { value: -3, temp: 0 },
                taken: 5,
                traits: [],
                reverted: false,
                combat: 'C1:3:1',
                sourceUuid: 'Actor.B',
              },
              // REVERTED — must not count (R-B)
              {
                uuid: SYNTH('t2', 'g2'),
                name: 'Goblin',
                prior: { value: 3, temp: 0 },
                delta: { value: -3, temp: 0 },
                taken: 9,
                traits: [],
                reverted: true,
                combat: 'C1:3:1',
                sourceUuid: 'Actor.B',
              },
            ],
          },
        },
      },
      {
        id: 'm2',
        ts: 2,
        flags: {
          receipt: {
            targets: [
              // healing: rolled 9, pool moved +6 (clamped) → 3 overheal
              {
                uuid: 'Actor.A',
                name: 'Aldric',
                prior: { value: 5, temp: 0 },
                delta: { value: 6, temp: 0 },
                taken: -9,
                note: 'Healing',
                traits: [],
                reverted: false,
                combat: 'C1:3:2',
                sourceUuid: 'Actor.B',
              },
            ],
          },
        },
      },
      {
        id: 'm3',
        ts: 3,
        flags: {
          spend: {
            combat: 'C1:2:0',
            sourceUuid: 'Actor.B',
            rows: [{ pool: 'Second Wind', spent: 1, left: 0, max: 1 }],
            slots: [{ slot: 'spell2', level: 2, spent: 1, left: 1, max: 2 }],
          },
        },
      },
      {
        id: 'm4',
        ts: 4,
        flags: {
          d20fold: {
            testKind: 'attack',
            actorUuid: 'Actor.A',
            baseTotal: 14,
            outcome: 'used',
            spends: [{ kind: 'bardic', name: 'Inspired', die: 4 }],
            targets: [
              { uuid: SYNTH('t1', 'g1'), name: 'Goblin', ac: 16, margin: 2, verdict: 'hit' },
            ],
            combat: 'C1:2:0',
            sourceUuid: 'Actor.A',
          },
        },
      },
      {
        id: 'm5',
        ts: 5,
        flags: {
          // LEGACY: no combat/sourceUuid fields at all — excluded but counted
          receipt: {
            targets: [
              {
                uuid: 'Actor.A',
                name: 'Aldric',
                prior: { value: 9, temp: 0 },
                delta: { value: -4, temp: 0 },
                taken: 4,
                traits: [],
              },
            ],
          },
        },
      },
      {
        id: 'm6',
        ts: 6,
        flags: {
          concentration: {
            actorUuid: 'Actor.A',
            dc: 10,
            names: ['Bless'],
            combat: 'C1:2:1',
            sourceUuid: 'Actor.A',
            outcome: { total: 14, success: true, rollMessageId: 'r-conc' },
          },
        },
      },
      {
        id: 'm7',
        ts: 7,
        flags: {
          saves: {
            dc: 15,
            item: { name: 'Hold Person' },
            combat: 'C1:2:2',
            sourceUuid: 'Actor.B',
            targets: [
              {
                uuid: SYNTH('t1', 'g1'),
                name: 'Goblin',
                outcome: 'saved',
                total: 16,
                rollMessageId: 'r-save',
              },
            ],
          },
        },
      },
      {
        id: 'm8',
        ts: 8,
        flags: {
          effectReceipt: {
            targets: [
              {
                uuid: SYNTH('t1', 'g1'),
                name: 'Goblin',
                effects: [
                  {
                    id: 'e1',
                    name: 'Bless',
                    reverted: false,
                    combat: 'C1:2:0',
                    sourceUuid: 'Actor.B',
                  },
                  {
                    id: 'e2',
                    name: 'Hex',
                    reverted: true,
                    combat: 'C1:2:0',
                    sourceUuid: 'Actor.B',
                  },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'm9',
        ts: 9,
        // out-of-combat by CONTRACT: explicit null — its own bucket, never dropped
        flags: {
          receipt: {
            targets: [
              {
                uuid: 'Actor.B',
                name: 'Brenna',
                prior: { value: 10, temp: 0 },
                delta: { value: -2, temp: 0 },
                taken: 2,
                traits: [],
                reverted: false,
                combat: null,
                sourceUuid: null,
              },
            ],
          },
        },
      },
      {
        id: 'm10',
        ts: 10,
        // second-pass fields: parts vs the message's own pre-mitigation rolls, on a hit the
        // targets SAVED against (multiplier 0.5, Battle Flow's save halving). The expected part
        // without traits is roll × multiplier; what is missing beyond that is the traits' share.
        // The entry's traits[] label is ignored: dnd5e folds the save into the per-part
        // multiplier Battle Flow labels from, so Aldric (saved AND resistant, necrotic 9 → 2.25)
        // arrives unlabelled and Cass (saved only, 9 → 4.5) arrives labelled "resistant".
        rolls: [
          { total: 9, type: 'necrotic' },
          { total: 4, type: 'fire' },
        ],
        flags: {
          receipt: {
            targets: [
              {
                uuid: 'Actor.A',
                name: 'Aldric',
                prior: { value: 20, temp: 0 },
                delta: { value: -4, temp: 0 },
                taken: 4.25,
                multiplier: 0.5,
                traits: [],
                parts: [
                  { type: 'necrotic', amount: 2.25 },
                  { type: 'fire', amount: 2 },
                ],
                reverted: false,
                combat: 'C1:3:3',
                sourceUuid: SYNTH('t1', 'g1'),
              },
              {
                uuid: 'Actor.C',
                name: 'Cass',
                prior: { value: 20, temp: 0 },
                delta: { value: -6, temp: 0 },
                taken: 6.5,
                multiplier: 0.5,
                traits: [{ type: 'necrotic', outcome: 'resistant' }],
                parts: [
                  { type: 'necrotic', amount: 4.5 },
                  { type: 'fire', amount: 2 },
                ],
                reverted: false,
                combat: 'C1:3:3',
                sourceUuid: SYNTH('t1', 'g1'),
              },
            ],
          },
        },
      },
      {
        id: 'm11',
        ts: 11,
        // holdSkipped: the futile-skip record — a moment tally, source = the attacker
        flags: {
          holdSkipped: {
            targets: [{ uuid: 'Actor.A', name: 'Aldric', reaction: 'Shield' }],
            combat: 'C1:3:4',
            sourceUuid: SYNTH('t1', 'g1'),
          },
        },
      },
      {
        id: 'm12',
        ts: 12,
        // answeredAt + deadline/window → decision latency (clock started deadline − window·1000)
        flags: {
          bashOffer: {
            combat: 'C1:3:5',
            sourceUuid: 'Actor.B',
            window: 24,
            deadline: 1000_000 + 24_000,
            answeredAt: 1000_000 + 6_000,
          },
        },
      },
    ],
    d20s: [
      // conc save: 14 total with +5 of bonus dice vs DC 10 → EXACT join by rollMessageId, flip
      {
        id: 'r-conc',
        ts: 6,
        rollType: 'save',
        total: 14,
        actorUuid: 'Actor.A',
        speakerAlias: 'Aldric',
        adv: 0,
        d20: { result: 3, all: [3] },
        bonusDice: [
          { faces: 4, total: 2 },
          { faces: 4, total: 3 },
        ],
        targets: [],
      },
      // demanded save: 16 vs DC 15 with +2 bonus → exact join via saves flag, flip
      {
        id: 'r-save',
        ts: 7,
        rollType: 'save',
        total: 16,
        actorUuid: SYNTH('t1', 'g1'),
        speakerAlias: 'Goblin',
        adv: 0,
        d20: { result: 9, all: [9] },
        bonusDice: [{ faces: 4, total: 2 }],
        targets: [],
      },
      // attack that hits only thanks to the bonus die
      {
        id: 'r-atk',
        ts: 8,
        rollType: 'attack',
        ctx: { combat: 'C1:2:3', sourceUuid: 'Actor.A' },
        total: 17,
        actorUuid: 'Actor.A',
        speakerAlias: 'Aldric',
        adv: 1,
        d20: { result: 14, all: [14, 6] },
        bonusDice: [{ faces: 4, total: 3 }],
        targets: [{ uuid: SYNTH('t1', 'g1'), name: 'Goblin', ac: 16 }],
      },
      // nat 20 with disadvantage, no bonus dice
      {
        id: 'r-n20',
        ts: 9,
        rollType: 'attack',
        total: 25,
        actorUuid: 'Actor.B',
        speakerAlias: 'Brenna',
        adv: -1,
        d20: { result: 20, all: [20, 4] },
        bonusDice: [],
        targets: [],
      },
      // death saves: one made, one failed
      {
        id: 'r-d1',
        ts: 10,
        rollType: 'death',
        total: 12,
        actorUuid: 'Actor.A',
        speakerAlias: 'Aldric',
        adv: 0,
        d20: { result: 12, all: [12] },
        bonusDice: [],
        targets: [],
      },
      {
        id: 'r-d2',
        ts: 11,
        rollType: 'death',
        total: 4,
        actorUuid: 'Actor.A',
        speakerAlias: 'Aldric',
        adv: 0,
        d20: { result: 4, all: [4] },
        bonusDice: [],
        targets: [],
      },
    ],
  };
}

describe('bucketOf / takenOf (contract primitives)', () => {
  it('tells explicit-null (out of combat) from ABSENT (legacy)', () => {
    expect(bucketOf({ combat: null })).toEqual({ key: 'out-of-combat', legacy: false });
    expect(bucketOf({})).toEqual({ key: null, legacy: true });
    expect(bucketOf({ combat: 'C1:4:2' })).toMatchObject({ key: 'C1', round: 4, legacy: false });
  });

  it('takenOf prefers the recorded taken; falls back to the pool movement', () => {
    expect(takenOf({ taken: 14, delta: { value: 0, temp: 0 } })).toBe(14); // 0-HP clamp case
    expect(takenOf({ delta: { value: -5, temp: -2 } })).toBe(7); // pre-field legacy entry
  });
});

describe('foldCombatLedger', () => {
  const ledger = foldCombatLedger(fixtureScan());
  const c1 = ledger.combats.C1;
  const actors = c1.actors;

  it('subtracts reverted applications (R-B) and counts legacy separately', () => {
    // Goblin took 7 + 5 — the reverted 9 must NOT count
    expect(actors['archetype:Goblin'].taken).toBe(12);
    expect(ledger.legacy).toBe(1);
  });

  it('aggregates synthetic token actors by archetype with a token count', () => {
    expect(actors['archetype:Goblin'].name).toBe('Goblin (×2)');
    expect(actors['archetype:Goblin'].tokens).toBe(2);
  });

  it('splits healing into rolled / overheal / received-applied', () => {
    const brenna = actors['Actor.B'];
    expect(brenna.healed).toBe(9);
    expect(brenna.overheal).toBe(3);
    expect(actors['Actor.A'].healReceived).toBe(6);
  });

  it('credits d20fold verdict flips off per-target margins', () => {
    expect(actors['Actor.A'].flips).toBe(1);
    expect(actors['Actor.A'].folds[0]).toMatchObject({ kind: 'bardic', flipped: true });
  });

  it('folds the spend economy: pools and slot-levels', () => {
    const brenna = actors['Actor.B'];
    expect(brenna.pools['Second Wind']).toEqual({ spent: 1, max: 1 });
    expect(brenna.slotLevels).toBe(2);
  });

  it('keeps effect receipts minus reverted, and rounds from the max stamp', () => {
    expect(actors['Actor.B'].effectsApplied).toBe(1); // Hex was reverted
    expect(c1.rounds).toBe(3);
  });

  it('groups the explicit-null bucket as out-of-combat, never dropping it', () => {
    expect(ledger.combats['out-of-combat'].actors['Actor.B'].taken).toBe(2);
  });

  it('joins buff-die margins EXACTLY via rollMessageId for concentration AND demanded saves', () => {
    const conc = ledger.bless.find(b => b.kind === 'concentration');
    expect(conc).toMatchObject({ who: 'Aldric', threshold: 10, bonus: 5, heuristic: true }); // two d4s overlap
    const save = ledger.bless.find(b => b.kind === 'save');
    expect(save).toMatchObject({ who: 'Goblin', threshold: 15, bonus: 2, heuristic: false });
    expect(save!.versus).toContain('Hold Person');
    const atk = ledger.bless.find(b => b.kind === 'attack');
    expect(atk).toMatchObject({ who: 'Aldric', threshold: 16, bonus: 3 });
  });

  it('folds accuracy and AC pressure from rollCtx-stamped attack rolls', () => {
    expect(actors['Actor.A'].attacksMade).toBe(1);
    expect(actors['Actor.A'].attacksHit).toBe(1);
    expect(actors['archetype:Goblin'].targeted).toBe(1);
  });

  it('measures the trait meter from the arithmetic, net of the save multiplier, never the label', () => {
    // saved and resistant: necrotic 9 × 0.5 = 4.5 expected, part 2.25 → the traits denied 2.25;
    // fire 4 × 0.5 = 2 expected, part 2 → nothing denied
    expect(actors['Actor.A'].mitigated).toBe(2.25);
    expect(actors['Actor.A'].amplified).toBe(0);
    // saved only, mislabelled resistant: 9 × 0.5 = 4.5 expected, part 4.5 → nothing denied
    expect(actors['Actor.C'].mitigated).toBe(0);
    expect(actors['Actor.C'].amplified).toBe(0);
    // by-type stays the post-trait parts, summed over both targets
    const goblin = actors['archetype:Goblin'];
    expect(goblin.damageByType).toEqual({ necrotic: 6.75, fire: 4 });
  });

  it('counts save outcomes roller-side from saves targets and concentration outcomes', () => {
    expect(actors['archetype:Goblin'].savesMade).toBe(1); // Hold Person target saved
    expect(actors['Actor.A'].savesMade).toBe(1); // concentration outcome.success
  });

  it('tallies holdSkipped as a moment on the attacker', () => {
    expect(actors['archetype:Goblin'].moments.holdSkipped).toBe(1);
  });

  it('computes decision latency from answeredAt vs deadline/window', () => {
    expect(ledger.latency).toEqual([{ who: 'Brenna', kind: 'bashOffer', ms: 6000 }]);
  });

  it('tallies session flavor: nat 20/1, advantage economy, death saves', () => {
    expect(ledger.flavor.nat20.Brenna).toBe(1);
    expect(ledger.flavor.adv.Aldric).toBe(1);
    expect(ledger.flavor.dis.Brenna).toBe(1);
    expect(ledger.flavor.death.Aldric).toEqual({ made: 1, failed: 1 });
  });
});

describe('foldCombatLedger with a SPARSE names map (deleted unlinked tokens)', () => {
  // Session-6 regression: a defeated monster's token is deleted, its synthetic uuid stops
  // resolving live, and the scan's names map goes sparse. The fold must fall back to the
  // wire-carried names (roster combatants, stamped targets) — BOTH for the printed label
  // and for the archetype KEY, or ×N aggregation silently never merges.
  function sparseScan() {
    return {
      world: 'test',
      scannedAt: 1756300000000,
      totalMessages: 5,
      names: { 'Actor.A': 'Aldric' }, // no entries for either synthetic uuid
      combats: { C1: 'Bog Fight' },
      rosters: {
        C1: {
          combatId: 'C1',
          combatants: [
            { actorUuid: SYNTH('t1', 'b1'), name: 'Bullywug Bog Sage', initiative: 12 },
            { actorUuid: SYNTH('t2', 'b2'), name: 'Bullywug Bog Sage', initiative: 9 },
          ],
        },
      },
      d20s: [],
      stamped: [
        {
          id: 'm1',
          ts: 1,
          rolls: [],
          flags: {
            receipt: {
              targets: [
                {
                  uuid: SYNTH('t1', 'b1'),
                  name: 'Bullywug Bog Sage',
                  prior: { value: 20, temp: 0 },
                  delta: { value: -7, temp: 0 },
                  taken: 7,
                  traits: [],
                  reverted: false,
                  combat: 'C1:1:0',
                  sourceUuid: 'Actor.A',
                },
                {
                  uuid: SYNTH('t2', 'b2'),
                  name: 'Bullywug Bog Sage',
                  prior: { value: 20, temp: 0 },
                  delta: { value: -5, temp: 0 },
                  taken: 5,
                  traits: [],
                  reverted: false,
                  combat: 'C1:1:0',
                  sourceUuid: 'Actor.A',
                },
              ],
            },
          },
        },
      ],
    };
  }

  it('aggregates both tokens into ONE archetype bucket keyed by the wire name', () => {
    const ledger = foldCombatLedger(sparseScan());
    const actors = ledger.combats.C1.actors;
    const keys = Object.keys(actors).filter(k => k.startsWith('archetype:'));
    expect(keys).toEqual(['archetype:Bullywug Bog Sage']);
    const sage = actors['archetype:Bullywug Bog Sage'];
    expect(sage.name).toBe('Bullywug Bog Sage (×2)');
    expect(sage.tokens).toBe(2);
    expect(sage.taken).toBe(12);
  });

  it('never prints a raw synthetic uuid in the rendered report', () => {
    const scan = sparseScan();
    const report = renderCombatReport(scan, foldCombatLedger(scan)); // all sections default
    expect(report).not.toContain('.Token.');
    expect(report).toContain('Bullywug Bog Sage');
  });

  it('falls back roster-only when a stamped target predates the name field', () => {
    const scan = sparseScan();
    for (const t of scan.stamped[0].flags.receipt.targets) delete (t as any).name;
    const ledger = foldCombatLedger(scan);
    expect(Object.keys(ledger.combats.C1.actors)).toContain('archetype:Bullywug Bog Sage');
  });
});

describe('renderCombatReport', () => {
  const scan = fixtureScan();
  const ledger = foldCombatLedger(scan);

  it('renders every section by default, with the combat name and legacy note', () => {
    const out = renderCombatReport(scan, ledger);
    expect(out).toContain('COMBAT Temple Fight — 3 rounds (ended round 3)');
    expect(out).toContain('accuracy 1/1');
    expect(out).toContain('folds spent: bardic (attack)');
    expect(out).toContain('avg decision 6.0s');
    expect(out).toContain('pre-plane legacy');
    expect(out).toContain('BUFF-DIE FLIPS');
    expect(out).toContain('SESSION FLAVOR');
    expect(out).toContain('Goblin (×2)');
  });

  it('filters by section, combat and actor at call time (the GM-facing runtime filter)', () => {
    const damageOnly = renderCombatReport(scan, ledger, { sections: ['damage'] });
    expect(damageOnly).not.toContain('BUFF-DIE');
    expect(damageOnly).not.toContain('slots:');
    const oneCombat = renderCombatReport(scan, ledger, { combat: 'out-of-combat' });
    expect(oneCombat).toContain('OUT OF COMBAT');
    expect(oneCombat).not.toContain('Temple Fight');
    const aldric = renderCombatReport(scan, ledger, { actor: 'aldric' });
    expect(aldric).toContain('Aldric');
    expect(aldric).not.toContain('Goblin (×2)');
  });
});

/**
 * The 2026-09-01 / 2026-09-05 families. Shapes mirror the records surveyed on the sandbox's
 * mirror of a real session (2026-09-23): reminder {sources, net, mode, honoured, answeredAt},
 * chipSpend {targets: [], spent: [{name, key, uuid, bearer, mode, honoured}]}, damageShield
 * {key, attackerUuid, attackerName, defenderName, rolled, total, type}. Every one carries the
 * stamp (combat + sourceUuid).
 */
describe('foldCombatLedger: the 2026-09 families', () => {
  const croc = SYNTH('tc', 'croc');
  const reminder = (net: string, mode: string, sourceUuid = 'Actor.A', combat = 'C1:1:0') => ({
    sources: [{ kind: 'prone', bend: 'advantage', label: 'Target is Prone' }],
    net,
    mode,
    honoured: mode === net,
    answeredAt: 5,
    combat,
    sourceUuid,
  });
  const ward = (total: number, rolled: boolean) => ({
    key: 'Death Armor',
    attackerUuid: croc,
    attackerName: 'Giant Crocodile',
    defenderName: 'Brenna',
    rolled,
    ...(rolled ? { formula: '2d4', total, type: 'necrotic' } : {}),
    combat: 'C1:2:1',
    sourceUuid: 'Actor.B',
  });
  const swing = (id: string, total: number, adv: number) => ({
    id,
    ts: 1,
    rollType: 'attack',
    total,
    actorUuid: 'Actor.A',
    ctx: { combat: 'C1:1:0', sourceUuid: 'Actor.A' },
    adv,
    d20: { result: total - 3, all: [total - 3] },
    bonusDice: [],
    targets: [{ uuid: croc, name: 'Giant Crocodile', ac: 12 }],
  });
  const scan = {
    world: 'test',
    scannedAt: 0,
    totalMessages: 12,
    combats: { C1: 'Temple Fight' },
    rosters: {},
    // no entry for the crocodile's synthetic uuid: its name has to come off the wire
    names: { 'Actor.A': 'Aldric', 'Actor.B': 'Brenna' },
    stamped: [
      // two reminded swings by Aldric: one honoured, one rolled flat against the net
      { id: 'r1', ts: 1, flags: { reminder: reminder('advantage', 'advantage') } },
      { id: 'r2', ts: 2, flags: { reminder: reminder('advantage', 'normal') } },
      // the gate also meets saves: Brenna's reminded save, made against the crocodile's DC
      {
        id: 's1',
        ts: 2,
        flags: { reminder: reminder('advantage', 'advantage', 'Actor.B', 'C1:2:0') },
      },
      {
        id: 'd1',
        ts: 2,
        flags: {
          saves: {
            dc: 13,
            targets: [{ uuid: 'Actor.B', name: 'Brenna', outcome: 'saved', rollMessageId: 's1' }],
            combat: 'C1:2:0',
            sourceUuid: croc,
          },
        },
      },
      // the crocodile's swing used up its own Sapped chip
      {
        id: 'c1',
        ts: 3,
        flags: {
          chipSpend: {
            targets: [],
            spent: [
              {
                id: 'e1',
                name: 'Sapped',
                key: 'sap',
                uuid: croc,
                bearer: 'Giant Crocodile',
                mode: 'normal',
                honoured: true,
              },
            ],
            combat: 'C1:2:1',
            sourceUuid: croc,
          },
        },
      },
      // Brenna's ward struck twice; the unread card (rolled: false) never counts
      { id: 'w1', ts: 4, flags: { damageShield: ward(4, true) } },
      { id: 'w2', ts: 5, flags: { damageShield: ward(5, true) } },
      { id: 'w3', ts: 6, flags: { damageShield: ward(0, false) } },
      // maneuvers: one use, one ride carrying two dice
      {
        id: 'u1',
        ts: 7,
        flags: { superiorityUse: { key: 'Rally', combat: 'C1:3:0', sourceUuid: 'Actor.A' } },
      },
      // clock riders on two of Aldric's damage rolls; one roll carried two
      ...[['Dreadful Strike'], ['Dreadful Strike', 'Divine Strike']].map((labels, i) => ({
        id: `k${i}`,
        ts: 9 + i,
        flags: {
          clockRiders: {
            attackId: 'r1',
            riders: labels.map(label => ({ key: label.toLowerCase(), label, formula: '2d6' })),
            combat: 'C1:3:0',
            sourceUuid: 'Actor.A',
          },
        },
      })),
      // Aldric's Great Weapon Fighting raising two damage rolls (one raised nothing: no record at all)
      ...[
        [
          {
            key: 'great-weapon-fighting',
            feature: 'Great Weapon Fighting',
            gain: 2,
            raised: [{ from: 1, to: 3 }],
          },
        ],
        [
          {
            key: 'great-weapon-fighting',
            feature: 'Great Weapon Fighting',
            gain: 3,
            raised: [
              { from: 1, to: 3 },
              { from: 2, to: 3 },
            ],
          },
          { key: 'dueling', feature: 'Dueling', gain: 0, off: 'two hands' },
        ],
      ].map((styles, i) => ({
        id: `f${i}`,
        ts: 9.5 + i / 10,
        flags: { fightingStyle: { styles, gain: 5, combat: 'C1:3:0', sourceUuid: 'Actor.A' } },
      })),
      // Brenna's aura card, reposted out of combat each time it stands again
      ...[11, 12].map(ts => ({
        id: `e${ts}`,
        ts,
        flags: {
          emanationCard: {
            key: 'Aura of Protection',
            verb: 'stands',
            range: 10,
            regionId: null,
            combat: null,
            sourceUuid: 'Actor.B',
          },
        },
      })),
      {
        id: 'u2',
        ts: 8,
        flags: {
          superiorityRide: {
            attackId: 'r1',
            rode: [{ key: 'Lunging Attack' }, { key: 'Feinting Attack' }],
            combat: 'C1:3:0',
            sourceUuid: 'Actor.A',
          },
        },
      },
    ],
    // r1 hits AC 12, r2 misses; x1 was never reminded and hits; s1 is Brenna's save
    d20s: [
      swing('r1', 15, 1),
      swing('r2', 9, 0),
      swing('x1', 14, 0),
      {
        id: 's1',
        ts: 2,
        rollType: 'save',
        total: 15,
        actorUuid: 'Actor.B',
        ctx: { combat: 'C1:2:0', sourceUuid: 'Actor.B' },
        adv: 1,
        d20: { result: 13, all: [13, 4] },
        bonusDice: [],
        targets: [],
      },
    ],
  };
  const ledger = foldCombatLedger(scan);
  const actors = ledger.combats.C1.actors;

  it('folds the reminders: the net named, how many were honoured, and the reminded hits', () => {
    const a = actors['Actor.A'];
    expect(a.reminded).toBe(2);
    expect(a.remindedHonoured).toBe(1);
    expect(a.remindedNet).toEqual({ advantage: 2 });
    expect(a.remindedAttacks).toBe(2);
    expect(a.remindedHits).toBe(1);
    expect(a.attacksMade).toBe(3);
    expect(a.attacksHit).toBe(2);
    expect(a.remindedSaves).toBe(0);
  });

  it('joins a reminded save to its outcome by the roll message id', () => {
    const b = actors['Actor.B'];
    expect(b.reminded).toBe(1);
    expect(b.remindedSaves).toBe(1);
    expect(b.remindedSavesJudged).toBe(1);
    expect(b.remindedSavesMade).toBe(1);
    expect(b.remindedAttacks).toBe(0);
  });

  it('credits chips to the attacker whose swing spent them, named from the wire', () => {
    const c = actors['archetype:Giant Crocodile'];
    expect(c.chips).toEqual({ Sapped: 1 });
    expect(c.chipsNotHonoured).toBe(0);
    expect(c.name).toBe('Giant Crocodile');
  });

  it('counts rolled ward strikes for the defender, and adds no damage of its own', () => {
    const b = actors['Actor.B'];
    expect(b.wards).toEqual({ 'Death Armor': { n: 2, total: 9 } });
    expect(b.dealt).toBe(0); // the ward's damage arrives through its receipt, not this flag
  });

  it('counts clock riders by name for the attacker, adding no damage', () => {
    const a = actors['Actor.A'];
    expect(a.riders).toEqual({ 'Dreadful Strike': 2, 'Divine Strike': 1 });
    expect(a.dealt).toBe(0);
  });

  it('adds up what each Fighting Style added, per style, skipping an entry that added nothing', () => {
    const a = actors['Actor.A'];
    expect(a.styles).toEqual({ 'Great Weapon Fighting': { n: 2, gain: 5 } });
    expect(a.dealt).toBe(0);
  });

  it('names an aura once however many times its card was reposted', () => {
    const b = ledger.combats['out-of-combat'].actors['Actor.B'];
    expect(b.auras).toEqual(['Aura of Protection']);
  });

  it('counts the maneuver moments, one per superiority die that rode', () => {
    expect(actors['Actor.A'].moments).toEqual({ superiorityUse: 1, superiorityRide: 2 });
    expect(ledger.combats.C1.rounds).toBe(3);
    expect(ledger.legacy).toBe(0);
  });

  it('renders the new lines under moments', () => {
    const out = renderCombatReport(scan, ledger);
    expect(out).toContain('reminded 2× (advantage 2; 1 rolled against the net; attacks hit 1/2)');
    expect(out).toContain('reminded 1× (advantage 1; saves made 1/1)');
    expect(out).toContain('chips spent: Sapped ×1');
    expect(out).toContain('wards struck: Death Armor ×2 (9 dmg)');
    expect(out).toContain('superiorityUse×1, superiorityRide×2');
    expect(out).toContain('riders: Dreadful Strike ×2, Divine Strike ×1');
    expect(out).toContain('fighting styles: Great Weapon Fighting ×2 (+5 dmg)');
    expect(out).toContain('auras: Aura of Protection');
    expect(out).not.toContain('Aura of Protection ×');
    expect(renderCombatReport(scan, ledger, { sections: ['damage'] })).not.toContain('reminded');
  });
});

describe('foldCombatLedger: the moment records the scan had missed, and the families skipped', () => {
  const stamped = (k: string, extra: Record<string, unknown> = {}, sourceUuid = 'Actor.A') => ({
    [k]: { ...extra, combat: 'C1:2:0', sourceUuid },
  });
  const scan = {
    world: 'test',
    scannedAt: 0,
    totalMessages: 6,
    combats: { C1: 'Temple Fight' },
    rosters: {},
    names: { 'Actor.A': 'Aldric', 'Actor.B': 'Brenna' },
    stamped: [
      { id: 'm1', ts: 1, flags: stamped('hitManeuver', { picks: [{ key: 'trip' }] }) },
      { id: 'm2', ts: 2, flags: stamped('sneakDamage', { dice: 3 }) },
      { id: 'm3', ts: 3, flags: stamped('summon', { applied: true }, 'Actor.B') },
      { id: 'm4', ts: 4, flags: stamped('hitManeuver', {}) },
    ],
    d20s: [],
    skipped: {
      castApply: {
        n: 2,
        why: 'a decision, unstamped by ruling; the effect it picks is in effectReceipt',
      },
      someNewKey: { n: 1, why: 'not read by this build' },
    },
  };
  const ledger = foldCombatLedger(scan);

  it('counts each one per record, per actor, in its combat', () => {
    expect(ledger.combats.C1.actors['Actor.A'].moments).toEqual({ hitManeuver: 2, sneakDamage: 1 });
    expect(ledger.combats.C1.actors['Actor.B'].moments).toEqual({ summon: 1 });
    expect(ledger.combats.C1.rounds).toBe(2);
    expect(ledger.legacy).toBe(0);
  });

  it('carries the families skipped, and the report names them with why', () => {
    expect(ledger.skipped).toEqual(scan.skipped);
    const report = renderCombatReport(scan, ledger);
    expect(report).toContain(
      'families skipped: castApply on 2 cards (a decision, unstamped by ruling; the effect it picks is in effectReceipt); someNewKey on 1 card (not read by this build)'
    );
  });

  it('a scan with nothing skipped prints no such line; an older scan with bare counts still reads', () => {
    expect(
      renderCombatReport({ ...scan, skipped: {} }, foldCombatLedger({ ...scan, skipped: {} }))
    ).not.toContain('families skipped');
    expect(foldCombatLedger({ ...scan, skipped: { x: 3 } }).skipped).toEqual({
      x: { n: 3, why: 'not read by this build' },
    });
  });
});
