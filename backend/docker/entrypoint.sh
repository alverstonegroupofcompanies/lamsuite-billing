#!/bin/sh
set -e

# Ensure essential Laravel storage directories exist with proper permissions
mkdir -p \
    /var/www/html/storage/framework/cache/data \
    /var/www/html/storage/framework/sessions \
    /var/www/html/storage/framework/views \
    /var/www/html/storage/logs \
    /var/www/html/storage/app/public \
    /var/www/html/bootstrap/cache

# If APP_KEY is not set or empty, warn the administrator
if [ -z "$APP_KEY" ]; then
    echo "WARNING: APP_KEY is not set! Set APP_KEY in your environment variables." >&2
fi

exec "$@"
