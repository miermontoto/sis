import { describe, it, expect } from 'vitest';
import { itunesPreorders, itunesTracks, parseSpotifyAlbumId, upcomingContains, type FoldRelease, type FoldTrack } from '@sis/shared';

const DAY_MS = 24 * 60 * 60_000;
const OPTS = { maxLeadMs: 730 * DAY_MS, durationToleranceMs: 5_000 };

const track = (id: string, key: string, durationMs: number): FoldTrack => ({ id, key, durationMs, isrc: null });
const single = (id: string, releaseDate: string, tracks: FoldTrack[]): FoldRelease => ({ id, releaseDate, tracks });

// Leoniden, "if you say forever one more time, i'll remind you that we die" (2027-01-01):
// así lo dieron spotify (los cuatro singles ya publicados, con su id) y la preventa de
// iTunes (los dieciséis temas por nombre y duración) el 2026-11-16
const fromSpotify = {
  releaseDate: '2027-01-01',
  tracks: [
    track('5iwm4NhW5EFIQiHUVueT9j', 'f.u.b.a.r.', 168_917),
    track('3L2zEAUmr9sSowmcD6qwWx', 'choking on dir✞', 177_330),
    track('7FkC676BbveJCphuyye8Gk', 'umami', 116_193),
    track('72RYlFVBQvEHzvUuVUZQp0', 'i still feel', 184_168),
  ],
};
const fromItunes = {
  releaseDate: '2027-01-01',
  tracks: [
    track('', 'intro (welcome)', 62_475),
    track('', 'f.u.b.a.r.', 168_917),
    track('', 'umami', 116_193),
    track('', 'i still feel', 184_169),
  ],
};

const fubar = single('103VL1OV204g6xleNmS2MC', '2026-10-30', [track('5iwm4NhW5EFIQiHUVueT9j', 'f.u.b.a.r.', 168_917)]);
const stillFeel = single('5Cnw6bG9KLKJUiCsQpSbgV', '2026-06-05', [track('72RYlFVBQvEHzvUuVUZQp0', 'i still feel', 184_168)]);
// single de febrero que no está en el disco: sigue siendo un lanzamiento propio
const leereWorte = single('6bbRgY24yo7JVP932em24f', '2026-02-06', [track('leere', 'leere worte', 201_000)]);

describe('parseSpotifyAlbumId', () => {
  it('saca el id de un enlace compartido, con su ?si=', () => {
    expect(parseSpotifyAlbumId('https://open.spotify.com/album/4QbCCXywFerRC0Gae7HnUD?si=5e26d24d1fa741a5')).toBe('4QbCCXywFerRC0Gae7HnUD');
  });

  it('acepta el prefijo de idioma, la uri y el id pelado', () => {
    expect(parseSpotifyAlbumId('https://open.spotify.com/intl-es/album/4QbCCXywFerRC0Gae7HnUD')).toBe('4QbCCXywFerRC0Gae7HnUD');
    expect(parseSpotifyAlbumId('spotify:album:4QbCCXywFerRC0Gae7HnUD')).toBe('4QbCCXywFerRC0Gae7HnUD');
    expect(parseSpotifyAlbumId('  4QbCCXywFerRC0Gae7HnUD ')).toBe('4QbCCXywFerRC0Gae7HnUD');
  });

  it('rechaza un enlace de tema, de prerelease o cualquier otra cosa', () => {
    expect(parseSpotifyAlbumId('https://open.spotify.com/track/5iwm4NhW5EFIQiHUVueT9j')).toBeNull();
    expect(parseSpotifyAlbumId('https://open.spotify.com/prerelease/4ayL32frKH4LCr9QohSgW5')).toBeNull();
    expect(parseSpotifyAlbumId('https://evil.example/album/4QbCCXywFerRC0Gae7HnUD')).toBeNull();
    expect(parseSpotifyAlbumId('leoniden')).toBeNull();
  });
});

