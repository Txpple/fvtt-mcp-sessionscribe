// The contract between the server and the one-shot reader child (src/workers/foundry-read.ts).
// The server writes one ReadRequest to the child's stdin; the child prints exactly one
// SENTINEL-prefixed ReadResponse line to stdout and exits. Anything else on stdout (a library's
// stray log line) is ignored, so the reply can never be confused with noise.

import type { HostName } from '../config.js';
import type { WorldProbe } from '../page/probe.js';

export const SENTINEL = '@@scribe-read@@';

export interface ReadRequest {
  /** A window.__scribe op; 'probe' alone just connects, identifies the world, and hangs up. */
  op: string;
  args?: unknown;
  host: HostName;
  /** campaign.json's worldId: a connection to any other world is refused before `op` runs. */
  worldId?: string;
  /** The child's own watchdog; the server kills it a margin after this. */
  timeoutMs?: number;
}

export interface ReadResponse<T = unknown> {
  ok: boolean;
  host: HostName;
  /** When the read ran (ISO), stamped into every output built from it. */
  readAt?: string;
  probe?: WorldProbe;
  result?: T;
  error?: string;
}

export const DEFAULT_READ_TIMEOUT_MS = 240_000;

/**
 * The probe's rules module for a human line: "By the Books 3.0.0", or, on a table still on 2.x,
 * "Battle Flow 2.17.0 (now By the Books)"; ", inactive" when installed but off.
 */
export function rulesModuleLabel(m: WorldProbe['bythebooks']): string {
  if (!m) return 'By the Books absent';
  const name =
    m.id === 'fvtt-mod-battleflow'
      ? `Battle Flow ${m.version} (now By the Books)`
      : `By the Books ${m.version}`;
  return m.active ? name : `${name}, inactive`;
}

/**
 * Refuse a connection the scribe must not read through. Returns the refusal, or null to proceed.
 * Pure, so the rules are unit-tested rather than trusted to the live path.
 */
export function refusal(probe: WorldProbe, worldId: string | undefined): string | null {
  if (worldId && probe.worldId !== worldId) {
    return (
      `connected to world "${probe.worldId}" but campaign.json's worldId is "${worldId}": ` +
      'refusing to read another world into this campaign.'
    );
  }
  if (!probe.user.isGM) {
    return (
      `"${probe.user.name}" joined with role ${probe.user.role}: the scribe needs Assistant GM ` +
      '(3) to see whispers and By the Books’ GM cards.'
    );
  }
  if (probe.activeGM?.isSelf && probe.combatActive) {
    return (
      'the scribe is the elected GM while a combat is running, so By the Books’ GM-only ' +
      'automation would run on its page. Connect the DM’s client first, or end the combat.'
    );
  }
  return null;
}

/**
 * A join that failed because FOUNDRY_SCRIBE_USER is not a user in the world, told as such: the
 * user list and the fix. The join itself is fvtt-mcp-dnd5e's client, whose /join reads the user
 * list and throws naming the user (`User "X" not on /join. Available: [...]`); this matches any
 * wording that names the user as not there, so a reworded client error still lands here. Returns
 * null for every other failure, which the caller passes on unchanged.
 */
export function scribeUserMissing(
  message: string,
  ctx: { user: string; host: HostName; worldId?: string }
): string | null {
  const named = message.includes(`"${ctx.user}"`) || message.includes(`'${ctx.user}'`);
  if (!named || !/not (on|in|found)|unknown user|no such user|does not exist/i.test(message)) {
    return null;
  }
  const where = ctx.worldId ? `world '${ctx.worldId}'` : `the world on host '${ctx.host}'`;
  const users = listedUsers(message);
  return (
    `FOUNDRY_SCRIBE_USER '${ctx.user}' not found in ${where}` +
    (users.length ? `; users: ${users.join(', ')}` : '') +
    ' — set FOUNDRY_SCRIBE_USER to an existing Assistant GM (the bridge’s user will do), ' +
    'or create it as one.'
  );
}

/** The user names a join error lists after "Available:" / "users:", as JSON or comma-separated. */
function listedUsers(message: string): string[] {
  // the list ends at the line's end, or at the ` — <fix>` the dnd5e client appends after it
  const tail = /(?:available|users)\s*:\s*(.+?)(?:\s+—\s|$)/is.exec(message)?.[1]?.trim();
  if (!tail) return [];
  let names: unknown;
  try {
    names = JSON.parse(tail);
  } catch {
    names = tail.split(',');
  }
  return Array.isArray(names) ? names.map(n => String(n).trim()).filter(n => n.length > 0) : [];
}

/** Pull the one reply line out of the child's stdout. */
export function parseReply<T>(stdout: string): ReadResponse<T> | null {
  const lines = stdout.split(/\r?\n/).filter(l => l.startsWith(SENTINEL));
  const last = lines.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(last.slice(SENTINEL.length)) as ReadResponse<T>;
  } catch {
    return null;
  }
}
