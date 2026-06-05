#!/bin/bash
# wrapper de backup de sis sobre la herramienta compartida de la plataforma.
# cron: 23 */6 * * * /home/mier/dev/sis/scripts/backup.sh >> /home/mier/dev/sis/data/backups/backup.log 2>&1

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

exec "$REPO_DIR/platform/tooling/backup/backup-sqlite.sh" \
  --app sis \
  --mode docker \
  --container sis-sis-1 \
  --db /app/data/sis.db \
  --dest "$REPO_DIR/data/backups"
