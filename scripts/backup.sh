#!/bin/bash
# Backup de la base de datos SQLite de SIS desde el contenedor Docker.
# Usa better-sqlite3 .backup() para copias seguras con WAL mode.
# Guarda en data/backups/ (synced via Syncthing, gitignored).
#
# Rotación:
#   - data/backups/recent/  → últimas 4 copias (24h)
#   - data/backups/weekly/  → 1 por semana, últimas 4 (1 mes)
#
# Cron: 23 */6 * * * /home/mier/dev/sis/scripts/backup.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="sis-sis-1"
DB_PATH="/app/data/sis.db"
RECENT_DIR="$REPO_DIR/data/backups/recent"
WEEKLY_DIR="$REPO_DIR/data/backups/weekly"
KEEP_RECENT=4   # 24h de backups cada 6h
KEEP_WEEKLY=4   # 1 mes de backups semanales

mkdir -p "$RECENT_DIR" "$WEEKLY_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="sis-${TIMESTAMP}.db"
CONTAINER_BACKUP="/app/data/_backup.db"

echo "[backup] creando backup seguro dentro del contenedor..."
docker exec "$CONTAINER" node -e "
  const Database = require('better-sqlite3');
  const db = new Database('$DB_PATH', { readonly: true });
  db.backup('$CONTAINER_BACKUP').then(() => {
    db.close();
    console.log('backup ok');
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
"

echo "[backup] copiando a recent/$BACKUP_NAME..."
docker cp "$CONTAINER:$CONTAINER_BACKUP" "$RECENT_DIR/$BACKUP_NAME"
docker exec "$CONTAINER" rm -f "$CONTAINER_BACKUP"

# promover a weekly si no hay backup de esta semana
WEEK_TAG=$(date +%Yw%V)
if ! ls "$WEEKLY_DIR"/sis-*."$WEEK_TAG".db &>/dev/null; then
  WEEKLY_NAME="sis-${TIMESTAMP}.${WEEK_TAG}.db"
  cp "$RECENT_DIR/$BACKUP_NAME" "$WEEKLY_DIR/$WEEKLY_NAME"
  echo "[backup] promovido a weekly/$WEEKLY_NAME"
fi

# rotar
rotate() {
  local dir=$1 pattern=$2 keep=$3
  local total
  total=$(ls -1t "$dir"/$pattern 2>/dev/null | wc -l)
  if [ "$total" -gt "$keep" ]; then
    ls -1t "$dir"/$pattern | tail -n +"$((keep + 1))" | xargs rm -f
    echo "[backup] rotados $((total - keep)) en $dir"
  fi
}
rotate "$RECENT_DIR" "sis-*.db" "$KEEP_RECENT"
rotate "$WEEKLY_DIR" "sis-*.db" "$KEEP_WEEKLY"

SIZE=$(du -h "$RECENT_DIR/$BACKUP_NAME" | cut -f1)
echo "[backup] completado: $BACKUP_NAME ($SIZE)"