describe('upcomingContains', () => {
  it('casa por id lo que dio spotify', () => {
    expect(upcomingContains(fubar, fromSpotify, OPTS)).toBe(true);
    // aunque el nombre del single difiera: el id es la prueba
    expect(upcomingContains(single('x', '2026-10-30', [track('5iwm4NhW5EFIQiHUVueT9j', 'fubar (radio)', 1)]), fromSpotify, OPTS)).toBe(true);
  });

  it('casa por nombre + duración lo que dio iTunes', () => {
    expect(upcomingContains(fubar, fromItunes, OPTS)).toBe(true);
    expect(upcomingContains(stillFeel, fromItunes, OPTS)).toBe(true);
  });

  it('no casa el mismo nombre con otra duración: otra grabación', () => {
    const radioEdit = single('r', '2026-10-30', [track('r1', 'f.u.b.a.r.', 140_000)]);
    expect(upcomingContains(radioEdit, fromItunes, OPTS)).toBe(false);
  });

  it('deja fuera un single que el disco no lleva', () => {
    expect(upcomingContains(leereWorte, fromItunes, OPTS)).toBe(false);
  });

  it('exige TODOS los temas del single: un B-side lo deja fuera', () => {
    const withBside = single('b', '2026-10-30', [...fubar.tracks, track('b2', 'f.u.b.a.r. (b-side)', 150_000)]);
    expect(upcomingContains(withBside, fromItunes, OPTS)).toBe(false);
  });

  it('respeta la ventana de adelanto', () => {
    const tooOld = single('o', '2024-06-05', stillFeel.tracks);
    expect(upcomingContains(tooOld, fromSpotify, OPTS)).toBe(false);
  });

  it('un tema sin duración no casa por nombre', () => {
    const unknown = single('u', '2026-09-11', [track('u1', 'umami', 0)]);
    expect(upcomingContains(unknown, fromItunes, OPTS)).toBe(false);
  });
});

describe('itunesPreorders', () => {
  const results = [
    { wrapperType: 'collection', collectionType: 'Album', collectionId: 6784131190, collectionName: "if you say forever one more time, i'll remind you that we die", artistName: 'Leoniden', releaseDate: '2027-01-01T08:00:00Z', trackCount: 16 },
    { wrapperType: 'collection', collectionType: 'Album', collectionId: 6800624658, collectionName: 'f.u.b.a.r. - Single', artistName: 'Leoniden', releaseDate: '2027-01-01T08:00:00Z', trackCount: 1 },
    { wrapperType: 'collection', collectionType: 'Album', collectionId: 1, collectionName: 'Sophisticated Sad Songs', artistName: 'Leoniden', releaseDate: '2024-08-23T07:00:00Z', trackCount: 12 },
    { wrapperType: 'collection', collectionType: 'Album', collectionId: 2, collectionName: 'Live EP - EP', artistName: 'Leoniden', releaseDate: '2027-02-01T08:00:00Z', trackCount: 4 },
    { wrapperType: 'collection', collectionType: 'Album', collectionId: 3, collectionName: 'Split', artistName: 'Leoniden & Friends', releaseDate: '2027-03-01T08:00:00Z', trackCount: 8 },
  ];

  it('sólo los álbumes del artista que aún no han salido', () => {
    expect(itunesPreorders(results, 'LEONIDEN', '2026-11-16')).toEqual([
      { collectionId: '6784131190', name: "if you say forever one more time, i'll remind you that we die", releaseDate: '2027-01-01' },
    ]);
  });

  it('ya salido no cuenta', () => {
    expect(itunesPreorders(results, 'Leoniden', '2027-01-01')).toEqual([]);
  });
});

describe('itunesTracks', () => {
  it('ordena por disco y número y se queda con nombre y duración', () => {
    expect(itunesTracks([
      { wrapperType: 'collection', collectionName: 'x' },
      { wrapperType: 'track', trackName: 'f.u.b.a.r.', trackTimeMillis: 168_917, discNumber: 1, trackNumber: 2 },
      { wrapperType: 'track', trackName: 'intro (welcome)', trackTimeMillis: 62_475, discNumber: 1, trackNumber: 1 },
    ])).toEqual([
      { name: 'intro (welcome)', durationMs: 62_475 },
      { name: 'f.u.b.a.r.', durationMs: 168_917 },
    ]);
  });
});
