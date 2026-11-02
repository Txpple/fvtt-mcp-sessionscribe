// The campaign repo contract, enforced. The prose convention lives in
// fvtt-mcp-dnd5e/.claude/skills/_shared/campaign-repo.md (other skills read the same file); this
// module is the machine side of the keys the scribe reads: it parses campaign.json once, fills the
// documented defaults, and resolves where a session's record lives. Nothing here carries a
// campaign fact; every name comes from the campaign repo at runtime.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

export const OUTPUTS = [
  'recap',
  'combat-log',
  'gm-notes',
  'gm-notes-story',
  'gm-notes-mechanics',
] as const;
export type Output = (typeof OUTPUTS)[number];

const journalRef = z.object({ name: z.string().min(1), folder: z.string().optional() });

export const CampaignSchema = z.looseObject({
  name: z.string().min(1),
  worldId: z.string().min(1),
  party: z.array(z.string().min(1)).min(1),
  excludedActors: z.array(z.string()).default([]),
  journals: z
    .looseObject({
      sessionDiary: journalRef.optional(),
      combatLogs: journalRef.optional(),
      bestiary: journalRef.optional(),
    })
    .default({}),
  sessions: z
    .looseObject({
      dir: z.string().min(1).default('sessions'),
      outputs: z.array(z.enum(OUTPUTS)).min(1).default(['recap', 'gm-notes']),
      pdf: z.boolean().default(false),
      skewSeconds: z.number().default(0),
      illustrations: z.boolean().default(false),
      /** Discord id or username → the transcript's speaker label (a character name). */
      speakers: z.record(z.string(), z.string()).optional(),
    })
    .default({
      dir: 'sessions',
      outputs: ['recap', 'gm-notes'],
      pdf: false,
      skewSeconds: 0,
      illustrations: false,
    }),
  snapshots: z
    .looseObject({ dir: z.string().min(1).default('party-snapshots') })
    .default({ dir: 'party-snapshots' }),
});
export type CampaignFile = z.infer<typeof CampaignSchema>;

export interface Campaign extends CampaignFile {
  /** Absolute path of the campaign repo root. */
  root: string;
  /** Absolute path of `sessions.dir`. */
  sessionsDir: string;
  /** Absolute path of `snapshots.dir`. */
  snapshotsDir: string;
}

/** Load and validate `<root>/campaign.json`. Throws a message that names the fix. */
export function loadCampaign(root: string): Campaign {
  if (!root) throw new Error('SCRIBE_CAMPAIGN_REPO is not set in the scribe .env');
  const file = path.join(root, 'campaign.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const why = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : (e as Error).message;
    throw new Error(`${file}: ${why}`);
  }
  const parsed = CampaignSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`${file} does not match the campaign-repo convention: ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    root,
    sessionsDir: path.resolve(root, c.sessions.dir),
    snapshotsDir: path.resolve(root, c.snapshots.dir),
  };
}

const SESSION_DIR = /^(\d{4}-\d{2}-\d{2})(?:-[a-z0-9-]+)?$/;

/** The session directories under `sessions.dir`, oldest first: `YYYY-MM-DD` with an optional slug. */
export function listSessionDirs(campaign: Campaign): string[] {
  if (!fs.existsSync(campaign.sessionsDir)) return [];
  return fs
    .readdirSync(campaign.sessionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && SESSION_DIR.test(d.name))
    .map(d => d.name)
    .sort();
}

/** The calendar date a session directory records (`2026-07-06-pipeline-test` → `2026-07-06`). */
export function sessionDate(dirName: string): string {
  const m = SESSION_DIR.exec(dirName);
  if (!m?.[1]) throw new Error(`not a session directory name: ${dirName}`);
  return m[1];
}

/**
 * Resolve a `date` argument to a session directory. An exact directory name wins; a bare date
 * matches the one directory for that day and refuses when there are several. With `create`, a
 * bare date that matches nothing becomes a new `<sessions.dir>/<date>` path (not created on disk).
 */
export function resolveSessionDir(
  campaign: Campaign,
  date: string,
  opts: { create?: boolean } = {}
): string {
  if (!SESSION_DIR.test(date)) {
    throw new Error(`date must be YYYY-MM-DD or a session directory name, got "${date}"`);
  }
  const dirs = listSessionDirs(campaign);
  if (dirs.includes(date)) return path.join(campaign.sessionsDir, date);
  const sameDay = dirs.filter(d => sessionDate(d) === date);
  if (sameDay.length === 1 && sameDay[0]) return path.join(campaign.sessionsDir, sameDay[0]);
  if (sameDay.length > 1) {
    throw new Error(`${date} matches several session directories: ${sameDay.join(', ')}`);
  }
  if (opts.create && sessionDate(date) === date) return path.join(campaign.sessionsDir, date);
  throw new Error(`no session directory for ${date} under ${campaign.sessionsDir}`);
}
