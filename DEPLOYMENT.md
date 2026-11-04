# LamSuite Billing — Production Single-Server Hosting Guide

This guide covers the deployment, operations, and maintenance of **LamSuite Billing** on a single Linux server (Ubuntu 22.04/24.04 LTS or Debian 12) using Docker and Traefik v3.

---

## 1. Subdomain Map & DNS Configuration

All subdomains route through Traefik v3 using automatic Let's Encrypt TLS certificates. The subdomains are defined in `.env` and kept in a single location.

### Subdomain Mapping
| Subdomain | Target Service | Internal Port | Purpose |
| :--- | :--- | :--- | :--- |
| **`api.${DOMAIN}`** | `api` (Laravel) | 8000 | REST API backend (`/api`, `/up`) |
| **`ws.${DOMAIN}`** | `reverb` (Reverb) | 8080 | Real-time WebSockets for online-first sync |
| **`app.${DOMAIN}`** | `panel` (Nginx) | 80 | Central Admin Panel static SPA *(formerly panel)* |
| **`web.${DOMAIN}`** | `web` (Nginx) | 80 | Web version of billing UI *(formerly app)* |
| **`mcp.${DOMAIN}`** | `mcp` (Node 22) | 3000 | MCP server HTTP SSE endpoint (authenticated) |
| **`updates.${DOMAIN}`**| `updates` (Optional) | 80 | Tauri auto-updater binaries & manifests |
| **`traefik.${DOMAIN}`**| `traefik` (Internal) | 8080 | Traefik dashboard (protected by HTTP BasicAuth) |

### Required DNS Records
Point your DNS to your Linux server's public IPv4 address (`YOUR_SERVER_IP`):

#### Option A: Wildcard Record (Recommended)
| Type | Host | Value | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `*.yourdomain.com` | `YOUR_SERVER_IP` | 300 (or Auto) |
| **A** | `yourdomain.com` | `YOUR_SERVER_IP` | 300 (or Auto) |

#### Option B: Individual Records
| Type | Host | Value | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `api.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `ws.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `app.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `web.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `panel.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `mcp.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `updates.yourdomain.com` | `YOUR_SERVER_IP` | 300 |
| **A** | `traefik.yourdomain.com` | `YOUR_SERVER_IP` | 300 |

---

## 2. Server Sizing & Resource Allocation

- **Initial / Minimum**: 2 vCPUs, 4 GB RAM, 40 GB NVMe SSD.
- **Recommended**: 4 vCPUs, 8 GB RAM, 80 GB NVMe SSD.
- **Scaling Path**: As database load grows beyond 50 concurrent counters, separate the MySQL container to a managed cloud database (AWS RDS, DigitalOcean Managed Database) by updating `DB_HOST` in `.env`.

---

## 3. Server Provisioning & Hardening (One-Time Setup)

On a freshly installed Ubuntu/Debian server:

```bash
# 1. Connect via SSH as root
ssh root@YOUR_SERVER_IP

# 2. Clone the repository into /opt/lamsuite
git clone https://github.com/your-org/lamsuite-billing.git /opt/lamsuite
cd /opt/lamsuite

# 3. Run the automated hardening script
chmod +x scripts/*.sh
sudo ./scripts/server-setup.sh
```

The script automatically:
1. Updates system packages and installs `chrony` (NTP time synchronization).
2. Configures `unattended-upgrades` for daily security patches.
3. Sets up **UFW firewall**: only ports `22` (SSH), `80` (HTTP), and `443` (HTTPS) are open. All other ports (including 3306 MySQL and 6379 Redis) are blocked from the outside.
4. Configures `fail2ban` against SSH brute force.
5. Installs Docker CE and Docker Compose v2.
6. Enforces Docker daemon log rotation (`max-size: 10m`, `max-file: 5`).
7. Creates a non-root `deploy` user with Docker execution rights.

---

## 4. Step-by-Step First Deployment

### Step 1: Configure Environment Variables
Switch to the `deploy` user and create `.env`:
```bash
sudo su - deploy
cd /opt/lamsuite

cp .env.example .env
nano .env
```
Fill in the following critical parameters:
- `DOMAIN`: Your actual domain (e.g. `lamstone.cloud`).
- `ACME_EMAIL`: Your email for Let's Encrypt certificates.
- `APP_KEY`: Generate via `docker run --rm lamsuite-backend:latest php artisan key:generate --show` or generate locally.
- `DB_PASSWORD` & `REDIS_PASSWORD`: Secure random passwords.
- `MCP_AUTH_TOKEN`: Secure random token for MCP access.
- `BACKUP_ENCRYPTION_PASSPHRASE`: Passphrase for GPG encrypted backups.
- `TRAEFIK_DASHBOARD_AUTH`: Generate via `htpasswd -nb admin your_secure_password | sed -e s/\\$/\\$\\$/g`.

### Step 2: Build Images & Run Controlled Migrations
```bash
# Build production images locally on the server (or pull from GHCR)
docker compose build

# Run controlled database migration in a dedicated one-off container
docker compose run --rm --no-deps api php artisan migrate --force

# Warm up application caches
docker compose run --rm --no-deps api php artisan config:cache
docker compose run --rm --no-deps api php artisan route:cache
docker compose run --rm --no-deps api php artisan view:cache
```

### Step 3: Launch the Stack
```bash
docker compose up -d
```

