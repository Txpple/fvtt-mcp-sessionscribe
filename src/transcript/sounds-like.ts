// The campaign's sound-alike guide, `sessions.soundsLike` in campaign.json: each name as the
// campaign spells it → what whisper writes when it hears it ("Aldric" → ["Aldrich"]). A table says
// a name its own way, and the hotwords cannot carry a pronunciation, so a name that sounds like a
// common one keeps coming out as that one. build-transcript respells the speech with it, so a new
// entry needs a rebuild (seconds), never a re-transcription, and transcript-segments.json stays
// whisper's own words.

export type SoundsLike = Record<string, string[]>;

interface Rule {
  name: string;
  pattern: RegExp;
}

export const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One whole-word, case-insensitive pattern per heard form, the longest first so "See Sil" wins
 * over "Sil". Words in a form match across any spaces or hyphens ("Al-dric", "Al dric").
 */
function rules(guide: SoundsLike): Rule[] {
  const out: Rule[] = [];
  for (const [name, heard] of Object.entries(guide)) {
    for (const form of heard) {
      const words = form
        .trim()
        .split(/[\s-]+/)
        .filter(Boolean);
      if (!words.length || form.trim().toLowerCase() === name.toLowerCase()) continue;
      const body = words.map(literal).join('[\\s-]+');
      out.push({
        name,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'),
      });
    }
  }
  return out.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

/**
 * Respell every track's speech with the guide. Returns the segments to align and how many times
 * each name was put right, for the tool's report.
 */
export function respell<T extends { tracks: Array<{ segments: Array<{ text: string }> }> }>(
  segs: T,
  guide: SoundsLike | undefined
): { segs: T; respelled: Record<string, number> } {
  const respelled: Record<string, number> = {};
  if (!guide || !Object.keys(guide).length) return { segs, respelled };
  const rs = rules(guide);
  const fix = (text: string) =>
    rs.reduce(
      (t, r) =>
        t.replace(r.pattern, () => {
          respelled[r.name] = (respelled[r.name] ?? 0) + 1;
          return r.name;
        }),
      text
    );
  return {
    segs: {
      ...segs,
      tracks: segs.tracks.map(track => ({
        ...track,
        segments: track.segments.map(s => ({ ...s, text: fix(s.text) })),
      })),
    },
    respelled,
  };
}
