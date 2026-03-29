import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import type { AppVariables } from '../app.js';

const exportRoute = new Hono<{ Variables: AppVariables }>();

exportRoute.get('/', (c) => {
  const format = c.req.query('format') || 'json';
  const userId = c.get('userId');
  const db = getDb();

  const rows = db.all(sql`
    SELECT
      lh.played_at,
      t.name as track_name,
      t.duration_ms,
      a.name as album_name,
      GROUP_CONCAT(ar.name, ', ') as artist_names,
      lh.context_type
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    LEFT JOIN albums a ON a.spotify_id = t.album_id
    LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id
    LEFT JOIN artists ar ON ar.spotify_id = ta.artist_id
    WHERE lh.user_id = ${userId}
    GROUP BY lh.id
    ORDER BY lh.played_at DESC
  `) as {
    played_at: string;
    track_name: string;
    duration_ms: number;
    album_name: string;
    artist_names: string;
    context_type: string | null;
  }[];

  if (format === 'csv') {
    const header = 'played_at,track_name,artist_names,album_name,duration_ms,context_type';
    const csvRows = rows.map(r =>
      [r.played_at, `"${r.track_name}"`, `"${r.artist_names}"`, `"${r.album_name}"`, r.duration_ms, r.context_type || ''].join(',')
    );

    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="sis-export.csv"');
    return c.body([header, ...csvRows].join('\n'));
  }

  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', 'attachment; filename="sis-export.json"');
  return c.json(rows);
});

export default exportRoute;
