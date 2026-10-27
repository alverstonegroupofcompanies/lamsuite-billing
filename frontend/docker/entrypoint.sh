#!/bin/sh
set -e

# Generate runtime env.js if environment variables are provided
cat <<EOF > /usr/share/nginx/html/env.js
window.__ENV__ = {
  VITE_API_BASE_URL: "${VITE_API_BASE_URL:-}",
  VITE_WS_URL: "${VITE_WS_URL:-}",
  VITE_PANEL_PORTAL_URL: "${VITE_PANEL_PORTAL_URL:-}"
};
EOF

chmod 644 /usr/share/nginx/html/env.js

exec "$@"
