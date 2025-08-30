#!/bin/sh

echo "🚀 [Container] Starting with Git setup..."

if [ -f "/app/scripts/setup-git.sh" ]; then
  echo "📋 [Container] Running Git setup..."
  /app/scripts/setup-git.sh || echo "⚠️ [Container] Git setup failed, continuing..."
else
  echo "⚠️ [Container] Git setup script not found"
fi

echo "🌟 [Container] Starting main application..."
exec "$@"
