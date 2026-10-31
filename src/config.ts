// Env/config loader. Loads .env from the repo root regardless of the launch cwd (Claude Code may
// start the server from anywhere), then resolves everything once so the rest of the code never
// touches process.env. Foundry host URLs and the admin key are deliberately NOT here: they belong
// to fvtt-mcp-dnd5e's .env and reach the reader child through that repo's client library.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// dist/config.js → repo root is one level up. (src/config.ts sees the same shape under vitest.)
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

export const HOSTS = ['generic', 'molten', 'local'] as const;
export type HostName = (typeof HOSTS)[number];

export interface Config {
  server: { name: string; version: string };
  /** The scribe's own Foundry user. Empty when unset; tools report that instead of crashing. */
  scribeUser: string;
  scribePassword: string;
  /** The campaign repo the record is written to. Empty when unset. */
  campaignRepo: string;
  /** Python with faster-whisper, built by scripts/setup.ps1. */
  python: string;
  /** Headless browser for PDF rendering. */
  edge: string;
  /** Windows' bsdtar: reads zip and refuses `../` entries. */
  tar: string;
  /** Default host for Foundry reads; every read tool can override it per call. */
  defaultHost: HostName;
}

/** Expand `%VAR%` (the way the .env.example writes paths) and a leading `~`. */
export function expandPath(p: string, env: NodeJS.ProcessEnv): string {
  const expanded = p.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole);
  return expanded.startsWith('~') ? path.join(os.homedir(), expanded.slice(1)) : expanded;
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const host = (env.FOUNDRY_HOST ?? 'generic').toLowerCase();
  const systemRoot = env.SystemRoot ?? 'C:\\Windows';
  return {
    server: { name: 'fvtt-mcp-sessionscribe', version: readPackageVersion() },
    scribeUser: env.FOUNDRY_SCRIBE_USER ?? '',
    scribePassword: env.FOUNDRY_SCRIBE_PASSWORD ?? '',
    campaignRepo: env.SCRIBE_CAMPAIGN_REPO ? expandPath(env.SCRIBE_CAMPAIGN_REPO, env) : '',
    python: expandPath(
      env.SCRIBE_PYTHON ??
        path.join(os.homedir(), '.session-scribe', 'venv', 'Scripts', 'python.exe'),
      env
    ),
    edge: expandPath(
      env.SCRIBE_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      env
    ),
    tar: path.join(systemRoot, 'System32', 'tar.exe'),
    defaultHost: (HOSTS as readonly string[]).includes(host) ? (host as HostName) : 'generic',
  };
}

export const config = loadConfig(process.env);
