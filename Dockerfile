# ═══════════════════════════════════════════════════════════════════════════════
# XActions — Production Dockerfile
# Multi-stage build: Node.js + Chromium + Next.js App Router
# by nichxbt
# ═══════════════════════════════════════════════════════════════════════════════

# Stage 1: Backend Dependencies
FROM node:20-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npx prisma generate

# Stage 2: Web App Build (Next.js 15)
FROM node:20-slim AS web-builder

WORKDIR /app

# Copy packages needed by web
COPY packages ./packages
COPY apps/web ./apps/web
COPY package.json ./

WORKDIR /app/apps/web
RUN npm ci && npm run build

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 3: Production runtime
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS production

# Install Chromium and required system dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Copy backend dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy application code
COPY . .

# Copy built Next.js web app
COPY --from=web-builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=web-builder /app/apps/web/.next ./apps/web/.next

# Create non-root user
RUN groupadd -r xactions && useradd -r -g xactions -G audio,video xactions \
    && mkdir -p /home/xactions/Downloads \
    && chown -R xactions:xactions /home/xactions \
    && chown -R xactions:xactions /app \
    && chmod +x /app/start.sh

USER xactions

EXPOSE 3001 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["/bin/sh", "/app/start.sh"]
