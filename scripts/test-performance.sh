#!/bin/bash

# Performance Testing Script for PDF Extraction Methods
# Usage: ./test-performance.sh [method] [auto_switching] [page_threshold]

echo "🧪 PDF Extraction Performance Testing"
echo "====================================="

# Default values
METHOD=${1:-"unpdf"}
AUTO_SWITCHING=${2:-"true"}
PAGE_THRESHOLD=${3:-"50"}

echo "Configuration:"
echo "  Method: $METHOD"
echo "  Auto Switching: $AUTO_SWITCHING"
echo "  Page Threshold: $PAGE_THRESHOLD"
echo ""

# Set environment variables
export PDF_EXTRACTION_METHOD=$METHOD
export PDF_EXTRACTION_AUTO_SWITCHING=$AUTO_SWITCHING
export PDF_EXTRACTION_PAGE_THRESHOLD=$PAGE_THRESHOLD

echo "🚀 Starting server with configuration..."
echo "Test with: curl -X POST http://localhost:3000/benchmark/pdf-extraction -F 'pdf=@your-file.pdf'"
echo ""
echo "Available endpoints:"
echo "  POST /benchmark/pdf-extraction  - Compare both methods"
echo "  GET  /benchmark/config          - Show current config"
echo "  POST /pdf/process               - Regular processing"
echo ""

# Start the server
bun run dev
