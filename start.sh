#!/bin/sh

# Run database migrations only if DATABASE_URL is available
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Running database migrations..."
  npx prisma migrate deploy || {
    echo "⚠️  Tables exist without migration history - marking baseline as applied..."
    npx prisma migrate resolve --applied "0_init" && npx prisma migrate deploy
  } || {
    echo "⚠️  Prisma migrate deploy failed, falling back to prisma db push..."
    npx prisma db push --skip-generate --accept-data-loss
  } || echo "⚠️  Migration warning (non-fatal), continuing..."
else
  echo "⚠️ DATABASE_URL not set, skipping migrations"
fi

# Start Next.js App Router in background if built
if [ -d "/app/apps/web/.next" ]; then
  echo "🚀 Starting Next.js Web App on port 3000..."
  (cd /app/apps/web && PORT=3000 npm run start) &
fi

# Start Express API server on port 3001 (foreground)
exec node api/server.js
