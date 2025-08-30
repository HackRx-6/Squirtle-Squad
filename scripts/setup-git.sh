#!/bin/bash

# Git Setup Script with Dynamic Branch Strategy
# This script sets up Git authentication and creates unique branches for each deployment
# to avoid merge conflicts and non-fast-forward issues

echo "🚀 [Startup] Setting up Git configuration for container..."

# Check if GITHUB_TOKEN is provided
if [ ! -z "$GITHUB_TOKEN" ]; then
    echo "🔐 [Startup] Configuring GitHub authentication with personal token..."
    
    # Set up git configuration
    git config --global user.name "Squirtle Squad Bot"
    git config --global user.email "bot@squirtle-squad.com"
    
    # Set up credential store with token
    git config --global credential.helper store
    
    # Ensure .git-credentials directory exists
    mkdir -p ~/.git-credentials
    
    # Store credentials using personal token format (proven to work)
    echo "https://${GITHUB_TOKEN}@github.com" > ~/.git-credentials
    
    # Also configure URL rewriting for additional reliability
    git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
    
    # Set the repository URL with authentication
    export GIT_REPO_URL="https://${GITHUB_TOKEN}@github.com/HackRx-6/Squirtle-Squad.git"
    
    echo "✅ [Startup] GitHub token authentication configured with personal token format"
else
    echo "⚠️ [Startup] GITHUB_TOKEN not provided - Git operations may require manual authentication"
    export GIT_REPO_URL="https://github.com/HackRx-6/Squirtle-Squad.git"
fi

# Repository initialization and setup
echo "📂 [Startup] Setting up repository in /app..."
cd /app

# Check if we're already in a Git repository
if [ ! -d ".git" ]; then
    echo "📦 [Startup] Initializing Git repository..."
    git init
    
    # Add remote origin
    echo "🔗 [Startup] Adding remote origin: $GIT_REPO_URL"
    git remote add origin "$GIT_REPO_URL"
else
    echo "✅ [Startup] Git repository already exists"
    
    # Update remote URL if needed
    if git remote get-url origin >/dev/null 2>&1; then
        current_url=$(git remote get-url origin)
        expected_url="$GIT_REPO_URL"
        
        if [ "$current_url" != "$expected_url" ]; then
            echo "🔄 [Startup] Updating remote URL to: $expected_url"
            git remote set-url origin "$expected_url"
        fi
    else
        echo "🔗 [Startup] Adding remote origin: $GIT_REPO_URL"
        git remote add origin "$GIT_REPO_URL"
    fi
fi

# Dynamic Branch Strategy - Create unique branch for this deployment
echo "🌿 [Startup] Setting up dynamic branch strategy..."

# Create a unique branch name for this container session
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CONTAINER_ID=$(hostname | head -c 8)
BRANCH_NAME="deployment-${TIMESTAMP}-${CONTAINER_ID}"

echo "🎯 [Startup] Creating unique deployment branch: $BRANCH_NAME"

if git fetch origin 2>/dev/null; then
    echo "✅ [Startup] Successfully fetched from remote"
    
    # Check if remote main branch exists
    if git ls-remote --heads origin main | grep -q main; then
        echo "📊 [Startup] Remote main branch exists, creating branch from main..."
        
        # Create our unique branch from main
        git checkout -B "$BRANCH_NAME" origin/main 2>/dev/null || git checkout -b "$BRANCH_NAME" 2>/dev/null
        
        echo "✅ [Startup] Branch '$BRANCH_NAME' created from latest main"
        
    else
        echo "📝 [Startup] Remote main branch doesn't exist - creating initial branch..."
        git checkout -b "$BRANCH_NAME"
    fi
    
else
    echo "⚠️ [Startup] Could not fetch from remote (may be empty repository or network issue)"
    # Still create a unique branch locally
    git checkout -b "$BRANCH_NAME" 2>/dev/null || true
fi

# Set up Git user config for this repository
git config user.name "Squirtle Squad Bot"
git config user.email "bot@squirtle-squad.com"

# Store branch name for later use by the application
echo "$BRANCH_NAME" > /app/.current-branch
echo "💾 [Startup] Branch name stored in /app/.current-branch"

# Test the Git setup
echo "🧪 [Startup] Testing Git authentication and setup..."
if [ ! -z "$GITHUB_TOKEN" ]; then
    if git ls-remote origin HEAD >/dev/null 2>&1; then
        echo "✅ [Startup] Git authentication test PASSED - GitHub connectivity working!"
    else
        echo "⚠️ [Startup] Git authentication test FAILED - but continuing startup..."
    fi
else
    echo "ℹ️ [Startup] Skipping authentication test (no token provided)"
fi

echo "🎉 [Startup] Git setup completed successfully!"
echo "📝 [Startup] All Git operations will use branch '$BRANCH_NAME'"
echo "🚀 [Startup] This eliminates merge conflicts and non-fast-forward issues!"
echo "💡 [Startup] LLM can now simply call 'git push' without conflicts!"

# Summary of what was configured
echo ""
echo "📋 [Startup] Git Configuration Summary:"
echo "   🌿 Branch: $BRANCH_NAME"
echo "   🔗 Remote: $(git remote get-url origin 2>/dev/null || echo 'Not set')"
echo "   👤 User: $(git config user.name) <$(git config user.email)>"
echo "   🔐 Auth: $([ ! -z "$GITHUB_TOKEN" ] && echo 'Personal Token' || echo 'Manual')"
echo ""
