#!/bin/bash

# 🧪 Pre-deployment local testing script
# Run this before pushing to ensure everything works

echo "🧪 Pre-deployment Testing for Fantastic Robo"
echo "============================================"
echo ""

# Check if required files exist
echo "📁 Checking required files..."
REQUIRED_FILES=(
    "src/index.ts"
    "package.json" 
    "Dockerfile"
    ".github/workflows/deploy.yml"
    "scripts/setup-droplet.sh"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file - MISSING!"
        exit 1
    fi
done
echo ""

# Check environment variables
echo "🔧 Checking environment variables..."
if [ -f ".env" ]; then
    echo "✅ .env file found"
    
    # Check for required env vars
    REQUIRED_VARS=(
        "EMBEDDINGS_MODEL_API_KEY"
        "EMBEDDINGS_MODEL_ENDPOINT" 
        "EMBEDDINGS_MODEL_DEPLOYMENT_NAME"
        "EMBEDDINGS_MODEL_API_VERSION"
        "LLM_API_KEY"
        "LANGCHAIN_API_KEY"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "$var=" .env; then
            echo "✅ $var configured"
        else
            echo "⚠️  $var not found in .env"
        fi
    done
else
    echo "⚠️  .env file not found - create from .env.example"
fi
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
if command -v bun >/dev/null; then
    bun install
    echo "✅ Dependencies installed"
else
    echo "❌ Bun not found - please install Bun first"
    exit 1
fi
echo ""

# Type check
echo "🔍 Running type check..."
if bun run --bun tsc --noEmit; then
    echo "✅ Type check passed"
else
    echo "❌ Type check failed"
    exit 1
fi
echo ""

# Build check
echo "🏗️  Testing build..."
if bun run build; then
    echo "✅ Build successful"
    rm -rf dist  # Clean up
else
    echo "❌ Build failed"
    exit 1
fi
echo ""

# Test Docker build (optional)
echo "🐳 Testing Docker build..."
read -p "Do you want to test Docker build? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if docker build -t fantastic-robo-test .; then
        echo "✅ Docker build successful"
        
        # Test container start
        echo "🧪 Testing container startup..."
        CONTAINER_ID=$(docker run -d --rm -p 3001:3000 \
            -e NODE_ENV=production \
            -e PORT=3000 \
            fantastic-robo-test)
        
        echo "⏳ Waiting for container to start..."
        sleep 5
        
        # Test health check
        if curl -s -f http://localhost:3001/healthcheck > /dev/null; then
            echo "✅ Container health check passed"
        else
            echo "⚠️  Container health check failed (might need API keys)"
        fi
        
        # Clean up
        docker stop $CONTAINER_ID > /dev/null
        docker rmi fantastic-robo-test > /dev/null
        
    else
        echo "❌ Docker build failed"
    fi
fi
echo ""

# Git status check
echo "📋 Git repository status..."
if git status --porcelain | grep -q .; then
    echo "⚠️  Uncommitted changes detected:"
    git status --short
    echo ""
    echo "💡 Commit your changes before deployment"
else
    echo "✅ Repository is clean"
fi
echo ""

# Check GitHub Actions workflow
echo "🔍 Validating GitHub Actions workflow..."
if command -v gh >/dev/null; then
    if gh workflow view "🚀 Deploy to Digital Ocean" >/dev/null 2>&1; then
        echo "✅ GitHub Actions workflow found"
    else
        echo "⚠️  GitHub Actions workflow not found or GitHub CLI not authenticated"
    fi
else
    echo "⚠️  GitHub CLI not installed - cannot validate workflow"
fi
echo ""

echo "🎉 Pre-deployment tests complete!"
echo ""
echo "📋 Next steps:"
echo "1. Create your Digital Ocean droplet (2GB RAM minimum)"
echo "2. Configure GitHub repository secrets"
echo "3. Push to main branch: git push origin main"
echo "4. Watch deployment in GitHub Actions"
echo ""
echo "🔗 Useful links:"
echo "• GitHub Actions: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
echo "• Digital Ocean: https://cloud.digitalocean.com/droplets"
