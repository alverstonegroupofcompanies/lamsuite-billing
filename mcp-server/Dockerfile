# syntax=docker/dockerfile:1.4

# Stage 1: Build TypeScript artifacts
FROM node:22.14-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm ci

COPY src/ ./src/

RUN npm run build

# Stage 2: Production runtime
FROM node:22.14-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    LAMSUITE_MCP_TRANSPORT=http \
    LAMSUITE_API_URL=http://api:8000/api \
    LAMSUITE_STORE_ID=1 \
    LAMSUITE_READ_ONLY=true \
    LAMSUITE_API_ROLE=admin

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled artifacts from builder
COPY --from=builder /app/dist ./dist

# Create dedicated non-root user and logs directory
RUN addgroup -S lamsuite && adduser -S lamsuite -G lamsuite && \
    mkdir -p /app/logs && chown -R lamsuite:lamsuite /app

USER lamsuite

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--transport=http"]
