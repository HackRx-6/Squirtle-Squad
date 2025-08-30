#!/bin/bash

# Cache warming script to pre-build layers for faster subsequent builds
# Usage: ./scripts/warm-cache.sh

set -e

echo "🔥 Warming Docker build cache..."

REGISTRY="ghcr.io"
REPO_NAME="hackrx-6/squirtle-squad"

# Enable BuildKit
export DOCKER_BUILDKIT=1
export BUILDX_EXPERIMENTAL=1

# Set up buildx if not exists
if ! docker buildx inspect cache-warmer >/dev/null 2>&1; then
    echo "🔧 Setting up Docker Buildx for cache warming..."
    docker buildx create --name cache-warmer --use --bootstrap
fi

echo "🏗️ Pre-building cacheable layers..."

# Build and cache the base layers without pushing full images
echo "📦 Warming Alpine base layer cache..."
docker buildx build \
    --platform linux/amd64 \
    --target alpine-base \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache-alpine-base,mode=max \
    .

echo "📦 Warming Playwright base layer cache..."
docker buildx build \
    --platform linux/amd64 \
    --target playwright-base \
    --cache-from type=registry,ref=$REGISTRY/$REPO_NAME:cache-alpine-base \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache-playwright-base,mode=max \
    .

echo "📦 Warming dependencies layer cache..."
docker buildx build \
    --platform linux/amd64 \
    --target deps \
    --cache-from type=registry,ref=$REGISTRY/$REPO_NAME:cache-playwright-base \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache-deps,mode=max \
    .

echo "📦 Warming native modules layer cache..."
docker buildx build \
    --platform linux/amd64 \
    --target native-modules \
    --cache-from type=registry,ref=$REGISTRY/$REPO_NAME:cache-deps \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache-native-modules,mode=max \
    .

echo "📦 Warming Playwright install layer cache..."
docker buildx build \
    --platform linux/amd64 \
    --target playwright-install \
    --cache-from type=registry,ref=$REGISTRY/$REPO_NAME:cache-native-modules \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache-playwright-install,mode=max \
    .

# Warm Python service cache
echo "🐍 Warming Python service cache..."
docker buildx build \
    --platform linux/amd64 \
    --target deps \
    --cache-to type=registry,ref=$REGISTRY/$REPO_NAME-python-pdf:cache-deps,mode=max \
    ./python-pdf-service

echo "✅ Cache warming completed!"
echo "🚀 Subsequent builds should be significantly faster!"

# Clean up builder
docker buildx rm cache-warmer || true
