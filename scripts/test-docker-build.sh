#!/bin/bash

# Docker Build Test Script
# Tests the Docker build locally to catch issues before CI/CD

echo "🐳 Docker Build Test for Node.js PDF Extraction"
echo "=============================================="

# Check if Docker is running
if ! docker --version &> /dev/null; then
    echo "❌ Docker is not installed or not running"
    exit 1
fi

echo "✅ Docker is available"

# Build the image
echo "🔨 Building Docker image..."
if docker build -t fantastic-robo-test . --no-cache; then
    echo "✅ Docker build successful"
else
    echo "❌ Docker build failed"
    exit 1
fi

# Test hnswlib-node native module
echo "🔍 Testing hnswlib-node native module..."
if docker run --rm fantastic-robo-test node -e "try { require('hnswlib-node'); console.log('✅ hnswlib-node loaded successfully'); } catch(e) { console.log('❌ hnswlib-node error:', e.message); process.exit(1); }"; then
    echo "✅ hnswlib-node is working"
else
    echo "❌ hnswlib-node test failed"
    exit 1
fi

# Test Playwright installation
echo "🎭 Testing Playwright installation..."
if docker run --rm fantastic-robo-test node -e "try { const { chromium } = require('playwright'); console.log('✅ Playwright loaded successfully'); } catch(e) { console.log('❌ Playwright error:', e.message); process.exit(1); }"; then
    echo "✅ Playwright is working"
else
    echo "❌ Playwright test failed"
    exit 1
fi

# Test if temp directory exists
echo "📁 Testing temp directory..."
if docker run --rm fantastic-robo-test ls -la /app/temp; then
    echo "✅ Temp directory exists"
else
    echo "❌ Temp directory test failed"
    exit 1
fi

# Test application startup (quick test)
echo "🚀 Testing application startup..."
CONTAINER_ID=$(docker run -d -p 3001:3000 fantastic-robo-test)

# Wait a moment for startup
sleep 5

# Test health endpoint
if curl -f http://localhost:3001/healthcheck &> /dev/null; then
    echo "✅ Application startup successful"
    docker stop $CONTAINER_ID > /dev/null
    docker rm $CONTAINER_ID > /dev/null
else
    echo "❌ Application startup failed"
    echo "Container logs:"
    docker logs $CONTAINER_ID
    docker stop $CONTAINER_ID > /dev/null
    docker rm $CONTAINER_ID > /dev/null
    exit 1
fi

# Cleanup test image
echo "🧹 Cleaning up test image..."
docker rmi fantastic-robo-test > /dev/null

echo ""
echo "🎉 All Docker build tests passed!"
echo "✅ Ready for deployment to Digital Ocean"
