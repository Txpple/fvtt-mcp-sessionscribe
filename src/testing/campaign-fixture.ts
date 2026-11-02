// A synthetic campaign repo on disk for the tests. Every name here is invented (the campaign-repo
// convention's own example party); no real campaign fact belongs in this repo.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PARTY = ['Aldric Stone', 'Brenna Quickfoot'];

export const CAMPAIGN_JSON = {
  name: 'The Lost Mine of Phandelver',
  worldId: 'lost-mine',
  party: PARTY,
  excludedActors: ['Test PC'],
  journals: {
    sessionDiary: { name: 'Session Diary', folder: 'Adventure Log' },
    combatLogs: { name: 'Combat Logs', folder: 'Adventure Log' },
  },
  sessions: {
    dir: 'sessions',
    outputs: ['recap', 'combat-log', 'gm-notes-story', 'gm-notes-mechanics'],
    pdf: true,
    skewSeconds: 0,
    illustrations: true,
  },
  snapshots: { dir: 'party-snapshots' },
};

/** Write `files` (relative path → contents) under a fresh temp dir and return its root. */
export function makeTempRepo(files: Record<string, string | object>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-campaign-'));
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

export function removeTempRepo(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}
