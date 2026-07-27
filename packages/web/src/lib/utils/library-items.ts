import type { TopTrackItem, TopArtistItem, TopAlbumItem, RankingMetric } from '@sis/shared';

export type ItemKind = 'artist' | 'album' | 'track';
export type EntityTab = 'artists' | 'tracks' | 'albums';

// forma común a la que se normaliza cualquier cosa de la biblioteca (top,
// búsqueda o discografía) para que los generators la traten igual
export interface LibraryItem {
  // `${kind}:${id}` — los ids de Spotify no chocan entre tipos, pero el
  // prefijo lo deja explícito y sirve de clave de deduplicación
  key: string;
  kind: ItemKind;
  id: string;
  name: string;
  subtitle: string;
  imageUrl: string | null;
  playCount: number;
  totalMs: number;
}

export const itemKey = (kind: ItemKind, id: string) => `${kind}:${id}`;

export function metricValue(item: LibraryItem, metric: RankingMetric): number {
  return metric === 'plays' ? item.playCount : item.totalMs;
}

// normaliza una entrada de /stats/top-* según la pestaña que la pidió
export function fromTopItem(raw: TopTrackItem | TopArtistItem | TopAlbumItem, tab: EntityTab): LibraryItem | null {
  if (tab === 'tracks') {
    const t = raw as TopTrackItem;
    if (!t.track) return null;
    return {
      key: itemKey('track', t.trackId), kind: 'track', id: t.trackId, name: t.track.name,
      subtitle: t.track.artists.map((a) => a.name).join(', '),
      imageUrl: t.track.album?.imageUrl ?? null, playCount: t.playCount, totalMs: t.totalMs,
    };
  }
  if (tab === 'artists') {
    const a = raw as TopArtistItem;
    if (!a.artist) return null;
    return {
      key: itemKey('artist', a.artistId), kind: 'artist', id: a.artistId, name: a.artist.name,
      subtitle: a.artist.genres[0] ?? '', imageUrl: a.artist.imageUrl,
      playCount: a.playCount, totalMs: a.totalMs,
    };
  }
  const al = raw as TopAlbumItem;
  if (!al.album) return null;
  return {
    key: itemKey('album', al.albumId), kind: 'album', id: al.albumId, name: al.album.name,
    subtitle: al.album.releaseDate?.slice(0, 4) ?? '', imageUrl: al.album.imageUrl,
    playCount: al.playCount, totalMs: al.totalMs,
  };
}
