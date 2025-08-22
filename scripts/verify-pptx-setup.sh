#!/bin/bash

# PPTX Setup Verification Script
# This script helps verify that PPTX processing is properly configured

echo "🎯 PPTX Processing Setup Verification"
echo "====================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if .env file exists
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ .env file found${NC}"
    
    # Check if MISTRAL_API_KEY is set
    if grep -q "^MISTRAL_API_KEY=" .env; then
        MISTRAL_KEY=$(grep "^MISTRAL_API_KEY=" .env | cut -d'=' -f2)
        if [ -n "$MISTRAL_KEY" ] && [ "$MISTRAL_KEY" != "your_mistral_api_key" ]; then
            echo -e "${GREEN}✅ MISTRAL_API_KEY is configured${NC}"
        else
            echo -e "${RED}❌ MISTRAL_API_KEY is not properly set in .env${NC}"
            echo -e "${YELLOW}   Please set: MISTRAL_API_KEY=your_actual_mistral_api_key${NC}"
        fi
    else
        echo -e "${RED}❌ MISTRAL_API_KEY not found in .env file${NC}"
        echo -e "${YELLOW}   Please add: MISTRAL_API_KEY=your_mistral_api_key${NC}"
    fi
else
    echo -e "${RED}❌ .env file not found${NC}"
    echo -e "${YELLOW}   Please copy .env.example to .env and configure it${NC}"
fi

# Check if Docker is running
if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        echo -e "${GREEN}✅ Docker is running${NC}"
        
        # Check if Python PDF service is running
        if docker ps | grep -q "python-pdf-service\|pdf-service"; then
            echo -e "${GREEN}✅ Python PDF service container is running${NC}"
            
            # Test the health endpoint
            if curl -s -f http://localhost:8000/health &> /dev/null; then
                echo -e "${GREEN}✅ Python PDF service health check passed${NC}"
                
                # Get detailed service status
                echo -e "${BLUE}🔍 Service Status:${NC}"
                curl -s http://localhost:8000/health | python3 -m json.tool 2>/dev/null || echo "Could not parse service status"
                
            else
                echo -e "${YELLOW}⚠️  Python PDF service is not responding on port 8000${NC}"
                echo -e "${YELLOW}   Try: docker-compose up -d${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Python PDF service container not found${NC}"
            echo -e "${YELLOW}   Try: docker-compose up -d${NC}"
        fi
    else
        echo -e "${RED}❌ Docker is not running${NC}"
        echo -e "${YELLOW}   Please start Docker Desktop${NC}"
    fi
else
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo -e "${YELLOW}   Please install Docker Desktop${NC}"
fi

echo ""
echo -e "${BLUE}📋 PPTX Processing Features:${NC}"
echo "• Converts PPTX slides to PDF format"
echo "• Uses Mistral OCR for text extraction"  
echo "• Supports semantic chunking for better Q&A"
echo "• Integrates with vector search and LLM pipeline"

echo ""
echo -e "${BLUE}🚀 Next Steps:${NC}"
echo "1. Ensure MISTRAL_API_KEY is configured in .env"
echo "2. Run: docker-compose up -d"
echo "3. Test with a PPTX file using the /process-pdf endpoint"
echo ""
echo -e "${YELLOW}💡 Tip: PPTX files without Mistral API key will fail to process${NC}"
