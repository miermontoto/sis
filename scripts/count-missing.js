const Database = require('better-sqlite3');
const db = new Database('/app/data/sis.db');
console.log('import artists:', db.prepare("SELECT count(*) as c FROM artists WHERE spotify_id LIKE 'import:%'").get().c);
console.log('import albums:', db.prepare("SELECT count(*) as c FROM albums WHERE spotify_id LIKE 'import:%'").get().c);
console.log('real artists no image:', db.prepare("SELECT count(*) as c FROM artists WHERE spotify_id NOT LIKE 'import:%' AND spotify_id NOT LIKE 'local:%' AND image_url IS NULL").get().c);
console.log('real albums no image:', db.prepare("SELECT count(*) as c FROM albums WHERE spotify_id NOT LIKE 'import:%' AND spotify_id NOT LIKE 'local:%' AND image_url IS NULL").get().c);