### Step 4: Verify Deployment
Check that all containers are healthy:
```bash
docker compose ps
```
Verify HTTPS endpoints:
```bash
curl -I https://api.yourdomain.com/up
# Expect: HTTP/2 200

curl -I https://app.yourdomain.com/health
# Expect: HTTP/2 200 (Admin Panel)

curl -I https://web.yourdomain.com/health
# Expect: HTTP/2 200 (Web Billing)

curl -I https://mcp.yourdomain.com/health
# Expect: HTTP/2 200
```

---

## 5. Adding Another Service or Site

Traefik dynamically discovers services with `exposedbydefault=false`. To route a new service or static site, add **only 4 labels** to its compose block:

```yaml
  dummy-site:
    image: nginx:1.27-alpine
    container_name: dummy-site
    restart: unless-stopped
    networks:
      - lamsuite-public
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dummy.rule=Host(`dummy.${DOMAIN}`)"
      - "traefik.http.routers.dummy.entrypoints=websecure"
      - "traefik.http.routers.dummy.tls.certresolver=letsencrypt"
      - "traefik.http.services.dummy.loadbalancer.server.port=80"
```
Run `docker compose up -d dummy-site`. Traefik immediately requests a Let's Encrypt certificate and routes traffic. **Zero changes to Nginx or Traefik config files required.**

---

## 6. Desktop & Client Configuration

### Tauri Desktop App (`frontend`)
Configure `frontend/.env` before building installer binaries:
```ini
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_PANEL_PORTAL_URL=https://app.yourdomain.com
VITE_ADMIN_PORTAL_URL=https://app.yourdomain.com
```

### MCP Client Connection
In Claude Desktop or AI Agent settings:
```json
{
  "mcpServers": {
    "lamsuite": {
      "url": "https://mcp.yourdomain.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

---

## 7. Backups & Disaster Recovery

### Automated Daily Backups
The backup script creates an encrypted database dump + uploaded assets tarball, syncs to S3/Cloudflare R2, and retains 30 days of history:
```bash
# Add to crontab of deploy user: crontab -e
0 3 * * * /opt/lamsuite/scripts/backup.sh >> /var/log/lamsuite/backup.log 2>&1
```

### Manual Backup Run
```bash
/opt/lamsuite/scripts/backup.sh
```

### Restoration Procedure
To restore into a clean server or recover from accidental deletion:
```bash
# Provide the encrypted backup file:
/opt/lamsuite/scripts/restore.sh /opt/lamsuite/backups/lamsuite_backup_20261026_120000.tar.gz.gpg
```
The script will prompt for the confirmation word `RESTORE`, decrypt via GPG, reload the MySQL schema, restore storage files, and re-cache Laravel routes and configuration.

---

## 8. Rollback Procedure

### Automated Rollback
The GitHub Actions workflow in [deploy.yml](file:///.github/workflows/deploy.yml) automatically executes rollback if any subdomain fails the health probe within 60 seconds of a release.

### Manual Rollback
To immediately revert to a previous tag or commit SHA:
```bash
cd /opt/lamsuite

# Specify the previous image tag or commit
export DOCKER_TAG="PREVIOUS_COMMIT_SHA"

docker compose pull
docker compose up -d --remove-orphans
```

---

## 9. Alternative Deployment: Coolify or Dokploy

The stack is 100% compatible with self-hosted PaaS solutions like **Coolify** or **Dokploy**:

1. Install Coolify on the server: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`.
2. In Coolify, create a **New Project** -> **Docker Compose**.
3. Paste the contents of `docker-compose.yml`.
4. In the Environment Variables tab, paste the variables from `.env.example`.
5. Coolify will automatically manage the Traefik proxy and Let's Encrypt certificates through the UI.

---

## 10. Troubleshooting & FAQ

### 1. Certificate Not Issued (Let's Encrypt Error)
- **Check DNS**: Ensure `ping api.yourdomain.com` returns the server's public IP.
- **Check Ports 80 & 443**: Ensure host firewall or cloud provider security group (AWS SG, DigitalOcean Cloud Firewall) allows inbound traffic on port 80 and 443. Traefik requires HTTP-01 challenge over port 80.
- **Check Traefik Logs**:
  ```bash
  docker compose logs traefik | grep -i acme
  ```

### 2. HTTP 502 Bad Gateway
- Check if the target service is healthy:
  ```bash
  docker compose ps
  ```
- If `api` is unhealthy, check the Laravel error logs:
  ```bash
  docker compose logs api --tail 100
  ```
- Verify database connectivity:
  ```bash
  docker compose exec api php artisan db:monitor
  ```

### 3. WebSocket Disconnections (`ws.DOMAIN`)
- Traefik includes `responseforwarding.flushinterval=-1` to disable response buffering.
- Verify Reverb is running on port 8080:
  ```bash
  docker compose logs reverb --tail 50
  ```

### 4. CORS Errors on `panel.DOMAIN`
- Ensure `panel.yourdomain.com` is listed in `CORS_ALLOWED_ORIGINS` in `.env`.
- Ensure `SESSION_DOMAIN=.yourdomain.com` (note the leading dot).
- Verify trusted proxies in [bootstrap/app.php](file:///Users/anshad/.gemini/antigravity/scratch/lamsuite-billing/backend/bootstrap/app.php) (`$middleware->trustProxies(at: '*')`).
- Run `docker compose exec api php artisan config:clear && docker compose exec api php artisan config:cache`.

### 5. Authentication Rate-Limit Locked Out
- The anti-brute-force middleware throttles requests to 10 req/min on `/api/login` and `/api/devices/register`.
- Wait 60 seconds, or adjust `rate-limit-auth` burst in [traefik/dynamic/middleware.yml](file:///Users/anshad/.gemini/antigravity/scratch/lamsuite-billing/traefik/dynamic/middleware.yml).
