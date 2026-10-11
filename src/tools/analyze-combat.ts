// analyze-combat: the combat analytics of a session (was fvtt-mcp-dnd5e's get-combat-stats). The
// reader child scans By the Books' stat-stamped chat messages (either scope) page-side; the fold and the report
// are the pure, verbatim-ported src/analytics/combat.ts. GM-facing by ruling: exact numbers,
// filtered at call time (sections / actor / combat), never redacted.

import { z } from 'zod';
import { foldCombatLedger, renderCombatReport, SECTIONS } from '../analytics/combat.js';
import { loadCampaign, resolveSessionDir } from '../campaign.js';
import type { Config } from '../config.js';
import type { WorldReader } from '../foundry/read.js';
import { toInputSchema } from '../utils/schema.js';
import { describeWindow, resolveWindow } from '../window.js';
import { hostSchema } from './status.js';

const AnalyzeCombatSchema = z.object({
  date: z
    .string()
    .optional()
    .describe('A session (YYYY-MM-DD): scope to its recording window, padded 10 min each side.'),
  since: z
    .string()
    .optional()
    .describe('Start, ISO date or epoch ms; overrides the session window.'),
  until: z.string().optional().describe('End, ISO date or epoch ms; overrides the session window.'),
  combat: z.string().optional().describe('One combat id, or "out-of-combat"; default all.'),
  sections: z.array(z.enum(SECTIONS)).optional().describe('Sections to render (default all).'),
  actor: z.string().optional().describe('Only actors whose name contains this (case-insensitive).'),
  includeLedger: z.boolean().default(false).describe('Append the folded ledger as JSON.'),
  host: hostSchema,
});

export interface AnalyzeCombatDeps {
  config: Config;
  reader: WorldReader;
}

export class AnalyzeCombatTool {
  constructor(private readonly deps: AnalyzeCombatDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'analyze-combat',
        description:
          "A session's combat analytics from By the Books' stat-stamped chat messages: per combat " +
          'damage dealt / taken, accuracy, healing, verdict flips, spends, moments (reminders, ' +
          'chips, wards, maneuvers), Bless margins, flavor ' +
          '(nat 20s / 1s, advantage, death saves, decision speed). Reverted applications are ' +
          'subtracted; unlinked monsters aggregate by archetype. GM-facing, exact numbers.',
        inputSchema: toInputSchema(AnalyzeCombatSchema),
      },
    ];
  }

  async handleAnalyzeCombat(args: unknown): Promise<string> {
    const p = AnalyzeCombatSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const window = resolveWindow({
      sessionDir: p.date ? resolveSessionDir(campaign, p.date) : undefined,
      since: p.since,
      until: p.until,
    });
    const host = p.host ?? this.deps.config.defaultHost;
    const r = await this.deps.reader<any>({
      op: 'scanCombatStats',
      args: { since: window.since, ...(window.until !== undefined ? { until: window.until } : {}) },
      host,
      worldId: campaign.worldId,
    });
    if (!r.ok || !r.result) throw new Error(r.error ?? 'the reader returned no scan');
    const scan = r.result;
    const ledger = foldCombatLedger(scan);
    if (p.combat && !(p.combat in ledger.combats)) {
      const known = Object.keys(ledger.combats);
      throw new Error(
        `No ledger bucket for combat "${p.combat}". Known: ` +
          `${known.length ? known.join(', ') : '(none — no stamped messages in range)'}.`
      );
    }
    const report = renderCombatReport(scan, ledger, {
      combat: p.combat,
      sections: p.sections,
      actor: p.actor,
    });
    const btb = r.probe?.bythebooks;
    const stamp =
      `_${host} · ${describeWindow(window)} · read ${r.readAt ?? '?'}` +
      `${btb ? '' : ' · ⚠ By the Books is not installed in this world: no stamps to fold'}_`;
    const body = `${stamp}\n${report}`;
    if (!p.includeLedger) return body;
    return `${body}\n\n\`\`\`json\n${JSON.stringify({ ledger, rosters: scan.rosters ?? {} })}\n\`\`\``;
  }
}
