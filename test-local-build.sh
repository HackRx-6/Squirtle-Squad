#!/bin/bash

echo "🧪 Testing local build and run..."

# Clean previous build
echo "🧹 Cleaning previous build..."
rm -rf dist/

# Build the application
echo "🔨 Building application..."
bun run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"

# Test running the built application
echo "🚀 Testing built application..."

# Set production environment variables
export NODE_ENV=production
export DOCKER_ENV=true
export PORT=3000
export INITIALIZE_PLAYWRIGHT=false

# Try to run the application for a few seconds
bun run dist/index.js &
PID=$!

sleep 5

# Check if process is still running
if kill -0 $PID 2>/dev/null; then
    echo "✅ Application started successfully!"
    kill $PID
    echo "🛑 Application stopped"
    exit 0
else
    echo "❌ Application failed to start!"
    exit 1
fi
