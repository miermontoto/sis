import { describe, it, expect } from 'vitest';
import { embedTrackIds, itunesPreorders, itunesTracks, parseSpotifyAlbumId, parseSpotifyPrereleaseId, upcomingMatch, type FoldRelease, type FoldTrack } from '@sis/shared';

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

// La Casa Azul, "Fauna Subacuática": la Countdown Page que se pegó el 2026-11-17
const COUNTDOWN = 'https://open.spotify.com/prerelease/2ahJQ3ExK2xGJREA0fb7RQ?si=0f1a5d2e76574ac5';

describe('parseSpotifyPrereleaseId', () => {
  it('saca el id de una Countdown Page compartida, con prefijo de idioma o como embed', () => {
    expect(parseSpotifyPrereleaseId(COUNTDOWN)).toBe('2ahJQ3ExK2xGJREA0fb7RQ');
    expect(parseSpotifyPrereleaseId('https://open.spotify.com/intl-es/prerelease/2ahJQ3ExK2xGJREA0fb7RQ')).toBe('2ahJQ3ExK2xGJREA0fb7RQ');
    expect(parseSpotifyPrereleaseId('https://open.spotify.com/embed/prerelease/2ahJQ3ExK2xGJREA0fb7RQ?utm_source=oembed')).toBe('2ahJQ3ExK2xGJREA0fb7RQ');
  });

  it('no confunde un álbum (ni el id pelado, que es de álbum) con una countdown', () => {
    expect(parseSpotifyAlbumId(COUNTDOWN)).toBeNull();
    expect(parseSpotifyPrereleaseId('https://open.spotify.com/album/4QbCCXywFerRC0Gae7HnUD')).toBeNull();
    expect(parseSpotifyPrereleaseId('2ahJQ3ExK2xGJREA0fb7RQ')).toBeNull();
    expect(parseSpotifyPrereleaseId('https://evil.example/prerelease/2ahJQ3ExK2xGJREA0fb7RQ')).toBeNull();
  });
});

describe('embedTrackIds', () => {
  it('lista los temas del embed en orden y sin repetir', () => {
    const html = '<script>{"uri":"spotify:track:1C30TVLT268GzCtCgLYnwq"},{"uri":"spotify:track:3cYHfPJ7wBGqiet1ECXb6F"},'
      + '{"uri":"spotify:track:1C30TVLT268GzCtCgLYnwq"},{"artist":"spotify:artist:2Ynst7DZrEJnlaMM41ZCxd"}</script>';
    expect(embedTrackIds(html)).toEqual(['1C30TVLT268GzCtCgLYnwq', '3cYHfPJ7wBGqiet1ECXb6F']);
    expect(embedTrackIds('<html>sin temas</html>')).toEqual([]);
  });
});

const RELEASE = { kind: 'release' } as const;

describe('upcomingMatch', () => {
  it('casa por id lo que dio spotify', () => {
    expect(upcomingMatch(fubar, 1, fromSpotify, OPTS)).toEqual(RELEASE);
    // aunque el nombre del single difiera: el id es la prueba
    expect(upcomingMatch(single('x', '2026-10-30', [track('5iwm4NhW5EFIQiHUVueT9j', 'fubar (radio)', 1)]), 1, fromSpotify, OPTS)).toEqual(RELEASE);
  });

  it('casa por nombre + duración lo que dio iTunes', () => {
    expect(upcomingMatch(fubar, 1, fromItunes, OPTS)).toEqual(RELEASE);
    expect(upcomingMatch(stillFeel, 1, fromItunes, OPTS)).toEqual(RELEASE);
  });

  it('no casa el mismo nombre con otra duración: otra grabación', () => {
    const radioEdit = single('r', '2026-10-30', [track('r1', 'f.u.b.a.r.', 140_000)]);
    expect(upcomingMatch(radioEdit, 1, fromItunes, OPTS)).toBeNull();
  });

  it('deja fuera un single que el disco no lleva', () => {
    expect(upcomingMatch(leereWorte, 1, fromItunes, OPTS)).toBeNull();
  });

  it('de un EP con canciones de fuera entran sólo los temas compartidos', () => {
    // La Casa Azul, "Ahora O Nunca" (2024): dos de sus cuatro temas van en el disco de 2026
    const fauna = { releaseDate: '2026-11-27', tracks: [track('', 'prometo no olvidar', 194_571), track('', 'entra en mi vida', 218_117), track('', 'lo profundo', 200_000)] };
    const ep = single('ahora', '2024-09-24', [
      track('ahora-1', 'ahora o nunca', 201_032), track('ahora-2', 'prometo no olvidar', 194_571),
      track('ahora-3', 'no hay futuro', 209_132), track('ahora-4', 'entra en mi vida', 218_117),
    ]);
    expect(upcomingMatch(ep, 4, fauna, OPTS)).toEqual({ kind: 'tracks', trackIds: ['ahora-2', 'ahora-4'] });
  });

  it('con el tracklist del single a medias sólo entran sus temas, no el lanzamiento', () => {
    expect(upcomingMatch(fubar, 3, fromItunes, OPTS)).toEqual({ kind: 'tracks', trackIds: ['5iwm4NhW5EFIQiHUVueT9j'] });
  });

  it('no tiene ventana de adelanto: es la misma grabación (single de 2021, disco de 2026)', () => {
    const entra = single('entra', '2021-03-10', [track('entra-1', 'entra en mi vida', 218_117)]);
    const fauna = { releaseDate: '2026-11-27', tracks: [track('', 'entra en mi vida', 218_117)] };
    expect(upcomingMatch(entra, 1, fauna, OPTS)).toEqual(RELEASE);
  });

  it('un álbum anterior al single no es al que adelanta', () => {
    expect(upcomingMatch(single('late', '2027-03-01', fubar.tracks), 1, fromItunes, OPTS)).toBeNull();
  });

  it('un tema sin duración no casa por nombre', () => {
    const unknown = single('u', '2026-09-11', [track('u1', 'umami', 0)]);
    expect(upcomingMatch(unknown, 1, fromItunes, OPTS)).toBeNull();
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
