/**
 * By the Books' card-flag contract against what the scan reads of it. By the Books records every key
 * it writes under its flag scope, with its recorded shape and where its stat stamp sits, in its own
 * repo (contracts/card-flags.json); this reads that file from the clone beside this repo
 * (SCRIBE_BYTHEBOOKS_DIR names another place) and holds the scan to it: every family in BF_KEYS is a
 * key By the Books writes, every field the fold touches (contracts/consumes.json) is in its recorded
 * shape, every family the fold counts one per record carries the stamp on the record itself, and the
 * version is the one consumes.json names. A renamed field there fails here before either ships.
 * Without the clone (CI checks out only fvtt-mcp-dnd5e) the contract half is skipped, saying so.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COUNTED_FAMILIES, FOLDED_FAMILIES } from '../analytics/combat.js';
import { BF_KEYS, SKIPPED_FAMILIES, skippedFamilies } from './combat-stats.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BYTHEBOOKS = resolve(
  process.env.SCRIBE_BYTHEBOOKS_DIR ?? join(REPO, '..', 'fvtt-mod-bythebooks')
);
const CONTRACT = join(BYTHEBOOKS, 'contracts', 'card-flags.json');

const consumes = JSON.parse(readFileSync(join(REPO, 'contracts', 'consumes.json'), 'utf8'));
const want = consumes.consumes.find(
  (c: any) => c.emitter === 'fvtt-mod-bythebooks' && c.contract === 'card-flags'
);
const touched: Record<string, string[]> = want?.keys ?? {};
const sorted = (xs: readonly string[]) => [...xs].sort();

describe('the families the scan reads, against its own lists', () => {
  it('BF_KEYS is the folded families and the counted ones, each once', () => {
    expect(sorted(BF_KEYS)).toEqual(sorted([...FOLDED_FAMILIES, ...COUNTED_FAMILIES]));
    expect(new Set(BF_KEYS).size).toBe(BF_KEYS.length);
  });

  it('reads 54 families; the families skipped on purpose are none of them, and each says why', () => {
    expect(BF_KEYS.length).toBe(54);
    for (const k of Object.keys(SKIPPED_FAMILIES)) {
      expect(BF_KEYS).not.toContain(k);
      expect(SKIPPED_FAMILIES[k]).toMatch(/\w/);
    }
  });

  it('consumes.json names every family the scan reads, with the fields the fold touches', () => {
    expect(sorted(Object.keys(touched))).toEqual(sorted(BF_KEYS));
    for (const k of COUNTED_FAMILIES)
      expect(touched[k]).toEqual(expect.arrayContaining(['combat', 'sourceUuid']));
  });

  it('a family on a card that the scan does not fold is named skipped; the roll context and the roster are read elsewhere', () => {
    expect(
      skippedFamilies({ receipt: {}, castApply: {}, rollCtx: {}, combatRoster: {}, someNewKey: {} })
    ).toEqual(['castApply', 'someNewKey']);
  });
});

describe.skipIf(!existsSync(CONTRACT))(
  "By the Books' card-flag contract (its contracts/card-flags.json)",
  () => {
    const contract = existsSync(CONTRACT) ? JSON.parse(readFileSync(CONTRACT, 'utf8')) : null;
    const keys: Record<string, any> = contract?.keys ?? {};

    it(`is the version consumes.json names (${want?.version})`, () => {
      expect(
        contract.version,
        `By the Books publishes card-flags version ${contract.version}: re-read its contracts/card-flags.json against the scan and the fold, then set the version in contracts/consumes.json`
      ).toBe(want.version);
    });

    it('names every family the scan reads, and every family it skips on purpose', () => {
      const missing = [...BF_KEYS, ...Object.keys(SKIPPED_FAMILIES)].filter(k => !keys[k]);
      expect(missing, 'keys By the Books no longer writes').toEqual([]);
    });

    it('carries every field the fold touches, on each family it has recorded', () => {
      const gone: string[] = [];
      for (const [k, fields] of Object.entries(touched)) {
        if (!keys[k]?.recorded) continue;
        for (const f of fields) if (!keys[k].fields.includes(f)) gone.push(`${k} ${f}`);
      }
      expect(gone, 'fields the fold reads that By the Books does not record').toEqual([]);
    });

    it('stamps every counted family on the record itself (combat and sourceUuid), so none reads as legacy', () => {
      const unstamped = COUNTED_FAMILIES.filter(k => keys[k]?.recorded && keys[k].stamp !== 'flag');
      expect(unstamped, 'counted families whose recorded shape has no stamp on the flag').toEqual(
        []
      );
    });
  }
);

// Without the clone the skip says why, as a test of its own the run lists.
if (!existsSync(CONTRACT))
  it.skip(`By the Books' contract: no ${CONTRACT}, so the contract half is skipped (clone fvtt-mod-bythebooks beside this repo, or set SCRIBE_BYTHEBOOKS_DIR)`, () => {});
