# 🚀 Complete CI/CD Deployment Guide for Fantastic Robo

## 📋 Prerequisites

-   Digital Ocean account
-   GitHub repository with your code
-   Domain name (optional, but recommended)

## 🌊 Step 1: Create Digital Ocean Droplet

1. **Create Droplet:**

    ```
    Distribution: Ubuntu 22.04 LTS
    Plan: Basic ($12/month)
    CPU: 1 vCPU, 2GB RAM, 50GB SSD
    Region: Choose closest to your users
    Authentication: SSH Key (recommended)
    ```

2. **Get Droplet IP:**
    ```bash
    # Note down your droplet's public IP address
    # Example: 138.197.123.456
    ```

## 🔧 Step 2: Setup Your Droplet

1. **SSH into your droplet:**

    ```bash
    ssh root@YOUR_DROPLET_IP
    ```

2. **Run the setup script:**

    ```bash
    # Clone your repository
    git clone https://github.com/YOUR_USERNAME/fantastic-robo.git
    cd fantastic-robo

    # Make setup script executable and run it
    chmod +x scripts/setup-droplet.sh
    ./scripts/setup-droplet.sh
    ```

3. **Logout and login again** (to apply Docker group changes):
    ```bash
    exit
    ssh root@YOUR_DROPLET_IP
    ```

## 🔐 Step 3: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and Variables → Actions

Add these **Repository Secrets:**

### **Digital Ocean Connection:**

```
DO_HOST = YOUR_DROPLET_IP
DO_USERNAME = root
DO_SSH_KEY = YOUR_PRIVATE_SSH_KEY
DO_PORT = 22
```

### **API Keys (from your current .env):**

```
EMBEDDINGS_MODEL_API_KEY = your_embedding_model_key
EMBEDDINGS_MODEL_ENDPOINT = your_embedding_model_endpoint
EMBEDDINGS_MODEL_DEPLOYMENT_NAME = your_deployment_name
EMBEDDINGS_MODEL_API_VERSION = 2024-06-01
LLM_API_KEY = your_llm_api_key
LLM_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL = gemini-2.0-flash-exp
HACKRX_AUTH_TOKEN = your_hackrx_auth_token
LANGCHAIN_TRACING_V2 = true
LANGCHAIN_API_KEY = your_langsmith_key
LANGCHAIN_PROJECT = fantastic-robo-production
```

**Note:** The new `LLM_BASE_URL` and `LLM_MODEL` variables allow you to use different LLM providers:

-   Gemini: Use the values shown above
-   Claude: Set `LLM_BASE_URL=https://api.anthropic.com/v1/` and `LLM_MODEL=claude-3-5-sonnet-20241022`
-   OpenAI: Set `LLM_BASE_URL=https://api.openai.com/v1/` and `LLM_MODEL=gpt-4o`

### **How to get SSH Key:**

```bash
# On your local machine (if you don't have SSH key)
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Copy your private key content
cat ~/.ssh/id_rsa

# Copy your public key to droplet
ssh-copy-id root@YOUR_DROPLET_IP
```

## 🚀 Step 4: Deploy!

1. **Trigger deployment:**

    ```bash
    # Make any small change and push to main
    git add .
    git commit -m "feat: trigger initial deployment"
    git push origin main
    ```

2. **Watch the deployment:**
    - Go to GitHub → Actions tab
    - Watch your deployment pipeline run
    - Should complete in 3-5 minutes

## 🔍 Step 5: Verify Deployment

1. **Check if your API is live:**

    ```bash
    curl http://YOUR_DROPLET_IP:3000/healthcheck
    ```

2. **Test PDF processing:**
    ```bash
    curl -X POST http://YOUR_DROPLET_IP:3000/api/pdf/process \
      -H "Content-Type: application/json" \
      -d '{
        "pdfUrl": "https://example.com/sample.pdf",
        "questions": ["What is this document about?"]
      }'
    ```

