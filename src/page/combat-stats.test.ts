/**
 * Offline unit tests for the dnd5e message-data readers in src/page/combat-stats.ts. They lock the
 * dnd5e 6.0 chat shape (typed messages, `message.system.{item,origin,targets}`, targets carrying
 * `actor`/`token` uuids instead of `uuid`) AND the 5.x flag fallback, so the fold's wire vocabulary
 * (rollType names, `targets[].uuid` = actor uuid) stays stable across the system upgrade.
 */

import { describe, it, expect } from 'vitest';
import {
  BF_KEYS,
  messageItemUuid,
  messageOrigin,
  messageRollType,
  messageTargets,
  stampScope,
} from './combat-stats.js';

describe('BF_KEYS (the families the scan folds)', () => {
  it("covers the contract table's stamped families, 2026-09-01 and 2026-09-05 included", () => {
    for (const k of [
      'receipt',
      'spend',
      'reminder',
      'chipSpend',
      'damageShield',
      'shieldMark',
      'superiorityUse',
      'superiorityRide',
      'baitSwitch',
      'command',
      'damageCast',
      'emanationHeal',
      'emanationRemind',
      'clockRiders',
      'emanationCard',
    ])
      expect(BF_KEYS).toContain(k);
  });

  it('leaves out castApply (unstamped by ruling) and the rollCtx / combatRoster riders', () => {
    for (const k of ['castApply', 'rollCtx', 'combatRoster']) expect(BF_KEYS).not.toContain(k);
  });
});

describe('stampScope (the flag scope, per message)', () => {
  const receipt = { entries: [] };
  it("reads By the Books' scope, and Battle Flow's on a card written before the rename", () => {
    expect(stampScope({ 'fvtt-mod-bythebooks': { receipt } })).toEqual({ receipt });
    expect(stampScope({ 'fvtt-mod-battleflow': { receipt } })).toEqual({ receipt });
    expect(stampScope({ dnd5e: {} })).toBeUndefined();
    expect(stampScope(undefined)).toBeUndefined();
  });

  it('merges both on one message family by family, the new scope winning', () => {
    const old = { receipt: { entries: ['old'] }, rollCtx: { combat: 'C1:1:0' } };
    const fresh = { receipt: { entries: ['new'] } };
    expect(stampScope({ 'fvtt-mod-battleflow': old, 'fvtt-mod-bythebooks': fresh })).toEqual({
      receipt: { entries: ['new'] },
      rollCtx: { combat: 'C1:1:0' },
    });
  });
});

describe('messageRollType', () => {
  it('maps dnd5e 6.0 typed messages to the 5.x roll vocabulary', () => {
    expect(messageRollType({ type: 'attack', system: {} })).toBe('attack');
    expect(messageRollType({ type: 'damage', system: {} })).toBe('damage');
    expect(messageRollType({ type: 'healing', system: {} })).toBe('healing');
    expect(messageRollType({ type: 'save', system: { type: 'ability' } })).toBe('save');
    expect(messageRollType({ type: 'save', system: { type: 'death' } })).toBe('death');
    expect(messageRollType({ type: 'save', system: { type: 'concentration' } })).toBe(
      'concentration'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'dex', skill: 'ste' } })).toBe(
      'skill'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'dex', tool: 'thief' } })).toBe(
      'tool'
    );
    expect(messageRollType({ type: 'check', system: { ability: 'wis' } })).toBe('ability');
    expect(messageRollType({ type: 'check', system: { ability: 'dex', type: 'initiative' } })).toBe(
      'initiative'
    );
  });

  it('falls back to the 5.x flags.dnd5e.roll.type on an untyped (base) message', () => {
    expect(messageRollType({ type: 'base', flags: { dnd5e: { roll: { type: 'attack' } } } })).toBe(
      'attack'
    );
    expect(messageRollType({ type: 'base', flags: {} })).toBeUndefined();
    expect(messageRollType({})).toBeUndefined();
  });
});

describe('messageItemUuid', () => {
  it('prefers system.item, then the 5.x use/item flags', () => {
    expect(messageItemUuid({ system: { item: { uuid: 'Actor.a.Item.i' } }, flags: {} })).toBe(
      'Actor.a.Item.i'
    );
    expect(messageItemUuid({ system: {}, flags: { dnd5e: { use: { itemUuid: 'X' } } } })).toBe('X');
    expect(messageItemUuid({ system: {}, flags: { dnd5e: { item: { id: 'i1' } } } })).toBe('i1');
    expect(messageItemUuid({})).toBeNull();
  });
});

describe('messageOrigin', () => {
  it('reads system.origin as an id string or a resolved document', () => {
    expect(messageOrigin({ _source: { system: { origin: 'm0' } }, system: { origin: {} } })).toBe(
      'm0'
    );
    expect(messageOrigin({ system: { origin: { id: 'm0' } } })).toBe('m0');
    expect(
      messageOrigin({ system: { origin: null }, flags: { dnd5e: { originatingMessage: 'm9' } } })
    ).toBe('m9');
    expect(messageOrigin({ system: {} })).toBeNull();
  });
});

describe('messageTargets', () => {
  it('normalizes 6.0 {actor, token, name, ac} descriptors to the {uuid, name, ac} wire shape', () => {
    const t = messageTargets({
      system: {
        targets: [
          { actor: 'Scene.s.Token.t.Actor.a', token: 'Scene.s.Token.t', name: 'Goblin', ac: 15 },
          { actor: 'Actor.pc', token: 'Scene.s.Token.p', name: 'Anya', ac: null },
        ],
      },
    });
    expect(t).toEqual([
      { uuid: 'Scene.s.Token.t.Actor.a', name: 'Goblin', ac: 15, token: 'Scene.s.Token.t' },
      { uuid: 'Actor.pc', name: 'Anya', ac: null, token: 'Scene.s.Token.p' },
    ]);
  });

  it('reads the 5.x flags.dnd5e.targets shape unchanged, and null when absent', () => {
    expect(
      messageTargets({
        system: {},
        flags: { dnd5e: { targets: [{ uuid: 'Actor.x', name: 'X', ac: 12 }] } },
      })
    ).toEqual([{ uuid: 'Actor.x', name: 'X', ac: 12 }]);
    expect(messageTargets({ system: {}, flags: {} })).toBeNull();
  });
});
