# ═══════════════════════════════════════════════════════════════════════════════
# XActions — Production Dockerfile
# Multi-stage build: Node.js + Chromium + Next.js App Router
# by nichxbt
# ═══════════════════════════════════════════════════════════════════════════════

# Stage 1: Build everything
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY packages ./packages

# Install root dependencies and generate Prisma client
RUN npm ci --omit=dev && npx prisma generate

# Copy web app and build it
COPY apps/web ./apps/web
RUN cd apps/web && npm ci && NODE_ENV=production npm run build

# Copy remaining application source
COPY . .

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 2: Production runtime
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS production

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

# Copy built application from builder stage
COPY --from=builder /app ./

# Create non-root user
RUN groupadd -r xactions && useradd -r -g xactions -G audio,video xactions \
    && mkdir -p /home/xactions/Downloads \
    && chown -R xactions:xactions /home/xactions \
    && chown -R xactions:xactions /app \
    && chmod +x /app/start.sh

USER xactions

EXPOSE 3001 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["/bin/sh", "/app/start.sh"]