## 📊 Step 6: Monitor Your Application

### **On your droplet, you can use:**

```bash
# Check application status
fr-status

# View live logs
fr-logs

# Restart application
fr-restart

# System resources
htop
```

### **Useful monitoring commands:**

```bash
# Check Docker containers
docker ps

# View application logs
docker logs fantastic-robo -f --tail 100

# Check system resources
free -h
df -h

# Check if port is accessible
sudo netstat -tlnp | grep :3000
```

### **🔍 LangSmith Monitoring Troubleshooting:**

If monitoring isn't working in production, use these diagnostic tools:

```bash
# 1. Verify LangSmith setup
./scripts/verify-langsmith-setup.sh

# 2. Diagnose monitoring issues
./scripts/diagnose-monitoring.sh

# 3. Check monitoring status in healthcheck
curl http://localhost:3000/healthcheck | jq '.data.monitoring'

# 4. Test environment variables in container
docker exec fantastic-robo printenv | grep LANGCHAIN

# 5. Check application logs for monitoring errors
docker logs fantastic-robo 2>&1 | grep -i "langsmith\|monitoring"
```

**Common Production Issues:**

1. **Environment Variables Not Set:**

    ```bash
    # Verify in GitHub Secrets:
    # LANGCHAIN_TRACING_V2=true
    # LANGCHAIN_API_KEY=your_api_key
    # LANGCHAIN_PROJECT=fantastic-robo-production
    ```

2. **Network Connectivity Issues:**

    ```bash
    # Test from inside container
    docker exec fantastic-robo curl -s https://api.smith.langchain.com
    ```

3. **Authentication Failures:**
    ```bash
    # Test API key manually
    curl -H "Authorization: Bearer YOUR_API_KEY" https://api.smith.langchain.com/projects
    ```

**Monitor your traces at:** [smith.langchain.com](https://smith.langchain.com)

## 🔧 Step 7: Optional Enhancements

### **A. Setup Domain Name (Recommended):**

```bash
# Install Nginx
sudo apt install nginx

# Configure Nginx as reverse proxy
sudo tee /etc/nginx/sites-available/fantastic-robo > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/fantastic-robo /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### **B. Setup SSL with Let's Encrypt:**

```bash
# Install Certbot
sudo apt install snapd
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

### **C. Setup Log Monitoring:**

```bash
# Install log monitoring
sudo apt install logwatch

# Create daily log report
echo "0 6 * * * /usr/sbin/logwatch --output mail --mailto your@email.com --detail high" | sudo crontab -
```

## 🚨 Troubleshooting

### **If deployment fails:**

```bash
# Check GitHub Actions logs
# Then SSH to droplet and check:

# Container status
docker ps -a

# Container logs
docker logs fantastic-robo

# System resources
free -h
df -h

# Port availability
sudo lsof -i :3000
```

### **If container won't start:**

```bash
# Check Docker daemon
sudo systemctl status docker

# Check if port is busy
sudo netstat -tlnp | grep :3000

# Restart Docker if needed
sudo systemctl restart docker
```

### **Memory issues:**

```bash
# Check memory usage
free -h

# Add swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 🎉 You're Done!

Your **fantastic-robo** API is now:

-   ✅ Deployed on Digital Ocean
-   ✅ Auto-deploying on every push to main
-   ✅ Running in Docker with proper resource limits
-   ✅ Health-checked and monitored
-   ✅ Secured with firewall
-   ✅ Ready for production traffic

### **Your API endpoints:**

-   🏥 Health Check: `http://YOUR_DROPLET_IP:3000/healthcheck`
-   📄 PDF Processing: `http://YOUR_DROPLET_IP:3000/api/pdf/process`

### **Next Steps:**

1. Test your API thoroughly
2. Set up domain name and SSL
3. Monitor logs and performance
4. Scale up droplet if needed

**Happy coding! 🚀**
