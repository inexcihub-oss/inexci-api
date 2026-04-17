#!/bin/sh
set -e

echo "📦 Installing dependencies..."
npm install --prefer-offline --no-audit --no-fund

echo "🚀 Running migrations..."
npm run typeorm:migration:run || echo "⚠️  Migrations failed (may already be applied)"

echo "✅ Starting application..."
exec npm run start:dev
