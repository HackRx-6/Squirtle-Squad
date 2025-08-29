#!/bin/bash

echo "🧪 Starting comprehensive local build test..."

# Clean up any previous build
echo "🧹 Cleaning previous build..."
rm -rf dist/

# Build the application
echo "🔨 Building application..."
if ! bun run build; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"

# Test the built application
echo "🚀 Testing built application..."

# Set production environment variables
export NODE_ENV=production
export DOCKER_ENV=true
export PORT=3000

# Start the application in background and capture PID
echo "▶️  Starting application..."
bun run dist/index.js &
APP_PID=$!

# Wait a moment for startup
sleep 2

# Check if process is still running
if ! kill -0 $APP_PID 2>/dev/null; then
    echo "❌ Application crashed during startup!"
    wait $APP_PID
    exit 1
fi

echo "✅ Application started successfully (PID: $APP_PID)"

# Let it run for 10 seconds to catch any late-loading issues
echo "⏳ Running for 10 seconds to test stability..."
sleep 10

# Check if still running
if ! kill -0 $APP_PID 2>/dev/null; then
    echo "❌ Application crashed after startup!"
    wait $APP_PID
    exit 1
fi

# Graceful shutdown
echo "🛑 Shutting down application..."
kill $APP_PID
wait $APP_PID 2>/dev/null

echo "✅ Local build test completed successfully!"
echo "🎉 Application should work in production!"
