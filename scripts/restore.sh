#!/usr/bin/env bash
# ==============================================================================
# LamSuite Billing - Disaster Recovery & Database Restoration Script
# Decrypts an encrypted backup archive and restores both the MySQL database
# and persistent storage volume in a safe, controlled manner.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source environment
ENV_FILE="${PROJECT_ROOT}/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found at $ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path_to_encrypted_backup.tar.gz.gpg>"
    exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE" >&2
    exit 1
fi

echo "==================================================================="
echo "  WARNING: THIS WILL OVERWRITE EXISTING DATABASE & STORAGE!"
echo "  Target Database: ${DB_DATABASE} on db"
echo "  Backup File:     ${BACKUP_FILE}"
echo "==================================================================="
read -rp "Type 'RESTORE' to proceed: " CONFIRMATION
if [ "$CONFIRMATION" != "RESTORE" ]; then
    echo "Restoration aborted by operator."
    exit 0
fi

RESTORE_TMP="$(mktemp -d)"
cleanup() {
    rm -rf "$RESTORE_TMP"
}
trap cleanup EXIT

echo "--> [1/4] Decrypting backup archive..."
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    read -rsp "Enter GPG encryption passphrase: " BACKUP_ENCRYPTION_PASSPHRASE
    echo
fi

gpg --decrypt \
    --batch \
    --yes \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    -o "${RESTORE_TMP}/backup.tar.gz" \
    "${BACKUP_FILE}"

echo "--> [2/4] Extracting components..."
tar -xzf "${RESTORE_TMP}/backup.tar.gz" -C "${RESTORE_TMP}"

echo "--> [3/4] Restoring MySQL Database..."
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" exec -T db \
    mysql \
        -u"${DB_USERNAME}" \
        -p"${DB_PASSWORD}" \
        "${DB_DATABASE}" < "${RESTORE_TMP}/database.sql"

echo "--> [4/4] Restoring persistent storage volume..."
docker run --rm \
    -v lamsuite_storage_data:/target \
    -v "${RESTORE_TMP}:/source:ro" \
    alpine sh -c "rm -rf /target/* && tar -xzf /source/storage.tar.gz -C /target"

echo "--> Reheating application caches..."
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" exec -T api \
    php artisan config:cache
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" exec -T api \
    php artisan route:cache

echo "==================================================================="
echo "  Restoration completed successfully!"
echo "==================================================================="
