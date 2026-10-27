# syntax=docker/dockerfile:1.4

# Stage 1: Build the static application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json tsconfig.json ./

# Install dependencies cleanly
RUN npm ci

# Copy source files
COPY . .

# Run build
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:1.27-alpine AS runner

# Create cache directories and set permissions for nginx user
RUN mkdir -p /var/cache/nginx /var/run /tmp && \
    chown -R nginx:nginx /var/cache/nginx /var/run /tmp

# Copy custom Nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Copy built static files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
