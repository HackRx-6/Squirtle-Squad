#!/bin/bash

# Git Push Helper Script
# Handles upstream branch configuration and provides better error logging

set -e

echo "🚀 Git Push Helper - Starting..."

# Get current branch
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
echo "📍 Current branch: $CURRENT_BRANCH"

# Check if we have any changes to commit
if git diff --quiet && git diff --cached --quiet; then
    echo "ℹ️ No changes to commit"
else
    echo "📝 Changes detected, they should be staged and committed first"
fi

# Check if upstream is configured
echo "🔍 Checking upstream configuration..."
if git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" >/dev/null 2>&1; then
    UPSTREAM=$(git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}")
    echo "✅ Upstream already configured: $UPSTREAM"
    
    # Do a simple push
    echo "🚀 Pushing to $UPSTREAM..."
    if git push; then
        echo "✅ Push successful!"
    else
        echo "❌ Push failed!"
        exit 1
    fi
else
    echo "⚠️ No upstream configured for $CURRENT_BRANCH"
    
    # Check if remote branch exists
    if git ls-remote --heads origin "$CURRENT_BRANCH" | grep -q "$CURRENT_BRANCH"; then
        echo "🔗 Remote branch exists, setting up tracking..."
        git branch --set-upstream-to=origin/"$CURRENT_BRANCH" "$CURRENT_BRANCH"
        echo "🚀 Pushing with existing remote branch..."
        git push
    else
        echo "🆕 Remote branch doesn't exist, creating and setting upstream..."
        if git push --set-upstream origin "$CURRENT_BRANCH"; then
            echo "✅ Push with upstream setup successful!"
        else
            echo "❌ Push with upstream setup failed!"
            exit 1
        fi
    fi
fi

echo "🎉 Git push completed successfully!"
