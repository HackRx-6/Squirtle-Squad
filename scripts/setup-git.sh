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

# Configure authentication if GitHub token is provided
if [ ! -z "$GITHUB_TOKEN" ]; then
    echo "🔐 Configuring GitHub token authentication..."
    # Extract repository info from URL
    REPO_URL_WITH_TOKEN=$(echo "$GIT_REPO_URL" | sed "s|https://|https://$GITHUB_TOKEN@|")
    git config --global credential.helper store
    echo "$REPO_URL_WITH_TOKEN" | git credential approve 2>/dev/null || true
fi

# Check if we're already in a Git repository
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
    
    # Add remote origin
    echo "🔗 Adding remote origin: $GIT_REPO_URL"
    if [ ! -z "$GITHUB_TOKEN" ]; then
        # Use token-authenticated URL for remote
        REPO_URL_WITH_TOKEN=$(echo "$GIT_REPO_URL" | sed "s|https://|https://$GITHUB_TOKEN@|")
        git remote add origin "$REPO_URL_WITH_TOKEN"
    else
        git remote add origin "$GIT_REPO_URL"
    fi
else
    echo "✅ Git repository already exists"
    
    # Update remote URL if needed
    if git remote get-url origin >/dev/null 2>&1; then
        current_url=$(git remote get-url origin)
        expected_url="$GIT_REPO_URL"
        if [ ! -z "$GITHUB_TOKEN" ]; then
            expected_url=$(echo "$GIT_REPO_URL" | sed "s|https://|https://$GITHUB_TOKEN@|")
        fi
        
        if [ "$current_url" != "$expected_url" ]; then
            echo "🔄 Updating remote URL"
            git remote set-url origin "$expected_url"
        fi
    else
        echo "🔗 Adding remote origin: $GIT_REPO_URL"
        if [ ! -z "$GITHUB_TOKEN" ]; then
            REPO_URL_WITH_TOKEN=$(echo "$GIT_REPO_URL" | sed "s|https://|https://$GITHUB_TOKEN@|")
            git remote add origin "$REPO_URL_WITH_TOKEN"
        else
            git remote add origin "$GIT_REPO_URL"
        fi
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
