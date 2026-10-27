#!/usr/bin/env bash
# ==============================================================================
# LamSuite Billing - Production Server Setup & Hardening Script
# Target OS: Ubuntu 22.04 LTS / 24.04 LTS or Debian 12
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "ERROR: This script must be run as root (or via sudo)." >&2
   exit 1
fi

echo "==================================================================="
echo "  Starting LamSuite Billing Host Hardening & Provisioning"
echo "==================================================================="

DEPLOY_USER="deploy"
APP_DIR="/opt/lamsuite"

# 1. Update system packages
echo "--> [1/7] Updating system packages..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# 2. Install essential utilities
echo "--> [2/7] Installing required utilities & security packages..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl \
    wget \
    git \
    ufw \
    fail2ban \
    chrony \
    unattended-upgrades \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    gpg \
    tar \
    gzip

# 3. Configure Time Synchronization (Chrony)
echo "--> [3/7] Enabling Chrony NTP time synchronization..."
systemctl enable chrony
systemctl restart chrony

# 4. Configure Automatic Security Updates
echo "--> [4/7] Enabling unattended-upgrades..."
cat << 'EOF' > /etc/apt/apt.conf.d/20auto-upgrades
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl restart unattended-upgrades

# 5. Configure Firewall (UFW)
echo "--> [5/7] Configuring UFW firewall (22/SSH, 80/HTTP, 443/HTTPS)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (Traefik)"
ufw allow 443/tcp comment "HTTPS (Traefik)"
ufw --force enable

# 6. Configure Fail2ban for SSH
echo "--> [6/7] Configuring Fail2ban..."
cat << 'EOF' > /etc/fail2ban/jail.local
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = 22
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# 7. Install Docker Engine & Configure Docker Daemon
echo "--> [7/7] Installing Docker Engine & Compose plugin..."
if ! command -v docker &> /dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Configure Docker daemon with standard log rotation
mkdir -p /etc/docker
cat << 'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  },
  "live-restore": true
}
EOF
systemctl restart docker
systemctl enable docker

# 8. Create non-root deploy user if not present
if ! id -u "$DEPLOY_USER" &>/dev/null; then
    echo "Creating non-root deploy user: $DEPLOY_USER"
    useradd -m -s /bin/bash "$DEPLOY_USER"
    usermod -aG docker "$DEPLOY_USER"
    echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/99-$DEPLOY_USER"
    chmod 0440 "/etc/sudoers.d/99-$DEPLOY_USER"
fi

# 9. Setup Application Directory
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==================================================================="
echo "  Server hardening and environment setup complete!"
echo "  Deploy user '$DEPLOY_USER' configured with docker permissions."
echo "  Application directory ready at: $APP_DIR"
echo "==================================================================="
