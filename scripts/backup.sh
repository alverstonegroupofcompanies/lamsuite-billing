#!/usr/bin/env bash
# ==============================================================================
# LamSuite Billing - Production Automated Encrypted Backup Script
# Creates a hot database dump and storage archive, encrypts with GPG,
# syncs off-site to S3-compatible object storage, and prunes old backups.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source environment configuration
ENV_FILE="${PROJECT_ROOT}/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found at $ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TEMP_DIR="${BACKUP_DIR}/temp_${TIMESTAMP}"
ARCHIVE_NAME="lamsuite_backup_${TIMESTAMP}"
FINAL_ENCRYPTED_FILE="${BACKUP_DIR}/${ARCHIVE_NAME}.tar.gz.gpg"

mkdir -p "$BACKUP_DIR" "$TEMP_DIR"

notify_webhook() {
    local status="$1"
    local message="$2"
    if [ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ]; then
        curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"**[LamSuite Backup]** Status: **${status}**\\nHost: \`${DOMAIN}\`\\nMessage: ${message}\"}" \
            "${BACKUP_ALERT_WEBHOOK_URL}" > /dev/null 2>&1 || true
    fi
}

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "--> [1/5] Dumping MySQL database..."
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" exec -T db \
    mysqldump \
        -u"${DB_USERNAME}" \
        -p"${DB_PASSWORD}" \
        --single-transaction \
        --quick \
        --routines \
        --triggers \
        "${DB_DATABASE}" > "${TEMP_DIR}/database.sql"

if [ ! -s "${TEMP_DIR}/database.sql" ]; then
    echo "ERROR: Database dump produced an empty file!" >&2
    notify_webhook "FAILURE" "Database dump produced an empty file."
    exit 1
fi

echo "--> [2/5] Archiving persistent storage files..."
docker run --rm \
    -v lamsuite_storage_data:/source:ro \
    -v "${TEMP_DIR}:/backup" \
    alpine tar -czf "/backup/storage.tar.gz" -C /source .

echo "--> [3/5] Packing and encrypting backup archive with GPG..."
tar -czf "${TEMP_DIR}/${ARCHIVE_NAME}.tar.gz" -C "${TEMP_DIR}" database.sql storage.tar.gz

if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is not set in .env!" >&2
    notify_webhook "FAILURE" "BACKUP_ENCRYPTION_PASSPHRASE missing. Aborting."
    exit 1
fi

gpg --symmetric \
    --batch \
    --yes \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --cipher-algo AES256 \
    -o "${FINAL_ENCRYPTED_FILE}" \
    "${TEMP_DIR}/${ARCHIVE_NAME}.tar.gz"

echo "Backup created successfully: ${FINAL_ENCRYPTED_FILE} ($(du -h "${FINAL_ENCRYPTED_FILE}" | cut -f1))"

# 4. Off-Site S3 Upload (if configured)
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ] && command -v aws &>/dev/null; then
    echo "--> [4/5] Uploading encrypted backup to S3/R2..."
    AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}" \
    AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}" \
    aws s3 cp "${FINAL_ENCRYPTED_FILE}" \
        "s3://${BACKUP_S3_BUCKET}/backups/${ARCHIVE_NAME}.tar.gz.gpg" \
        ${BACKUP_S3_ENDPOINT:+--endpoint-url "${BACKUP_S3_ENDPOINT}"} \
        ${BACKUP_S3_REGION:+--region "${BACKUP_S3_REGION}"}
fi

# 5. Local Retention Pruning
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
echo "--> [5/5] Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "lamsuite_backup_*.tar.gz.gpg" -type f -mtime +"${RETENTION_DAYS}" -delete

notify_webhook "SUCCESS" "Backup completed and secured. File: ${ARCHIVE_NAME}.tar.gz.gpg"
echo "Backup routine completed successfully."
