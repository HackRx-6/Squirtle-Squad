#!/bin/bash

# Git Diagnostic Script
# Helps diagnose Git configuration and push issues

echo "🔍 Git Diagnostic Report"
echo "========================"
echo ""

# Basic Git info
echo "📍 Git Status:"
echo "  Current directory: $(pwd)"
echo "  Git version: $(git --version 2>/dev/null || echo 'Git not installed')"
echo ""

# Repository info
echo "📁 Repository Info:"
if [ -d ".git" ]; then
    echo "  ✅ Git repository detected"
    echo "  Repository root: $(git rev-parse --show-toplevel 2>/dev/null || echo 'Unknown')"
else
    echo "  ❌ Not a Git repository"
    exit 1
fi
echo ""

# Branch info
echo "🌿 Branch Information:"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -n "$CURRENT_BRANCH" ]; then
    echo "  Current branch: $CURRENT_BRANCH"
else
    echo "  ⚠️ No current branch detected"
fi

echo "  All branches:"
git branch -a 2>/dev/null | sed 's/^/    /'
echo ""

# Remote info
echo "🔗 Remote Configuration:"
if git remote >/dev/null 2>&1; then
    git remote -v | sed 's/^/  /'
    echo ""
    
    # Check each remote
    for remote in $(git remote); do
        echo "  Remote '$remote' status:"
        if git ls-remote --heads $remote >/dev/null 2>&1; then
            echo "    ✅ Accessible"
        else
            echo "    ❌ Not accessible"
        fi
    done
else
    echo "  ❌ No remotes configured"
fi
echo ""

# Upstream info
echo "🎯 Upstream Configuration:"
if [ -n "$CURRENT_BRANCH" ]; then
    UPSTREAM=$(git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" 2>/dev/null)
    if [ -n "$UPSTREAM" ]; then
        echo "  ✅ Upstream configured: $UPSTREAM"
    else
        echo "  ⚠️ No upstream configured for $CURRENT_BRANCH"
    fi
else
    echo "  ❌ Cannot check upstream (no current branch)"
fi
echo ""

# User configuration
echo "👤 User Configuration:"
echo "  Name: $(git config user.name || echo 'Not set')"
echo "  Email: $(git config user.email || echo 'Not set')"
echo ""

# Environment variables
echo "🔧 Environment Variables:"
echo "  GITHUB_TOKEN: $([ -n "$GITHUB_TOKEN" ] && echo '✅ Set' || echo '❌ Not set')"
echo "  GIT_USER_NAME: $([ -n "$GIT_USER_NAME" ] && echo "$GIT_USER_NAME" || echo 'Not set')"
echo "  GIT_USER_EMAIL: $([ -n "$GIT_USER_EMAIL" ] && echo "$GIT_USER_EMAIL" || echo 'Not set')"
echo "  GIT_REPO_URL: $([ -n "$GIT_REPO_URL" ] && echo "$GIT_REPO_URL" || echo 'Not set')"
echo ""

# Working directory status
echo "📝 Working Directory Status:"
if git status --porcelain >/dev/null 2>&1; then
    CHANGES=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$CHANGES" -gt 0 ]; then
        echo "  ⚠️ $CHANGES uncommitted changes"
        git status --short | sed 's/^/    /'
    else
        echo "  ✅ Working directory clean"
    fi
else
    echo "  ❌ Cannot determine status"
fi
echo ""

# Authentication test
echo "🔐 Authentication Test:"
if [ -n "$GITHUB_TOKEN" ] && git remote get-url origin >/dev/null 2>&1; then
    echo "  Testing GitHub connectivity..."
    if git ls-remote origin HEAD >/dev/null 2>&1; then
        echo "  ✅ GitHub authentication working"
    else
        echo "  ❌ GitHub authentication failed"
    fi
else
    echo "  ⚠️ Cannot test (missing token or remote)"
fi
echo ""

# Recommendations
echo "💡 Recommendations:"
if [ -z "$GITHUB_TOKEN" ]; then
    echo "  - Set GITHUB_TOKEN environment variable"
fi

if [ -z "$UPSTREAM" ] && [ -n "$CURRENT_BRANCH" ]; then
    echo "  - Set upstream branch: git push --set-upstream origin $CURRENT_BRANCH"
fi

if ! git ls-remote origin HEAD >/dev/null 2>&1; then
    echo "  - Check GitHub token permissions"
    echo "  - Verify repository URL is correct"
fi

echo ""
echo "🏁 Diagnostic complete!"
