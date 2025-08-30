#!/bin/bash

# Optimized build script for faster CI/CD builds
# Usage: ./scripts/fast-build.sh [--parallel] [--cache-push]

set -e

echo "🚀 Starting optimized build process..."

PARALLEL=false
CACHE_PUSH=false
REGISTRY="ghcr.io"
REPO_NAME="hackrx-6/squirtle-squad"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --parallel)
      PARALLEL=true
      shift
      ;;
    --cache-push)
      CACHE_PUSH=true
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Enable BuildKit
export DOCKER_BUILDKIT=1
export BUILDX_EXPERIMENTAL=1

# Set up buildx if not exists
if ! docker buildx inspect multiarch-builder >/dev/null 2>&1; then
    echo "🔧 Setting up Docker Buildx..."
    docker buildx create --name multiarch-builder --use --bootstrap
fi

# Build cache arguments
CACHE_ARGS_MAIN=""
CACHE_ARGS_PYTHON=""

if [ "$CACHE_PUSH" = true ]; then
    echo "📦 Building with cache push enabled..."
    CACHE_ARGS_MAIN="--cache-from type=registry,ref=$REGISTRY/$REPO_NAME:cache \
                     --cache-to type=registry,ref=$REGISTRY/$REPO_NAME:cache,mode=max"
    CACHE_ARGS_PYTHON="--cache-from type=registry,ref=$REGISTRY/$REPO_NAME-python-pdf:cache \
                       --cache-to type=registry,ref=$REGISTRY/$REPO_NAME-python-pdf:cache,mode=max"
else
    echo "📦 Building with local cache..."
    CACHE_ARGS_MAIN="--cache-from type=gha,scope=main-app"
    CACHE_ARGS_PYTHON="--cache-from type=gha,scope=python-service"
fi

if [ "$PARALLEL" = true ]; then
    echo "⚡ Running parallel builds..."
    
    # Start both builds in parallel
    docker buildx build \
        --platform linux/amd64 \
        --tag $REGISTRY/$REPO_NAME:latest \
        --tag $REGISTRY/$REPO_NAME:$(git rev-parse --short HEAD) \
        $CACHE_ARGS_MAIN \
        --load \
        . &
    
    docker buildx build \
        --platform linux/amd64 \
        --tag $REGISTRY/$REPO_NAME-python-pdf:latest \
        --tag $REGISTRY/$REPO_NAME-python-pdf:$(git rev-parse --short HEAD) \
        $CACHE_ARGS_PYTHON \
        --load \
        ./python-pdf-service &
    
    # Wait for both builds to complete
    wait
    
    echo "✅ Parallel builds completed successfully!"
else
    echo "🔄 Running sequential builds..."
    
    # Build Python service first (faster)
    echo "🐍 Building Python PDF service..."
    docker buildx build \
        --platform linux/amd64 \
        --tag $REGISTRY/$REPO_NAME-python-pdf:latest \
        --tag $REGISTRY/$REPO_NAME-python-pdf:$(git rev-parse --short HEAD) \
        $CACHE_ARGS_PYTHON \
        --load \
        ./python-pdf-service
    
    # Build main application
    echo "🌟 Building main application..."
    docker buildx build \
        --platform linux/amd64 \
        --tag $REGISTRY/$REPO_NAME:latest \
        --tag $REGISTRY/$REPO_NAME:$(git rev-parse --short HEAD) \
        $CACHE_ARGS_MAIN \
        --load \
        .
    
    echo "✅ Sequential builds completed successfully!"
fi

# Verify builds
echo "🔍 Verifying builds..."
docker images | grep -E "$REPO_NAME|python-pdf"

echo "🎉 Build process completed!"
echo "📊 Build summary:"
echo "  - Main app: $REGISTRY/$REPO_NAME:latest"
echo "  - Python service: $REGISTRY/$REPO_NAME-python-pdf:latest"
echo "  - Git SHA: $(git rev-parse --short HEAD)"
