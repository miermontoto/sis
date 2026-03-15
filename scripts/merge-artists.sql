-- Merge import: artists into real Spotify artists where names match (case-insensitive)

-- 1. Update track_artists to point to real artist IDs
UPDATE track_artists
SET artist_id = (
  SELECT r.spotify_id FROM artists r
  WHERE LOWER(r.name) = (SELECT LOWER(i.name) FROM artists i WHERE i.spotify_id = track_artists.artist_id)
    AND r.spotify_id NOT LIKE 'import:%'
    AND r.spotify_id NOT LIKE 'local:%'
  LIMIT 1
)
WHERE artist_id LIKE 'import:%'
  AND EXISTS (
    SELECT 1 FROM artists r
    JOIN artists i ON LOWER(i.name) = LOWER(r.name)
    WHERE i.spotify_id = track_artists.artist_id
      AND r.spotify_id NOT LIKE 'import:%'
      AND r.spotify_id NOT LIKE 'local:%'
  );

-- 2. Delete import: artists that now have no track_artists references
DELETE FROM artists
WHERE spotify_id LIKE 'import:%'
  AND spotify_id NOT IN (SELECT DISTINCT artist_id FROM track_artists);

-- 3. Clean up duplicate track_artists rows (same track + artist, keep lowest rowid)
DELETE FROM track_artists
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM track_artists GROUP BY track_id, artist_id
);

-- Summary
SELECT 'remaining import artists' as label, count(*) as n FROM artists WHERE spotify_id LIKE 'import:%'
UNION ALL
SELECT 'real spotify artists', count(*) FROM artists WHERE spotify_id NOT LIKE 'import:%' AND spotify_id NOT LIKE 'local:%'
UNION ALL
SELECT 'total artists', count(*) FROM artists;
