import { describe, it, expect } from 'vitest';
import { mbRecordingQuery, sameTitle } from '@sis/shared';

// títulos reales que, sin citar, la búsqueda /recording leía como sintaxis lucene
// y devolvía otro tema con score 100 (el reconciliador de identity.ts lo aceptaba
// y el merge físico se llevaba las plays a un tema que no era)
describe('mbRecordingQuery', () => {
  it('cita título y artista como frases', () => {
    expect(mbRecordingQuery('One Way/Stolen Dance', 'Twenty One Pilots'))
      .toBe('recording:"One Way/Stolen Dance" AND artist:"Twenty One Pilots"');
  });

  it('conserva paréntesis y comas dentro de la frase', () => {
    expect(mbRecordingQuery('Murder, Murder (Remix)', 'Eminem'))
      .toBe('recording:"Murder, Murder (Remix)" AND artist:"Eminem"');
  });

  it('escapa comillas y barras invertidas, lo único especial dentro de una frase', () => {
    expect(mbRecordingQuery('Say "Hi" \\ Bye', 'A"B'))
      .toBe('recording:"Say \\"Hi\\" \\\\ Bye" AND artist:"A\\"B"');
  });
});

describe('sameTitle', () => {
  it.each([
    ['Doubt (Demo)', 'Doubt (demo)'],
    ['The Run And Go', 'The Run and Go'],
    ['Canción', 'Cancion'],
    ['Murder Murder', 'Murder, Murder'],
    ['  Trees ', 'Trees'],
  ])('%s = %s', (a, b) => {
    expect(sameTitle(a, b)).toBe(true);
  });

  // los merges equivocados de 2026-08: el hit de musicbrainz no era nuestro tema
  it.each([
    ['One Way/Stolen Dance', 'The Contract'],
    ['Tally/Believe', 'Tally'],
    ['Jumpsuit/City Walls', 'City Walls'],
    ['House Of Gold (Demo)', 'Doubt (demo)'],
    ['Murder, Murder (Remix)', 'Murder Murder'],
    ["Shy Away / I'm Not Okay (Live)", 'Shy Away'],
    ['Intro / Overcompensate', 'Overcompensate'],
  ])('%s ≠ %s', (a, b) => {
    expect(sameTitle(a, b)).toBe(false);
  });
});
