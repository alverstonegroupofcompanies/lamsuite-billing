# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json tsconfig.json ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy TypeScript sources
COPY src/ ./src/

# Compile TypeScript to JavaScript in /dist
RUN npm run build

# Production Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    LAMSUITE_MCP_TRANSPORT=stdio \
    LAMSUITE_API_URL=http://backend:8000/api \
    LAMSUITE_STORE_ID=1 \
    LAMSUITE_READ_ONLY=true \
    LAMSUITE_API_ROLE=admin

# Copy package descriptors and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled artifacts from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -S lamsuite && adduser -S lamsuite -G lamsuite && \
    mkdir -p /app/logs && chown -R lamsuite:lamsuite /app
USER lamsuite

EXPOSE 3000

# Default entrypoint supports stdio (Claude Desktop) or http (via env or flags)
ENTRYPOINT ["node", "dist/index.js"]
