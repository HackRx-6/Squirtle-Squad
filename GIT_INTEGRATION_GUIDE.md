# Git Integration Setup for Production

This guide explains how to set up Git integration for your LLM tool calls in production.

## The Problem

Your LLM tool is trying to execute Git commands (`git add`, `git commit`, `git push`) in the Docker container, but several issues prevent this from working:

1. **No Git repository**: Container `/app` directory needs to be a Git repository
2. **No remote configured**: No remote repository URL configured for pushing
3. **No authentication**: No credentials to authenticate with GitHub

## Solutions

### Option 1: GitHub Token Authentication (Recommended)

1. **Create a GitHub Personal Access Token:**

   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Generate a new token with `repo` permissions
   - Copy the token (you won't see it again)

2. **Set up environment variables:**

   ```bash
   # In your deployment environment
   export GITHUB_TOKEN="your_github_token_here"
   export GIT_REPO_URL="https://github.com/HackRx-6/Squirtle-Squad.git"
   ```

3. **Update your deployment to use the token:**

   ```bash
   # For Docker run
   docker run -e GITHUB_TOKEN=$GITHUB_TOKEN -e GIT_REPO_URL=$GIT_REPO_URL your-image

   # For Docker Compose
   environment:
     - GITHUB_TOKEN=${GITHUB_TOKEN}
     - GIT_REPO_URL=${GIT_REPO_URL}
   ```

4. **The container will automatically configure Git with the token**

### Option 2: SSH Key Authentication

1. **Generate SSH key pair:**

   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com" -f ./deploy_key
   ```

2. **Add public key to GitHub:**

   - Go to your repository → Settings → Deploy keys
   - Add the content of `deploy_key.pub`
   - Check "Allow write access"

3. **Mount private key in container:**
   ```bash
   docker run -v ./deploy_key:/root/.ssh/id_ed25519:ro your-image
   ```

### Option 3: Disable Git Operations (Quick Fix)

If you don't need Git operations, you can modify your LLM tool to skip Git commands:

1. **Add environment variable to disable Git:**

   ```bash
   export DISABLE_GIT_OPERATIONS=true
   ```

2. **Your terminal tool should check this variable before executing Git commands**

## Implementation Details

### Current Docker Setup

The Dockerfile now includes:

- Git installation in both build and production stages
- Git repository initialization
- Basic Git configuration
- Setup script for Git configuration

### Required Environment Variables

```bash
# Repository URL (required)
GIT_REPO_URL=https://github.com/HackRx-6/Squirtle-Squad.git

# Authentication (choose one)
GITHUB_TOKEN=your_github_token_here
# OR
SSH_PRIVATE_KEY_PATH=/path/to/private/key

# Optional: Custom Git user info
GIT_USER_EMAIL=ai@hackrx.com
GIT_USER_NAME="AI Assistant"
```

### Git Authentication in Container

The container startup script will:

1. Configure Git user information
2. Set up remote repository URL
3. Configure authentication (token or SSH)
4. Verify Git operations work

## Security Considerations

1. **Never commit tokens or private keys to the repository**
2. **Use environment variables or mounted secrets**
3. **Rotate tokens regularly**
4. **Use minimal permissions (only repo access)**
5. **Consider using GitHub Apps for better security**

## Troubleshooting

### Common Issues

1. **"not a git repository"**: Git not initialized in container

   - **Solution**: Ensure Dockerfile runs git initialization

2. **"No configured push destination"**: No remote repository configured

   - **Solution**: Set GIT_REPO_URL environment variable

3. **"Authentication failed"**: Invalid or missing credentials

   - **Solution**: Verify GITHUB_TOKEN is correct and has repo permissions

4. **"Permission denied"**: SSH key issues
   - **Solution**: Check SSH key permissions and GitHub deploy key setup

### Debug Commands

```bash
# Check Git configuration in container
docker exec -it container_name git config --list

# Check remote configuration
docker exec -it container_name git remote -v

# Test authentication
docker exec -it container_name git ls-remote origin

# Check environment variables
docker exec -it container_name env | grep GIT
```

## Production Deployment Checklist

- [ ] Git installed in Docker container
- [ ] Git repository initialized
- [ ] Remote repository URL configured
- [ ] Authentication method chosen and configured
- [ ] Environment variables set in deployment
- [ ] Git operations tested in staging environment
- [ ] Security review completed (no secrets in code)
