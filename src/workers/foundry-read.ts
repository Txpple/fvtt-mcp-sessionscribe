// The one-shot reader: a child process per Foundry read, so the long-lived MCP server never holds
// a browser. It opens a scribe session (src/foundry/session.ts: the scribe's own user, admin key
// stripped, window.__scribe injected), probes, refuses per protocol.refusal(), runs one op, prints
// one reply line, hangs up, and exits. Its own watchdog makes a hung connect or dispose end the
// process: the guarantee is that no headless GM outlives the read.

import {
  DEFAULT_READ_TIMEOUT_MS,
  type ReadRequest,
  type ReadResponse,
  refusal,
  SENTINEL,
} from '../foundry/protocol.js';
import { openScribeSession, type ScribeSession } from '../foundry/session.js';
import type { WorldProbe } from '../page/probe.js';

function reply(res: ReadResponse): void {
  process.stdout.write(`${SENTINEL}${JSON.stringify(res)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const req = JSON.parse(await readStdin()) as ReadRequest;
  const timeoutMs = req.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const watchdog = setTimeout(() => {
    reply({
      ok: false,
      host: req.host,
      error:
        `the world could not be joined within the reader's ${timeoutMs / 1000} s budget: the join ` +
        'as the scribe never reached game.ready (or the read hung after it). Check FOUNDRY_URL in ' +
        "the bridge's .env — the path to the box may be slow or down (FOUNDRY_URL_FALLBACK names a " +
        'second one), the world asleep or not launched — then scribe-status { connect: true }.',
    });
    process.exit(3);
  }, timeoutMs);

  let session: ScribeSession | undefined;
  try {
    session = await openScribeSession(req.host, req.worldId ? { worldId: req.worldId } : {});
    const probe = await session.call<WorldProbe>('probe');
    const refused = refusal(probe, req.worldId);
    const readAt = new Date().toISOString();
    if (refused) {
      reply({ ok: false, host: req.host, readAt, probe, error: refused });
    } else {
      const result = req.op === 'probe' ? undefined : await session.call(req.op, req.args);
      reply({ ok: true, host: req.host, readAt, probe, result });
    }
  } catch (e) {
    reply({ ok: false, host: req.host, error: e instanceof Error ? e.message : String(e) });
  } finally {
    await session?.dispose();
    clearTimeout(watchdog);
    process.exit(0);
  }
}

void main();
