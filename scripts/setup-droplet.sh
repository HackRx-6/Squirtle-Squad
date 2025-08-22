#!/bin/bash

# 🌊 Digital Ocean Droplet Setup Script for Fantastic Robo
# Run this script on your fresh Digital Ocean droplet

set -e

echo "🚀 Setting up Digital Ocean droplet for Fantastic Robo..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo "🔧 Installing essential packages..."
sudo apt install -y \
    curl \
    wget \
    git \
    htop \
    ufw \
    nginx \
    certbot \
    python3-certbot-nginx \
    unzip

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
rm get-docker.sh

# Install Docker Compose
echo "🐙 Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
sudo ufw --force enable

# Create app directory
echo "📁 Creating application directory..."
sudo mkdir -p /var/log/fantastic-robo
sudo chown -R $USER:$USER /var/log/fantastic-robo

# Create systemd service for container management
echo "⚙️ Creating systemd service..."
sudo tee /etc/systemd/system/fantastic-robo.service > /dev/null <<EOF
[Unit]
Description=Fantastic Robo PDF API
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/$USER
ExecStart=/usr/bin/docker start fantastic-robo
ExecStop=/usr/bin/docker stop fantastic-robo
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Enable the service
sudo systemctl daemon-reload
sudo systemctl enable fantastic-robo.service

# Setup Nginx reverse proxy (optional)
echo "🌐 Setting up Nginx reverse proxy..."
sudo tee /etc/nginx/sites-available/fantastic-robo > /dev/null <<EOF
server {
    listen 80;
    server_name _;  # Replace with your domain

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
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        
        # Increase client_max_body_size for PDF uploads
        client_max_body_size 50M;
    }

    location /healthcheck {
        proxy_pass http://localhost:3000/healthcheck;
        access_log off;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/fantastic-robo /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Create deployment script
echo "📋 Creating deployment helper script..."
tee ~/deploy-fantastic-robo.sh > /dev/null <<'EOF'
#!/bin/bash

# Manual deployment script
echo "🚀 Deploying Fantastic Robo manually..."

IMAGE_NAME="ghcr.io/USERNAME/fantastic-robo:latest"  # Replace USERNAME
CONTAINER_NAME="fantastic-robo"

# Stop existing container
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

# Pull latest image
echo "📥 Pulling latest image..."
docker pull $IMAGE_NAME

# Start new container
echo "🌟 Starting container..."
docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e EMBEDDINGS_MODEL_API_KEY="$EMBEDDINGS_MODEL_API_KEY" \
  -e EMBEDDINGS_MODEL_ENDPOINT="$EMBEDDINGS_MODEL_ENDPOINT" \
  -e EMBEDDINGS_MODEL_DEPLOYMENT_NAME="$EMBEDDINGS_MODEL_DEPLOYMENT_NAME" \
  -e EMBEDDINGS_MODEL_API_VERSION="$EMBEDDINGS_MODEL_API_VERSION" \
  -e LLM_API_KEY="$LLM_API_KEY" \
  -e LLM_BASE_URL="$LLM_BASE_URL" \
  -e LLM_MODEL="$LLM_MODEL" \
  -e LANGCHAIN_TRACING_V2="$LANGCHAIN_TRACING_V2" \
  -e LANGCHAIN_API_KEY="$LANGCHAIN_API_KEY" \
  -e LANGCHAIN_PROJECT="$LANGCHAIN_PROJECT" \
  -v /var/log/fantastic-robo:/app/logs \
  --memory="2g" \
  --memory-reservation="1g" \
  $IMAGE_NAME

echo "✅ Deployment complete!"
docker ps | grep $CONTAINER_NAME
EOF

chmod +x ~/deploy-fantastic-robo.sh

# Create environment variables template
echo "📝 Creating environment variables template..."
tee ~/.env.production > /dev/null <<EOF
# Production Environment Variables for Fantastic Robo
# Copy this file and update with your actual values

export EMBEDDINGS_MODEL_API_KEY="your-embedding-model-key-here"
export EMBEDDINGS_MODEL_ENDPOINT="https://your-resource.openai.azure.com"
export EMBEDDINGS_MODEL_DEPLOYMENT_NAME="text-embedding-3-large"
export EMBEDDINGS_MODEL_API_VERSION="2024-06-01"
export LLM_API_KEY="your-llm-api-key-here"
export LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
export LLM_MODEL="gemini-2.0-flash-exp"
export LANGCHAIN_TRACING_V2="true"
export LANGCHAIN_API_KEY="your-langsmith-api-key-here"
export LANGCHAIN_PROJECT="fantastic-robo-rag"

# Usage: source ~/.env.production before running deploy script
EOF

# Create monitoring script
echo "📊 Creating monitoring script..."
tee ~/monitor-fantastic-robo.sh > /dev/null <<'EOF'
#!/bin/bash

echo "📊 Fantastic Robo Monitoring Dashboard"
echo "======================================"

# Container status
echo "🐳 Container Status:"
docker ps -a --filter name=fantastic-robo --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "💾 Memory Usage:"
docker stats fantastic-robo --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo ""
echo "📝 Recent Logs (last 20 lines):"
docker logs fantastic-robo --tail 20

echo ""
echo "🏥 Health Check:"
curl -s http://localhost:3000/healthcheck | jq . 2>/dev/null || echo "Health check failed"

echo ""
echo "🌐 Nginx Status:"
sudo systemctl status nginx --no-pager -l

echo ""
echo "🔥 Firewall Status:"
sudo ufw status

echo ""
echo "💽 Disk Usage:"
df -h /

echo ""
echo "🔄 System Uptime:"
uptime
EOF

chmod +x ~/monitor-fantastic-robo.sh

echo ""
echo "✅ Digital Ocean droplet setup complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Logout and login again (or run: newgrp docker)"
echo "2. Edit ~/.env.production with your actual environment variables"
echo "3. Update ~/deploy-fantastic-robo.sh with your GitHub username"
echo "4. Set up GitHub Secrets in your repository"
echo "5. Push to main branch to trigger automatic deployment"
echo ""
echo "🛠️ Useful Commands:"
echo "• Monitor app: ~/monitor-fantastic-robo.sh"
echo "• Manual deploy: ~/deploy-fantastic-robo.sh"  
echo "• View logs: docker logs fantastic-robo -f"
echo "• Restart app: docker restart fantastic-robo"
echo ""
echo "🌐 Your API will be available at:"
echo "• Direct: http://$(curl -s ifconfig.me):3000"
echo "• Via Nginx: http://$(curl -s ifconfig.me)"
echo "• Health check: http://$(curl -s ifconfig.me)/healthcheck"
