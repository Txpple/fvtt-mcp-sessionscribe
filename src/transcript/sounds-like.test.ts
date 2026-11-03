import { describe, expect, it } from 'vitest';
import { respell } from './sounds-like.js';

const segs = (...texts: string[]) => ({
  model: 'm',
  tracks: [{ speaker: 'DM', segments: texts.map((text, i) => ({ start: i, end: i + 1, text })) }],
});

describe('respell', () => {
  it('puts each heard form right, whole words only, any case, possessives kept', () => {
    const out = respell(
      segs('Aldrich, roll it.', "aldrich's axe", 'Aldrichton is far.', 'ALDRICH!'),
      { Aldric: ['Aldrich'] }
    );
    expect(out.segs.tracks[0]?.segments.map(s => s.text)).toEqual([
      'Aldric, roll it.',
      "Aldric's axe",
      'Aldrichton is far.',
      'Aldric!',
    ]);
    expect(out.respelled).toEqual({ Aldric: 3 });
  });

  it('matches a several-word form across spaces or hyphens, the longest form first', () => {
    const out = respell(segs('See Sil hides.', 'see-sil and Sil'), {
      Seasil: ['See Sil'],
      Brenna: ['Sil'],
    });
    expect(out.segs.tracks[0]?.segments.map(s => s.text)).toEqual([
      'Seasil hides.',
      'Seasil and Brenna',
    ]);
    expect(out.respelled).toEqual({ Seasil: 2, Brenna: 1 });
  });

  it('treats regex characters literally and leaves the input and an empty guide alone', () => {
    const input = segs('Is it Dara (the Vale)?', 'Dara.');
    expect(respell(input, { Dara: ['(the Vale)'] }).segs.tracks[0]?.segments[0]?.text).toBe(
      'Is it Dara Dara?'
    );
    expect(input.tracks[0]?.segments[0]?.text).toBe('Is it Dara (the Vale)?');
    expect(respell(input, undefined)).toEqual({ segs: input, respelled: {} });
    expect(respell(input, { Dara: ['dara'] }).respelled).toEqual({});
  });
});
