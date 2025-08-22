#!/bin/bash

echo "🎯 Testing PPTX Processing Setup"
echo "=================================="

# Check if sample.pptx exists
if [ ! -f "sample.pptx" ]; then
    echo "❌ sample.pptx not found in root directory"
    echo "Please add a sample PPTX file for testing"
    exit 1
fi

echo "✅ Found sample.pptx"

# Check if Python service is running
echo "🔍 Checking Python service health..."
PYTHON_SERVICE_URL="http://localhost:8000"

if curl -s "$PYTHON_SERVICE_URL/health" > /dev/null; then
    echo "✅ Python service is running"
    
    # Get service info
    echo "📊 Service information:"
    curl -s "$PYTHON_SERVICE_URL/" | python3 -m json.tool 2>/dev/null || echo "Could not format JSON response"
    
    # Test PPTX processing
    echo ""
    echo "🎯 Testing PPTX processing..."
    
    if command -v python3 &> /dev/null; then
        python3 test_pptx_extraction.py
    else
        echo "❌ Python3 not found for running test script"
        echo "Please install Python3 or run the test manually"
    fi
    
else
    echo "❌ Python service not running at $PYTHON_SERVICE_URL"
    echo "Please start the Python service first:"
    echo "  cd python-pdf-service && python main.py"
    echo "  or"
    echo "  docker-compose up pdf-service"
fi

echo ""
echo "🔧 Environment check:"
echo "MISTRAL_API_KEY: ${MISTRAL_API_KEY:+SET}"
echo "PYTHON_SERVICE_URL: ${PYTHON_SERVICE_URL:-http://localhost:8000}"

if [ -z "$MISTRAL_API_KEY" ]; then
    echo "⚠️  MISTRAL_API_KEY is not set"
    echo "   Export it with: export MISTRAL_API_KEY=your_api_key_here"
fi

echo ""
echo "🚀 To test the full pipeline:"
echo "1. Ensure MISTRAL_API_KEY is set"
echo "2. Start the Python service: docker-compose up pdf-service"
echo "3. Start the main application: bun run start"
echo "4. Test PPTX processing via the main API"
