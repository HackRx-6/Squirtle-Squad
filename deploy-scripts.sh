#!/bin/bash

# Deploy missing scripts to production server
# Usage: ./deploy-scripts.sh

echo "📦 Deploying missing scripts to production..."

# List of new scripts to deploy
SCRIPTS=(
    "git-diagnose.sh"
    "git-push-helper.sh"
    "test-git-auth.sh"
    "quick-git-fix.sh"
)

# Check if we have the scripts locally
echo "🔍 Checking local scripts..."
for script in "${SCRIPTS[@]}"; do
    if [ -f "scripts/$script" ]; then
        echo "  ✅ Found: $script"
    else
        echo "  ❌ Missing: $script"
        exit 1
    fi
done

echo ""
echo "📋 You can deploy these scripts to production in several ways:"
echo ""
echo "Method 1 - Copy via SCP (if you have SSH access):"
echo "scp scripts/quick-git-fix.sh user@your-server:/app/scripts/"
echo ""
echo "Method 2 - Create directly on server:"
echo "# SSH to your server, then run:"
echo "cat > /app/scripts/quick-git-fix.sh << 'EOF'"
cat scripts/quick-git-fix.sh
echo "EOF"
echo "chmod +x /app/scripts/quick-git-fix.sh"
echo ""
echo "Method 3 - Redeploy the entire application:"
echo "git add ."
echo "git commit -m 'Add Git authentication fix scripts'"
echo "git push"
echo "# Wait for CI/CD to redeploy"
echo ""
echo "⚡ Quick fix for immediate use:"
echo "Copy the content of scripts/quick-git-fix.sh and run it directly on the server"
