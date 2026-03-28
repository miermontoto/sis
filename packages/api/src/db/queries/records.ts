import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { resolvedAlbumId, mergeRulesJoin } from './helpers.js';
import { CHART_SIZE } from '../../constants.js';

type Sort = 'plays' | 'time';
type WeekStart = 'monday' | 'sunday' | 'friday';

// formato de semana según día de inicio
// SQLite %W = semana empezando lunes (00-53)
// Para alinear otros días de inicio, desplazamos la fecha antes de calcular %W
function weekExpr(ws: WeekStart) {
  if (ws === 'monday') return sql`strftime('%Y-W%W', lh.played_at)`;
  if (ws === 'sunday') return sql`strftime('%Y-W%W', lh.played_at, '-1 day')`;
  // friday (Billboard): restar 4 días para que viernes se alinee con lunes
  return sql`strftime('%Y-W%W', lh.played_at, '-4 days')`;
}

interface RecordEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  value: number;
  week: string | null;
}

interface ArtistRecordEntry {
  artistId: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

interface EntityRecords {
  peakWeekPlays: RecordEntry[];
  biggestDebuts: RecordEntry[];
  mostWeeksAtNo1: RecordEntry[];
  mostWeeksInTop5: RecordEntry[];
}

interface ArtistRecords extends EntityRecords {
  mostNo1Tracks: ArtistRecordEntry[];
  mostNo1Albums: ArtistRecordEntry[];
}

export interface RecordsResponse {
  tracks: EntityRecords;
  albums: EntityRecords;
  artists: ArtistRecords;
}

// --- queries de records por tipo de entidad ---

function getTrackRecords(db: Db, ws: WeekStart, sort: Sort, limit: number): EntityRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

  // weekly rankings CTE
  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, lh.track_id as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      GROUP BY w, lh.track_id
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           t.name, al.image_url,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = w.eid AND ta.position = 0 LIMIT 1) as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN tracks t ON t.spotify_id = w.eid
    LEFT JOIN albums al ON al.spotify_id = t.album_id
  `) as any[];

  return deriveRecords(ranked, limit);
}

function getAlbumRecords(db: Db, ws: WeekStart, sort: Sort, limit: number): EntityRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, ${resolvedAlbumId} as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mergeRulesJoin}
      WHERE t.album_id IS NOT NULL
      GROUP BY w, eid
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           al.name, al.image_url,
           (SELECT a.name FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE t2.album_id = w.eid LIMIT 1) as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN albums al ON al.spotify_id = w.eid
  `) as any[];

  return deriveRecords(ranked, limit);
}

function getArtistRecords(db: Db, ws: WeekStart, sort: Sort, limit: number): ArtistRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, ta.artist_id as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      JOIN tracks t ON t.spotify_id = lh.track_id
      GROUP BY w, ta.artist_id
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           a.name, a.image_url, NULL as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN artists a ON a.spotify_id = w.eid
  `) as any[];

  const base = deriveRecords(ranked, limit);

  // artistas con más tracks en #1 (por semana)
  const trackWeek = weekExpr(ws);
  const trackMetric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

  const mostNo1Tracks = db.all(sql`
    WITH weekly_tracks AS (
      SELECT ${trackWeek} as w, lh.track_id as tid, ${trackMetric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${trackWeek} ORDER BY ${trackMetric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      GROUP BY w, lh.track_id
    )
    SELECT ta.artist_id as artistId, a.name, a.image_url as imageUrl, COUNT(DISTINCT wt.tid) as count
    FROM weekly_tracks wt
    JOIN track_artists ta ON ta.track_id = wt.tid AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE wt.rank = 1
    GROUP BY ta.artist_id
    ORDER BY count DESC
    LIMIT ${limit}
  `) as ArtistRecordEntry[];

  const mostNo1Albums = db.all(sql`
    WITH weekly_albums AS (
      SELECT ${trackWeek} as w, ${resolvedAlbumId} as aid, ${trackMetric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${trackWeek} ORDER BY ${trackMetric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mergeRulesJoin}
      WHERE t.album_id IS NOT NULL
      GROUP BY w, aid
    )
    SELECT ta.artist_id as artistId, a.name, a.image_url as imageUrl, COUNT(DISTINCT wa.aid) as count
    FROM weekly_albums wa
    JOIN tracks t2 ON t2.album_id = wa.aid
    JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE wa.rank = 1
    GROUP BY ta.artist_id
    ORDER BY count DESC
    LIMIT ${limit}
  `) as ArtistRecordEntry[];

  return {
    ...base,
    mostNo1Tracks,
    mostNo1Albums,
  };
}

// --- helper: derivar records desde filas de ranking semanal ---

function deriveRecords(rows: any[], limit: number): EntityRecords {
  // agrupar por entidad
  const byEntity = new Map<string, { rows: any[]; debutWeek: string; name: string; imageUrl: string | null; artistName: string | null }>();
  for (const r of rows) {
    if (!byEntity.has(r.eid)) {
      byEntity.set(r.eid, { rows: [], debutWeek: r.debut_week, name: r.name, imageUrl: r.image_url, artistName: r.artist_name });
    }
    byEntity.get(r.eid)!.rows.push(r);
  }

  // 1. Peak week plays
  const peakWeekPlays: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const best = data.rows.reduce((a: any, b: any) => a.val > b.val ? a : b);
    peakWeekPlays.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistName: data.artistName, value: best.val, week: best.w });
  }
  peakWeekPlays.sort((a, b) => b.value - a.value);

  // 2. Biggest debuts
  const biggestDebuts: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const debut = data.rows.find((r: any) => r.w === data.debutWeek);
    if (debut) {
      biggestDebuts.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistName: data.artistName, value: debut.val, week: debut.w });
    }
  }
  biggestDebuts.sort((a, b) => b.value - a.value);

  // 3. Most weeks at #1
  const mostWeeksAtNo1: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r: any) => r.rank === 1).length;
    if (weeks > 0) {
      mostWeeksAtNo1.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksAtNo1.sort((a, b) => b.value - a.value);

  // 4. Most weeks in the charts (top 25)
  const mostWeeksInTop5: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r: any) => r.rank <= CHART_SIZE).length;
    if (weeks > 0) {
      mostWeeksInTop5.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksInTop5.sort((a, b) => b.value - a.value);

  return {
    peakWeekPlays: peakWeekPlays.slice(0, limit),
    biggestDebuts: biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: mostWeeksAtNo1.slice(0, limit),
    mostWeeksInTop5: mostWeeksInTop5.slice(0, limit),
  };
}

// --- función principal ---

export type EntityTypeFilter = 'tracks' | 'albums' | 'artists';

export function getRecords(db: Db, weekStart: WeekStart = 'monday', sort: Sort = 'time', limit = 10, type?: EntityTypeFilter): Partial<RecordsResponse> {
  if (type === 'tracks') return { tracks: getTrackRecords(db, weekStart, sort, limit) };
  if (type === 'albums') return { albums: getAlbumRecords(db, weekStart, sort, limit) };
  if (type === 'artists') return { artists: getArtistRecords(db, weekStart, sort, limit) };
  return {
    tracks: getTrackRecords(db, weekStart, sort, limit),
    albums: getAlbumRecords(db, weekStart, sort, limit),
    artists: getArtistRecords(db, weekStart, sort, limit),
  };
}
