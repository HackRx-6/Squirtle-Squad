# 🚀 CI/CD Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Local Testing

-   [ ] Run `./scripts/pre-deployment-test.sh`
-   [ ] Ensure all tests pass
-   [ ] Verify environment variables are set

### 2. GitHub Repository Setup

-   [ ] Code pushed to GitHub
-   [ ] Repository is public or you have GitHub Actions minutes
-   [ ] All commits are pushed to main branch

### 3. Digital Ocean Droplet

-   [ ] Create Ubuntu 22.04 droplet (2GB RAM minimum)
-   [ ] Note down the droplet IP address
-   [ ] Ensure SSH key is configured

## 🔐 GitHub Secrets Configuration

Go to: `GitHub Repository → Settings → Secrets and Variables → Actions`

### Required Secrets:

```
DO_HOST = your_droplet_ip_address
DO_USERNAME = root
DO_SSH_KEY = your_private_ssh_key_content
DO_PORT = 22

EMBEDDINGS_MODEL_API_KEY = your_embedding_model_key
EMBEDDINGS_MODEL_ENDPOINT = your_embedding_model_endpoint
EMBEDDINGS_MODEL_DEPLOYMENT_NAME = text-embedding-3-large
LLM_API_KEY = your_anthropic_key
LANGCHAIN_TRACING_V2 = true
LANGCHAIN_API_KEY = your_langsmith_key
LANGCHAIN_PROJECT = fantastic-robo-production
```

## 🌊 Droplet Setup Steps

### 1. SSH into your droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

### 2. Run setup script:

```bash
# Clone repo (replace with your username)
git clone https://github.com/YOUR_USERNAME/fantastic-robo.git
cd fantastic-robo

# Run setup
chmod +x scripts/setup-droplet.sh
./scripts/setup-droplet.sh
```

### 3. Logout and login again:

```bash
exit
ssh root@YOUR_DROPLET_IP
```

## 🚀 Deployment Steps

### 1. Trigger Deployment:

```bash
# On your local machine
git add .
git commit -m "feat: initial production deployment"
git push origin main
```

### 2. Monitor Deployment:

-   [ ] Go to GitHub → Actions tab
-   [ ] Watch the deployment workflow
-   [ ] Should complete in 3-5 minutes

### 3. Verify Deployment:

```bash
# On your droplet
./scripts/verify-deployment.sh
```

## ✅ Post-Deployment Verification

### 1. Health Check:

```bash
curl http://YOUR_DROPLET_IP:3000/healthcheck
```

Expected: `{"status":"ok","timestamp":"..."}`

### 2. API Test:

```bash
curl -X POST http://YOUR_DROPLET_IP:3000/api/pdf/process \
  -H "Content-Type: application/json" \
  -d '{
    "pdfUrl": "https://example.com/sample.pdf",
    "questions": ["What is this document about?"]
  }'
```

### 3. Monitor Application:

```bash
# On droplet
fr-status      # Check status
fr-logs        # View logs
htop           # System resources
```

## 🎯 Success Criteria

-   [ ] ✅ Container running: `docker ps | grep fantastic-robo`
-   [ ] ✅ Health check returns 200: `curl -f http://localhost:3000/healthcheck`
-   [ ] ✅ API endpoints responding
-   [ ] ✅ Logs show no errors: `fr-logs`
-   [ ] ✅ Memory usage < 1.5GB: `free -h`

## 🚨 Troubleshooting

### If deployment fails:

1. Check GitHub Actions logs
2. SSH to droplet and run: `docker logs fantastic-robo`
3. Check system resources: `free -h && df -h`
4. Restart container: `fr-restart`

### If container won't start:

```bash
# Check Docker daemon
sudo systemctl status docker

# Check available memory
free -h

# Check port conflicts
sudo ss -tlnp | grep :3000

# View detailed logs
docker logs fantastic-robo --tail 50
```

### Memory issues:

```bash
# Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 🎉 You're Live!

Once everything is ✅, your API is production-ready at:

-   **Health Check**: `http://YOUR_DROPLET_IP:3000/healthcheck`
-   **PDF Processing**: `http://YOUR_DROPLET_IP:3000/api/pdf/process`

### Automatic deployments:

Every push to `main` branch will automatically deploy! 🚀

### Monitoring:

-   Use `fr-status` for quick health checks
-   Use `fr-logs` to view real-time logs
-   Monitor via GitHub Actions for deployment status
