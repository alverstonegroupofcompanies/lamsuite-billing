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

# SEC-06: a hosted environment must never render debug pages or traces.
case "$APP_ENV" in
    production|staging)
        case "$(printf '%s' "${APP_DEBUG:-false}" | tr '[:upper:]' '[:lower:]')" in
            true|1|on|yes)
                echo "ERROR: APP_DEBUG is enabled with APP_ENV=$APP_ENV. Refusing to start; set APP_DEBUG=false." >&2
                exit 1
                ;;
        esac
        ;;
esac

# If APP_KEY is not set or empty, warn the administrator
if [ -z "$APP_KEY" ]; then
    echo "WARNING: APP_KEY is not set! Set APP_KEY in your environment variables." >&2
fi

exec "$@"
