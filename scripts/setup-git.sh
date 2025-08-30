#!/bin/bash

# Git setup script for production container startup
# This script sets up Git repository and remote configuration ONCE at container start

set -e

echo "� [Startup] Setting up Git configuration for container..."

# Configure Git user (these can be overridden by environment variables)
GIT_USER_EMAIL=${GIT_USER_EMAIL:-"ai@hackrx.com"}
GIT_USER_NAME=${GIT_USER_NAME:-"AI Assistant"}
GIT_REPO_URL=${GIT_REPO_URL:-"https://github.com/HackRx-6/Squirtle-Squad.git"}

# Set Git configuration
echo "👤 [Startup] Configuring Git user..."
git config --global user.email "$GIT_USER_EMAIL"
git config --global user.name "$GIT_USER_NAME"
git config --global init.defaultBranch main

# Configure Git to handle push behavior for new branches
git config --global push.default simple
git config --global push.autoSetupRemote true

# ROBUST GitHub Authentication Setup (using personal token format that works)
if [ ! -z "$GITHUB_TOKEN" ]; then
    echo "🔐 [Startup] Configuring GitHub authentication with personal token..."
    echo "🔑 [Startup] Token type: ${GITHUB_TOKEN:0:4}... (length: ${#GITHUB_TOKEN})"
    
    # Method 1: Set up credential helper with store
    git config --global credential.helper 'store --file=/tmp/.git-credentials'
    
    # Method 2: Create credentials file with token format that works with personal tokens
    echo "https://$GITHUB_TOKEN:@github.com" > /tmp/.git-credentials
    chmod 600 /tmp/.git-credentials
    
    # Method 3: Configure URL rewriting for GitHub (fallback method)
    git config --global url."https://$GITHUB_TOKEN:@github.com/".insteadOf "https://github.com/"
    
    echo "✅ [Startup] GitHub token authentication configured with personal token format"
else
    echo "⚠️ [Startup] GITHUB_TOKEN not provided - Git operations may require manual authentication"
fi

# Repository initialization and sync
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
            echo "� [Startup] Updating remote URL to: $expected_url"
            git remote set-url origin "$expected_url"
        fi
    else
        echo "🔗 [Startup] Adding remote origin: $GIT_REPO_URL"
        git remote add origin "$GIT_REPO_URL"
    fi
fi

# Sync with remote repository (handle any existing content gracefully)
echo "🔄 [Startup] Syncing with remote repository..."
if git fetch origin 2>/dev/null; then
    echo "� [Startup] Successfully fetched from remote"
    
    # Check if remote main branch exists
    if git ls-remote --heads origin main | grep -q main; then
        echo "🌿 [Startup] Remote main branch exists, setting up tracking..."
        
        # Get current branch
        CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
        
        # If we're not on main, switch to main
        if [ "$CURRENT_BRANCH" != "main" ]; then
            echo "� [Startup] Switching to main branch..."
            git checkout -B main origin/main 2>/dev/null || git checkout -b main 2>/dev/null || true
        fi
        
        # Check if we have any local commits
        if git rev-parse HEAD >/dev/null 2>&1; then
            echo "📚 [Startup] Local commits exist, ensuring we're up to date..."
            # Set upstream tracking
            git branch --set-upstream-to=origin/main main 2>/dev/null || true
            # Merge any remote changes (favoring remote in case of conflicts)
            git pull origin main --no-edit --strategy=recursive -X theirs 2>/dev/null || true
        else
            echo "🔄 [Startup] No local commits, syncing with remote main..."
            git checkout -B main origin/main 2>/dev/null || true
            git branch --set-upstream-to=origin/main main 2>/dev/null || true
        fi
        
        echo "✅ [Startup] Successfully synced with remote main branch"
    else
        echo "📝 [Startup] Remote main branch doesn't exist - will be created on first push"
    fi
else
    echo "⚠️ [Startup] Could not fetch from remote (may be empty repository or network issue)"
fi

# Test the Git setup
echo "🧪 [Startup] Testing Git authentication and setup..."
if [ ! -z "$GITHUB_TOKEN" ]; then
    if git ls-remote origin HEAD >/dev/null 2>&1; then
        echo "✅ [Startup] Git authentication test PASSED - GitHub connectivity working!"
    else
        echo "⚠️ [Startup] Git authentication test FAILED - but continuing startup..."
        echo "    This might be due to network issues or token permissions"
    fi
else
    echo "ℹ️ [Startup] Skipping authentication test (no token provided)"
fi

echo "✅ [Startup] Git setup completed successfully!"

# Final status report
echo ""
echo "📋 [Startup] Git Configuration Summary:"
echo "  User: $(git config user.name) <$(git config user.email)>"
echo "  Remote: $(git remote get-url origin 2>/dev/null | sed 's/:[^@]*@/:***@/' || echo 'No remote configured')"
echo "  Branch: $(git branch --show-current 2>/dev/null || echo 'No branch')"
echo "  Upstream: $(git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo 'Not configured')"
echo "  Working directory: $(pwd)"

echo ""
echo "🎉 [Startup] Ready for Git operations!"
