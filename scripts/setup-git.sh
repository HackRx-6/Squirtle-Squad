#!/bin/bash

# Git setup script for production container
# This script sets up Git repository and remote configuration

set -e

echo "🔧 Setting up Git configuration..."

# Configure Git user (these can be overridden by environment variables)
GIT_USER_EMAIL=${GIT_USER_EMAIL:-"ai@hackrx.com"}
GIT_USER_NAME=${GIT_USER_NAME:-"AI Assistant"}
GIT_REPO_URL=${GIT_REPO_URL:-"https://github.com/HackRx-6/Squirtle-Squad.git"}

# Set Git configuration
git config --global user.email "$GIT_USER_EMAIL"
git config --global user.name "$GIT_USER_NAME"
git config --global init.defaultBranch main

# Configure Git to handle push behavior for new branches
git config --global push.default simple
git config --global push.autoSetupRemote true

# Configure authentication if GitHub token is provided
if [ ! -z "$GITHUB_TOKEN" ]; then
    echo "🔐 Configuring GitHub token authentication..."
    
    # Set up credential helper with store
    git config --global credential.helper 'store --file=/tmp/.git-credentials'
    
    # Create credentials file with proper permissions
    echo "https://$GITHUB_TOKEN@github.com" > /tmp/.git-credentials
    chmod 600 /tmp/.git-credentials
    
    # Also configure URL rewriting for GitHub
    git config --global url."https://$GITHUB_TOKEN@github.com/".insteadOf "https://github.com/"
    
    echo "✅ GitHub token authentication configured"
else
    echo "⚠️ GITHUB_TOKEN not provided, using default authentication"
fi

# Check if we're already in a Git repository
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
    
    # Add remote origin
    echo "🔗 Adding remote origin: $GIT_REPO_URL"
    git remote add origin "$GIT_REPO_URL"
    
    # Try to fetch the remote repository to sync with existing content
    echo "🔄 Fetching remote repository..."
    if git fetch origin main 2>/dev/null; then
        echo "✅ Remote repository fetched successfully"
        # Check if remote has content
        if git ls-remote --heads origin main | grep -q main; then
            echo "🔀 Setting up branch tracking with remote main..."
            # Create local main branch tracking remote
            git checkout -b main origin/main 2>/dev/null || git checkout main 2>/dev/null || true
            git branch --set-upstream-to=origin/main main 2>/dev/null || true
        else
            echo "📝 Remote repository is empty, will set upstream on first push"
        fi
    else
        echo "⚠️ Could not fetch remote repository (may be empty or authentication issue)"
        echo "📝 Will set upstream branch on first push"
    fi
else
    echo "✅ Git repository already exists"
    
    # Update remote URL if needed
    if git remote get-url origin >/dev/null 2>&1; then
        current_url=$(git remote get-url origin)
        expected_url="$GIT_REPO_URL"
        
        if [ "$current_url" != "$expected_url" ]; then
            echo "🔄 Updating remote URL to: $expected_url"
            git remote set-url origin "$expected_url"
        fi
    else
        echo "🔗 Adding remote origin: $GIT_REPO_URL"
        git remote add origin "$GIT_REPO_URL"
    fi
    
    # Ensure the current branch has upstream tracking
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
    echo "📍 Current branch: $CURRENT_BRANCH"
    
    # Check if current branch has upstream
    if ! git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" >/dev/null 2>&1; then
        echo "🔗 Setting up upstream tracking for $CURRENT_BRANCH..."
        # Try to set upstream if remote branch exists
        if git ls-remote --heads origin "$CURRENT_BRANCH" | grep -q "$CURRENT_BRANCH"; then
            git branch --set-upstream-to=origin/"$CURRENT_BRANCH" "$CURRENT_BRANCH" 2>/dev/null || true
            echo "✅ Upstream tracking configured for $CURRENT_BRANCH"
        else
            echo "📝 Remote branch doesn't exist yet, will set upstream on first push"
        fi
    else
        echo "✅ Upstream tracking already configured"
    fi
fi

echo "✅ Git setup completed"

# Verify configuration
echo "📋 Git configuration:"
echo "  User: $(git config user.name) <$(git config user.email)>"
echo "  Remote: $(git remote get-url origin 2>/dev/null | sed 's/:[^@]*@/:***@/' || echo 'No remote configured')"

# Test connectivity if token is provided
if [ ! -z "$GITHUB_TOKEN" ]; then
    echo "🔍 Testing Git connectivity..."
    if git ls-remote origin HEAD >/dev/null 2>&1; then
        echo "✅ Git authentication working"
    else
        echo "⚠️ Git authentication test failed - check token permissions"
    fi
fi
