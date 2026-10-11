// VERIFY: the reader's live gate (M3). SANDBOX ONLY (FOUNDRY_HOST=local), READ-ONLY, one
// world-driver at a time: check `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status` and that
// no suite is running first. Needs `npm run build` and the FOUNDRY_SCRIBE_USER login in .env.
//
//   1. A read through the REAL path (server-side childReader → dist/workers/foundry-read.js)
//      answers, and afterwards no scribe user is left connected (the sandbox's user count is back
//      to what it was before).
//   2. A scribe connection that sits idle changes nothing in the world: a fingerprint of the
//      messages, actors, world items, combats and scenes (counts + the newest _stats.modifiedTime)
//      is identical at connect and 30 s later. Run it with NO other GM connected (disconnect the
//      MCP bridge with its disconnect-bridge tool first): that is the case where the scribe is the
//      elected GM, and By the Books' GM-only code would run on its page if anything triggered it.
//      A write at `ready` predates that first fingerprint, so nothing may be newer than the join.
//
//   FOUNDRY_HOST=local node scripts/verify-reader.mjs

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { loadCampaign } from '../dist/campaign.js';
import { config, repoRoot } from '../dist/config.js';
import { rulesModuleLabel } from '../dist/foundry/protocol.js';
import { childReader } from '../dist/foundry/read.js';
import { openScribeSession } from '../dist/foundry/session.js';

if ((process.env.FOUNDRY_HOST ?? '').toLowerCase() !== 'local') {
  console.error('verify-reader: SANDBOX ONLY — run with FOUNDRY_HOST=local');
  process.exit(2);
}

const localFoundry = path.join(repoRoot, '..', 'fvtt-mcp-dnd5e', 'scripts', 'local-foundry.mjs');
function connectedUsers() {
  const out = execFileSync(process.execPath, [localFoundry, 'status'], {
    env: { ...process.env, FOUNDRY_HOST: 'local' },
    encoding: 'utf8',
  });
  const m = /users:\s+(\d+)/.exec(out);
  if (!m) throw new Error(`could not read the sandbox's user count:\n${out}`);
  return Number(m[1]);
}

let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const campaign = loadCampaign(config.campaignRepo);

// 1 — the real read path, and nothing left behind
const before = connectedUsers();
const reply = await childReader()({ op: 'probe', host: 'local', worldId: campaign.worldId });
check(
  reply.ok,
  `a probe through the reader child answers (${reply.ok ? reply.probe.worldId : reply.error})`
);
if (reply.ok) {
  const p = reply.probe;
  console.log(
    `      as "${p.user.name}" (role ${p.user.role}) · GMs connected: ${p.gmsConnected.map(g => g.name).join(', ')}` +
      ` · elected: ${p.activeGM?.name ?? 'none'} · ${rulesModuleLabel(p.bythebooks)}`
  );
}
await new Promise(r => setTimeout(r, 5_000)); // let the server notice the socket closing
const after = connectedUsers();
check(after === before, `no scribe user left connected (users before ${before}, after ${after})`);

// 2 — an idle scribe connection changes nothing
const fingerprint = () => {
  const newest = docs =>
    docs.reduce((t, d) => Math.max(t, Number(d?._stats?.modifiedTime ?? 0)), 0);
  const of = coll => ({ n: coll.size, newest: newest([...coll]) });
  return JSON.stringify({
    messages: of(game.messages),
    actors: of(game.actors),
    items: of(game.items),
    combats: of(game.combats),
    scenes: of(game.scenes),
  });
};
const joinedAt = Date.now(); // the sandbox runs on this machine, so its clock is ours
const session = await openScribeSession('local');
try {
  const probe = await session.call('probe');
  const alone = probe.gmsConnected.every(g => g.name === probe.user.name);
  console.log(
    `      ${alone ? 'the scribe is the only GM connected (the case that matters)' : `other GMs connected: ${probe.gmsConnected.map(g => g.name).join(', ')} — for the no-GM case, disconnect the MCP bridge and re-run`}` +
      ` · elected: ${probe.activeGM?.name ?? 'none'}${probe.activeGM?.isSelf ? ' (the scribe)' : ''}`
  );
  const a = await session.f.evaluate(fingerprint, null);
  // A write at `ready` lands before the first fingerprint, so the idle comparison can't see it
  const touched = Object.entries(JSON.parse(a)).filter(([, c]) => c.newest >= joinedAt);
  check(
    touched.length === 0,
    `nothing was modified while the scribe joined${touched.length ? ` — touched: ${touched.map(([k]) => k).join(', ')}` : ''}`
  );
  await new Promise(r => setTimeout(r, 30_000));
  const b = await session.f.evaluate(fingerprint, null);
  check(
    a === b,
    `30 s of an idle scribe connection changed nothing in the world${a === b ? '' : `\n      at connect ${a}\n      30 s later ${b}`}`
  );
} finally {
  await session.dispose();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nthe reader gate is green');
process.exit(failures ? 1 : 0);
