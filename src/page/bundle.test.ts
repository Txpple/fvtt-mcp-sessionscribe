// The page bundle as it ships: built in memory with esbuild.page.mjs's options, then run in a vm
// against a fake Foundry. This proves the IIFE defines window.__scribe with no free references to
// Node or to module scope, and that every op answers a JSON string.

import * as vm from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

function fakeGame(over: Record<string, unknown> = {}) {
  const users = [
    { name: 'Gamemaster', role: 4, isGM: true, active: true },
    { name: 'Scribe Assistant', role: 3, isGM: true, active: true },
    { name: 'A Player', role: 1, isGM: false, active: true },
    { name: 'Offline GM', role: 4, isGM: true, active: false },
  ];
  const usersColl = Object.assign([...users], {
    activeGM: { name: 'Gamemaster', isSelf: false },
  });
  const modules = new Map([['fvtt-mod-bythebooks', { active: true, version: '3.0.0' }]]);
  return {
    world: { id: 'lost-mine', title: 'Lost Mine' },
    version: '14.368',
    system: { id: 'dnd5e', version: '6.0.3' },
    user: { name: 'Scribe Assistant', role: 3, isGM: true },
    users: usersColl,
    modules,
    combats: [{ started: false }],
    messages: { size: 42 },
    ...over,
  };
}

async function bundleSource(): Promise<string> {
  const out = await build({
    entryPoints: ['src/page/index.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    write: false,
  });
  return out.outputFiles[0]?.text ?? '';
}

describe('page bundle', () => {
  it('defines window.__scribe in a bare page context and answers JSON strings', async () => {
    const window: Record<string, any> = {};
    const context = vm.createContext({ window, game: fakeGame() });
    vm.runInContext(await bundleSource(), context);

    expect(Object.keys(window.__scribe).sort()).toEqual([
      'exportParty',
      'probe',
      'scanCombatStats',
      'scanSessionChat',
      'version',
    ]);
    expect(JSON.parse(await window.__scribe.version())).toBe(1);
    const probe = JSON.parse(await window.__scribe.probe());
    expect(probe).toEqual({
      worldId: 'lost-mine',
      worldTitle: 'Lost Mine',
      foundryVersion: '14.368',
      system: { id: 'dnd5e', version: '6.0.3' },
      user: { name: 'Scribe Assistant', role: 3, isGM: true },
      activeGM: { name: 'Gamemaster', isSelf: false },
      gmsConnected: [
        { name: 'Gamemaster', role: 4 },
        { name: 'Scribe Assistant', role: 3 },
      ],
      combatActive: false,
      bythebooks: { active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' },
      messageCount: 42,
    });
  });

  async function probeWith(modules: Map<string, { active: boolean; version: string }>) {
    const window: Record<string, any> = {};
    vm.runInContext(
      await bundleSource(),
      vm.createContext({ window, game: fakeGame({ modules }) })
    );
    return JSON.parse(await window.__scribe.probe()).bythebooks;
  }

  it('falls back to Battle Flow 2.x when By the Books is absent or inactive', async () => {
    const legacy = { active: true, version: '2.17.0' };
    expect(await probeWith(new Map([['fvtt-mod-battleflow', legacy]]))).toEqual({
      ...legacy,
      id: 'fvtt-mod-battleflow',
    });
    expect(
      await probeWith(
        new Map([
          ['fvtt-mod-bythebooks', { active: false, version: '3.0.0' }],
          ['fvtt-mod-battleflow', legacy],
        ])
      )
    ).toEqual({ ...legacy, id: 'fvtt-mod-battleflow' });
    // both installed, both off: the new one is reported, inactive
    expect(
      await probeWith(
        new Map([
          ['fvtt-mod-bythebooks', { active: false, version: '3.0.0' }],
          ['fvtt-mod-battleflow', { active: false, version: '2.17.0' }],
        ])
      )
    ).toEqual({ active: false, version: '3.0.0', id: 'fvtt-mod-bythebooks' });
    // both active (mid-upgrade): By the Books wins
    expect(
      await probeWith(
        new Map([
          ['fvtt-mod-bythebooks', { active: true, version: '3.0.0' }],
          ['fvtt-mod-battleflow', legacy],
        ])
      )
    ).toEqual({ active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' });
  });

  it('reports no By the Books, no elected GM and a running combat', async () => {
    const window: Record<string, any> = {};
    const game = fakeGame({ modules: new Map(), combats: [{ started: true }] });
    (game.users as any).activeGM = null;
    vm.runInContext(await bundleSource(), vm.createContext({ window, game }));
    const probe = JSON.parse(await window.__scribe.probe());
    expect(probe.bythebooks).toBeNull();
    expect(probe.activeGM).toBeNull();
    expect(probe.combatActive).toBe(true);
  });
});
