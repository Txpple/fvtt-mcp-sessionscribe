// scribe-status: cold-start diagnosability and the state of the record. Is every piece of the
// pipeline usable on this machine, is the campaign repo wired and valid, is the scribe's own
// Foundry login configured (and, with `connect`, does it actually get into the right world), and
// what does each session directory hold against today's `sessions.outputs`.

import { z } from 'zod';
import { loadCampaign } from '../campaign.js';
import { HOSTS } from '../config.js';
import type { WorldReader } from '../foundry/read.js';
import {
  type HealthDeps,
  probeCampaignRepo,
  probeEdge,
  probeFfmpeg,
  probeIdentity,
  probePython,
  probeTar,
} from '../health.js';
import { isActive, listJobs, waitForJobs } from '../jobs.js';
import { recordDetail, recordSummary } from '../record.js';
import { toInputSchema } from '../utils/schema.js';

export const hostSchema = z
  .enum(HOSTS)
  .optional()
  .describe('Which Foundry: molten (prod) or local (the sandbox). Default: the registration’s.');

const statusSchema = z.object({
  date: z
    .string()
    .optional()
    .describe('One session in full (YYYY-MM-DD or its directory name); default: every session.'),
  connect: z
    .boolean()
    .default(false)
    .describe('Also join Foundry as the scribe and report the world, the GMs and By the Books.'),
  host: hostSchema,
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(300)
    .default(0)
    .describe(
      "With date: wait up to this long for the session's fetch / transcribe jobs to finish."
    ),
});

export type StatusDeps = HealthDeps & { reader: WorldReader };

export class StatusTool {
  constructor(private readonly deps: StatusDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'scribe-status',
        description:
          'Health check and the state of the record: transcription Python, ffmpeg, tar, the PDF ' +
          "browser, the campaign repo, the scribe's Foundry login (connect: true joins to prove " +
          "it); then per session which of the campaign's outputs, pipeline files and party " +
          'snapshot exist. Call first on a cold start.',
        inputSchema: toInputSchema(statusSchema),
      },
    ];
  }

  async handleStatus(args: unknown) {
    const { date, connect, host, waitSeconds } = statusSchema.parse(args);
    const [python, ffmpeg, tar] = await Promise.all([
      probePython(this.deps),
      probeFfmpeg(this.deps),
      probeTar(this.deps),
    ]);
    const checks = {
      python,
      ffmpeg,
      tar,
      edge: probeEdge(this.deps),
      campaignRepo: probeCampaignRepo(this.deps),
      identity: probeIdentity(this.deps),
    };
    const record = await this.record(date, waitSeconds);
    return {
      ready: Object.values(checks).every(c => c.ok),
      defaultHost: this.deps.config.defaultHost,
      checks,
      ...(connect ? { world: await this.world(host ?? this.deps.config.defaultHost) } : {}),
      ...record,
    };
  }

  private async world(host: (typeof HOSTS)[number]) {
    let worldId: string | undefined;
    try {
      worldId = loadCampaign(this.deps.config.campaignRepo).worldId;
    } catch {
      // No campaign to check against: still worth proving the login itself.
    }
    const r = await this.deps.reader({ op: 'probe', host, ...(worldId ? { worldId } : {}) });
    return {
      ok: r.ok,
      host: r.host,
      ...(r.readAt ? { readAt: r.readAt } : {}),
      ...(r.probe ? { probe: r.probe } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
  }

  private async record(date: string | undefined, waitSeconds: number) {
    try {
      const campaign = loadCampaign(this.deps.config.campaignRepo);
      if (date) {
        const detail = recordDetail(campaign, date);
        const jobs = waitSeconds
          ? await waitForJobs(detail.path, waitSeconds)
          : listJobs(detail.path);
        // Re-read after a wait: a finished job has written files.
        return { session: { ...(waitSeconds ? recordDetail(campaign, date) : detail), jobs } };
      }
      const sessions = recordSummary(campaign).map(s => {
        const active = listJobs(`${campaign.sessionsDir}/${s.dir}`).filter(isActive);
        return active.length ? { ...s, jobs: active.map(j => `${j.kind} ${j.state}`) } : s;
      });
      return {
        record: {
          campaign: campaign.name,
          worldId: campaign.worldId,
          outputs: campaign.sessions.outputs,
          pdf: campaign.sessions.pdf,
          sessions,
        },
      };
    } catch (e) {
      return { recordError: e instanceof Error ? e.message : String(e) };
    }
  }
}
