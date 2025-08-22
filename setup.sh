#!/bin/bash

# Simple setup script for Fantastic Robo with Python PDF Service

echo "🚀 Setting up Fantastic Robo with Python PDF Service"
echo "===================================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo -e "${YELLOW}Download from: https://www.docker.com/products/docker-desktop${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is installed${NC}"

# Check if Docker is running
if ! docker ps &> /dev/null; then
    echo -e "${RED}❌ Docker is not running. Please start Docker.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"

# Build Python PDF service
echo -e "\n${CYAN}🐍 Building Python PDF service...${NC}"
if docker build -t python-pdf-service ./python-pdf-service; then
    echo -e "${GREEN}✅ Python PDF service built successfully${NC}"
else
    echo -e "${RED}❌ Failed to build Python PDF service${NC}"
    exit 1
fi

# Start Python PDF service
echo -e "\n${CYAN}🚀 Starting Python PDF service...${NC}"

# Stop existing container if running
docker stop python-pdf-service 2>/dev/null || true
docker rm python-pdf-service 2>/dev/null || true

# Start new container with environment variables
if docker run -d --name python-pdf-service -p 8000:8000 --env-file .env python-pdf-service; then
    echo -e "${GREEN}✅ Python PDF service started on port 8000${NC}"
else
    echo -e "${RED}❌ Failed to start Python PDF service${NC}"
    exit 1
fi

# Wait for service to be ready
echo -e "\n${CYAN}⏳ Waiting for Python PDF service to be ready...${NC}"
max_wait=30
waited=0

while [ $waited -lt $max_wait ]; do
    if curl -s http://localhost:8000/health | grep -q "healthy"; then
        echo -e "${GREEN}✅ Python PDF service is healthy!${NC}"
        break
    fi
    
    sleep 2
    waited=$((waited + 2))
    echo -e "${YELLOW}  Waiting... ($waited/$max_wait seconds)${NC}"
done

if [ $waited -ge $max_wait ]; then
    echo -e "${YELLOW}⚠️ Python PDF service took longer than expected to start${NC}"
    echo -e "Check logs with: docker logs python-pdf-service"
fi

echo -e "\n${GREEN}🎉 Setup complete!${NC}"
echo -e "${GREEN}==================${NC}"
echo ""
echo -e "${NC}✅ Python PDF service running on: http://localhost:8000${NC}"
echo -e "${NC}✅ Ready to start Bun server with: bun run dev${NC}"
echo ""
echo -e "${CYAN}📋 Next steps:${NC}"
echo -e "${NC}  1. Run: bun run dev${NC}"
echo -e "${NC}  2. Test in Postman: POST http://localhost:3000/api/v1/hackrx/run${NC}"
echo ""
echo -e "${CYAN}🔧 Useful commands:${NC}"
echo -e "${NC}  Check Python service: curl http://localhost:8000/health${NC}"
echo -e "${NC}  View Python logs: docker logs python-pdf-service${NC}"
echo -e "${NC}  Stop Python service: docker stop python-pdf-service${NC}"