#!/bin/bash

# Quick Git Authentication Fix for Production
# Run this script on the production server to fix authentication issues

echo "🚀 Quick Git Authentication Fix"
echo "==============================="

# Check if we're in a Git repository
if [ ! -d ".git" ]; then
    echo "❌ Not in a Git repository"
    exit 1
fi

# Check if GITHUB_TOKEN is available
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ GITHUB_TOKEN environment variable not set"
    echo "Please set it with: export GITHUB_TOKEN=your_token_here"
    exit 1
fi

echo "🔑 Found GitHub token (${GITHUB_TOKEN:0:4}...)"

# Configure Git authentication with multiple methods
echo "🔧 Configuring Git authentication..."

# Method 1: Credential helper
git config credential.helper 'store --file=/tmp/.git-credentials'

# Method 2: Store credentials with token as username, empty password
echo "https://$GITHUB_TOKEN:@github.com" > /tmp/.git-credentials
chmod 600 /tmp/.git-credentials

# Method 3: URL rewriting
git config url."https://$GITHUB_TOKEN:@github.com/".insteadOf "https://github.com/"

# Method 4: Update remote URL directly
REPO_URL="https://github.com/HackRx-6/Squirtle-Squad.git"
AUTH_URL="https://$GITHUB_TOKEN:@github.com/HackRx-6/Squirtle-Squad.git"
git remote set-url origin "$AUTH_URL"

echo "✅ Git authentication configured"

# Test authentication
echo "🧪 Testing authentication..."
if git ls-remote origin HEAD >/dev/null 2>&1; then
    echo "✅ Authentication test successful!"
else
    echo "❌ Authentication test failed"
    echo "Error details:"
    git ls-remote origin HEAD
    exit 1
fi

# Check current branch and upstream
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Current branch: $CURRENT_BRANCH"

if ! git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" >/dev/null 2>&1; then
    echo "⚠️ No upstream configured for $CURRENT_BRANCH"
    echo "💡 Use: git push --set-upstream origin $CURRENT_BRANCH"
else
    echo "✅ Upstream already configured"
fi

echo ""
echo "🎉 Git authentication fix complete!"
echo "💡 You can now try: git push --set-upstream origin main"
