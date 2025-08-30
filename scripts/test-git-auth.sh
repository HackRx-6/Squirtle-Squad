#!/bin/bash

# Git Authentication Test Script
# Tests if Git authentication is properly configured

echo "🧪 Git Authentication Test"
echo "=========================="
echo ""

# Check environment variables
echo "📋 Environment Check:"
echo "  GITHUB_TOKEN: $([ -n "$GITHUB_TOKEN" ] && echo '✅ Set (length: '${#GITHUB_TOKEN}')' || echo '❌ Not set')"
echo "  GIT_USER_NAME: $([ -n "$GIT_USER_NAME" ] && echo "$GIT_USER_NAME" || echo 'Not set')"
echo "  GIT_USER_EMAIL: $([ -n "$GIT_USER_EMAIL" ] && echo "$GIT_USER_EMAIL" || echo 'Not set')"
echo ""

# Check Git configuration
echo "🔧 Git Configuration:"
echo "  User name: $(git config user.name || echo 'Not set')"
echo "  User email: $(git config user.email || echo 'Not set')"
echo "  Credential helper: $(git config credential.helper || echo 'Not set')"
echo "  URL rewriting: $(git config --get-regexp 'url\..*\.insteadof' || echo 'Not configured')"
echo ""

# Check repository status
echo "📁 Repository Status:"
if [ -d ".git" ]; then
    echo "  ✅ Git repository detected"
    echo "  Current branch: $(git branch --show-current 2>/dev/null || echo 'Unknown')"
    echo "  Remote URL: $(git remote get-url origin 2>/dev/null || echo 'No remote')"
else
    echo "  ❌ Not a Git repository"
    exit 1
fi
echo ""

# Test authentication
echo "🔐 Authentication Test:"
if [ -n "$GITHUB_TOKEN" ]; then
    echo "  Testing GitHub connectivity..."
    
    # Test with ls-remote (doesn't require write access)
    if git ls-remote origin HEAD >/dev/null 2>&1; then
        echo "  ✅ GitHub authentication working (read access)"
    else
        echo "  ❌ GitHub authentication failed (read access)"
        echo "     This could indicate:"
        echo "     - Invalid GitHub token"
        echo "     - Token lacks repository access"
        echo "     - Network connectivity issues"
    fi
    
    # Test if we can fetch (also read access)
    echo "  Testing fetch operation..."
    if git fetch --dry-run origin >/dev/null 2>&1; then
        echo "  ✅ Fetch operation would succeed"
    else
        echo "  ❌ Fetch operation would fail"
    fi
else
    echo "  ⚠️ Cannot test authentication (GITHUB_TOKEN not set)"
fi
echo ""

# Test push setup (without actually pushing)
echo "🚀 Push Configuration Test:"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -n "$CURRENT_BRANCH" ]; then
    echo "  Current branch: $CURRENT_BRANCH"
    
    # Check if upstream is configured
    UPSTREAM=$(git rev-parse --abbrev-ref "$CURRENT_BRANCH@{upstream}" 2>/dev/null)
    if [ -n "$UPSTREAM" ]; then
        echo "  ✅ Upstream configured: $UPSTREAM"
    else
        echo "  ⚠️ No upstream configured for $CURRENT_BRANCH"
        echo "     Next push will automatically set upstream to origin/$CURRENT_BRANCH"
    fi
    
    # Check if there are any changes to push
    if git diff --quiet && git diff --cached --quiet; then
        echo "  ℹ️ No changes to push"
    else
        echo "  📝 There are uncommitted changes"
    fi
else
    echo "  ❌ Cannot determine current branch"
fi
echo ""

# Summary
echo "📊 Summary:"
if [ -n "$GITHUB_TOKEN" ] && git ls-remote origin HEAD >/dev/null 2>&1; then
    echo "  🎉 Git authentication is working correctly!"
    echo "  💡 You should be able to push to GitHub successfully"
else
    echo "  ⚠️ Git authentication needs attention"
    echo "  🔧 Recommended actions:"
    echo "     - Verify GITHUB_TOKEN is set correctly"
    echo "     - Check token has appropriate repository permissions"
    echo "     - Run setup-git.sh script to reconfigure"
fi

echo ""
echo "🏁 Test complete!"
