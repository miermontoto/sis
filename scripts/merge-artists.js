const Database = require('better-sqlite3');
const db = new Database('/app/data/sis.db');

db.pragma('journal_mode = WAL');

console.log('Before merge:');
console.log('  import artists:', db.prepare("SELECT count(*) as c FROM artists WHERE spotify_id LIKE 'import:%'").get().c);
console.log('  real artists:', db.prepare("SELECT count(*) as c FROM artists WHERE spotify_id NOT LIKE 'import:%' AND spotify_id NOT LIKE 'local:%'").get().c);

// find import artists that have a matching real spotify artist
const matches = db.prepare(`
  SELECT i.spotify_id as import_id, r.spotify_id as real_id, r.name
  FROM artists i
  JOIN artists r ON LOWER(i.name) = LOWER(r.name)
  WHERE i.spotify_id LIKE 'import:%'
    AND r.spotify_id NOT LIKE 'import:%'
    AND r.spotify_id NOT LIKE 'local:%'
`).all();

console.log('  matched pairs:', matches.length);

// delete track_artists that would conflict, then update the rest
const deleteConflicting = db.prepare(`
  DELETE FROM track_artists
  WHERE artist_id = ? AND track_id IN (
    SELECT track_id FROM track_artists WHERE artist_id = ?
  )
`);
const updateTA = db.prepare('UPDATE track_artists SET artist_id = ? WHERE artist_id = ?');
const deleteArtist = db.prepare('DELETE FROM artists WHERE spotify_id = ?');

db.transaction(() => {
  for (const m of matches) {
    // remove import track_artists that would conflict with existing real ones
    deleteConflicting.run(m.import_id, m.real_id);
    // update remaining import references to real ID
    const changed = updateTA.run(m.real_id, m.import_id);
    deleteArtist.run(m.import_id);
  }

  // clean up any remaining duplicate track_artists
  const dupeTA = db.prepare(`
    DELETE FROM track_artists WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM track_artists GROUP BY track_id, artist_id
    )
  `).run();
  console.log('  duplicate track_artists cleaned:', dupeTA.changes);
})();

console.log('\nAfter merge:');
console.log('  import artists:', db.prepare("SELECT count(*) as c FROM artists WHERE spotify_id LIKE 'import:%'").get().c);
console.log('  total artists:', db.prepare("SELECT count(*) as c FROM artists").get().c);

console.log('\nTop 10 artists by plays:');
const top = db.prepare(`
  SELECT a.spotify_id, a.name, count(lh.id) as plays
  FROM listening_history lh
  JOIN tracks t ON t.spotify_id = lh.track_id
  JOIN track_artists ta ON ta.track_id = t.spotify_id
  JOIN artists a ON a.spotify_id = ta.artist_id
  GROUP BY a.spotify_id
  ORDER BY plays DESC
  LIMIT 10
`).all();
top.forEach(r => console.log(`  ${r.name}: ${r.plays} plays (${r.spotify_id})`));
