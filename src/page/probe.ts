// The first read of every connection: which world this is, who the scribe joined as, and who
// holds the GM election. The reader child refuses on its answer before any other op runs: a world
// other than campaign.json's `worldId`, or the scribe being the elected GM while a combat runs
// (By the Books, Battle Flow until 3.0.0, gates its GM-only automation on
// `game.users.activeGM?.isSelf`, so an elected scribe page would run it).

export interface WorldProbe {
  worldId: string;
  worldTitle: string;
  foundryVersion: string;
  system: { id: string; version: string };
  user: { name: string; role: number; isGM: boolean };
  activeGM: { name: string; isSelf: boolean } | null;
  gmsConnected: Array<{ name: string; role: number }>;
  combatActive: boolean;
  /** By the Books, or Battle Flow 2.x on a table that has not upgraded: `id` says which. */
  bythebooks: { active: boolean; version: string; id: string } | null;
  messageCount: number;
}

export function probe(): WorldProbe {
  const users = [...game.users] as any[];
  const active = game.users.activeGM;
  const btb = findByTheBooks();
  return {
    worldId: String(game.world.id),
    worldTitle: String(game.world.title ?? ''),
    foundryVersion: String(game.version),
    system: { id: String(game.system.id), version: String(game.system.version) },
    user: { name: game.user.name, role: game.user.role, isGM: Boolean(game.user.isGM) },
    activeGM: active ? { name: active.name, isSelf: Boolean(active.isSelf) } : null,
    gmsConnected: users.filter(u => u.active && u.isGM).map(u => ({ name: u.name, role: u.role })),
    combatActive: [...game.combats].some((c: any) => Boolean(c.started)),
    bythebooks: btb,
    messageCount: game.messages.size,
  };
}

const BTB_ID = 'fvtt-mod-bythebooks';
const LEGACY_BF_ID = 'fvtt-mod-battleflow';

/**
 * By the Books if it is installed and active; otherwise Battle Flow (its id before 3.0.0), so a
 * table still on 2.x reports what it runs; otherwise whichever of the two is installed but
 * inactive (the new one first); null when neither is.
 */
function findByTheBooks(): WorldProbe['bythebooks'] {
  const report = (id: string) => {
    const m = game.modules.get(id);
    return m ? { active: Boolean(m.active), version: String(m.version ?? ''), id } : null;
  };
  const fresh = report(BTB_ID);
  if (fresh?.active) return fresh;
  const legacy = report(LEGACY_BF_ID);
  if (legacy?.active) return legacy;
  return fresh ?? legacy;
}
