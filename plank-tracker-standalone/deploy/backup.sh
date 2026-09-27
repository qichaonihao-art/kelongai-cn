#!/usr/bin/env bash
set -euo pipefail
data_dir=/www/wwwroot/plank-tracker-data
backup_dir=/www/wwwroot/plank-tracker-backups
mkdir -p "$backup_dir"
sqlite3 "$data_dir/plank.db" ".backup '$backup_dir/plank-$(date +%F-%H%M%S).db'"
find "$backup_dir" -type f -name 'plank-*.db' -mtime +30 -delete
