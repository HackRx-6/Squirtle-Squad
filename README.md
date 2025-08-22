# 🤖 Fantastic Robo - AI-Powered Document Processing System

> Built for **Bajaj HackRX Hackathon** - Advanced AI-powered document processing with intelligent Q&A, tool-calling, and multi-format support featuring load-balanced LLMs and real-time streaming responses.

## ✨ Key Features

-   🚀 **Multi-Format Processing**: PDF, DOCX, XLSX, PPTX, images, email files with intelligent extraction
-   🤖 **AI Tool Calling**: Flight tracker with smart city-landmark mapping and web content enrichment
-   ⚡ **Load-Balanced LLMs**: Dual LLM support with racing & cost-effective distribution modes
-   🧠 **Streaming Responses**: Real-time responses with global timers and adaptive chunking
-   🖼️ **Intelligent OCR**: Mistral OCR for images and presentations with fallback mechanisms
-   💾 **In-Memory Vector Search**: HNSW-powered similarity search with batched embeddings
-   📈 **Performance Monitoring**: Sentry integration with comprehensive cost tracking
-   🐳 **Production Ready**: Docker containerization + automated CI/CD pipeline

---

## �️ Prerequisites & Initial Setup

### System Requirements

Before you begin, ensure you have the following installed on your system:

1. **Docker Desktop** (Required for Python PDF service)

    - Download from: https://www.docker.com/products/docker-desktop
    - Ensure Docker is running before proceeding

2. **Bun Runtime** (JavaScript/TypeScript runtime)

    - Install via: `curl -fsSL https://bun.sh/install | bash`
    - Or visit: https://bun.sh/docs/installation

3. **Git** (For cloning and version control)

### Quick Start Guide

#### 1. Clone the Repository

```bash
git clone <repository-url>
cd fantastic-robo
```

#### 2. Install Dependencies

```bash
bun install
```

#### 3. Setup Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your API keys (see detailed configuration below).

#### 4. Start Docker & Run Setup Script

**For Windows (PowerShell):**

```powershell
# Ensure Docker Desktop is running first
./setup.ps1
```

**For macOS/Linux:**

```bash
# Ensure Docker is running first
chmod +x setup.sh
./setup.sh
```

This script will:

-   ✅ Verify Docker installation and status
-   🐍 Build the Python PDF service container
-   🚀 Start the service on port 8000
-   ⏳ Wait for health check confirmation

#### 5. Start Development Server

```bash
bun run dev
```

🎉 **Ready!** Your API is now running at `http://localhost:3000`

#### 6. Test the Setup

```bash
curl http://localhost:3000/healthcheck
```

Expected response: `{"status": "ok", "timestamp": "..."}`

---

## ⚙️ Environment Configuration

### Required Environment Variables

The system uses dual API keys for load balancing. You can use the same API keys for both pairs if you don't have separate accounts.

#### Core LLM Configuration

```bash
# Primary LLM (Required)
LLM_API_KEY=your-llm-api-key-here
LLM_BASE_URL=https://your-resource-name.services.ai.azure.com
LLM_MODEL=grok-3
LLM_SERVICE=azure  # Options: azure, claude, openai, gemini
LLM_DEPLOYMENT_NAME=grok-3
LLM_API_VERSION=2024-05-01-preview

# Secondary LLM for Load Balancing (Can use same keys)
LLM_API_KEY_2=your-secondary-llm-api-key-here
LLM_BASE_URL_2=https://your-secondary-resource-name.services.ai.azure.com
LLM_DEPLOYMENT_NAME_2=grok-3
LLM_MODEL_2=grok-3
LLM_SERVICE_2=azure
LLM_API_VERSION_2=2024-05-01-preview
```

#### Embedding Model Configuration

```bash
# Primary Embeddings (Required)
EMBEDDINGS_MODEL_API_KEY=your-embedding-model-key-here
EMBEDDINGS_MODEL_ENDPOINT=https://your-resource-name.openai.azure.com
EMBEDDINGS_MODEL_DEPLOYMENT_NAME=your-text-embedding-3-large-deployment

# Mistral for PPTX OCR
MISTRAL_API_KEY=your-mistral-api-key

# Secondary Embeddings for Load Balancing (Can use same keys)
EMBEDDINGS_MODEL_API_KEY_2=your-secondary-embedding-model-key-here
EMBEDDINGS_MODEL_ENDPOINT_2=https://your-secondary-resource-name.cognitiveservices.azure.com
EMBEDDINGS_MODEL_DEPLOYMENT_NAME_2=text-embedding-3-large
```

#### Optional but Recommended

```bash
# Authentication
HACKRX_AUTH_TOKEN=your-hackrx-auth-token-here


# Monitoring (Highly Recommended for Production)
SENTRY_DSN=your-sentry-dsn-here
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1

# Python Service Configuration
PYTHON_SERVICE_URL=http://localhost:8000/

# Server Configuration
PORT=3000
```

### Load Balancing Configuration

The system automatically enables load balancing when secondary API keys are provided:

-   **Cost-Effective Mode (Default)**: Questions are distributed between two LLMs
-   **Racing Mode**: Same questions sent to both LLMs simultaneously (expensive but faster)
-   **Fallback Protection**: Automatic failover if one service is unavailable

**Note**: You can use the same API keys for both primary and secondary configurations - the system will still work efficiently with intelligent request distribution.

---

## 🔧 Application Configuration (`app.config.ts`)

The application provides extensive configuration options through the `AppConfigService`. Here are the key settings you can customize:

### Core Processing Configuration

#### Chunking Strategy

```typescript
// Document chunking configuration
chunkingConfig: {
    pageWise: {
        enabled: false,           // Page-by-page processing
        pagesPerChunk: 1
    },
    characterWise: {
        enabled: false,           // Character-based chunking
        chunkSize: 4000,
        overlap: 200,
        minChunkSizeRatio: 0.8
    },
    recursive: {
        enabled: true,            // Recommended: Semantic chunking
        chunkSize: 2000,
        chunkOverlap: 200,
        separators: ["\n\n", "\n", " ", ""],
        keepSeparator: false
    }
}
```

#### Q&A Processing Settings

```typescript
qaConfig: {
    chunksToLLM: 25,                    // Max chunks sent to LLM
    enableLLMRacing: false,             // false = Cost-effective, true = Racing mode
    embeddingTimeout: 2,                // Seconds for chunk embeddings
    questionEmbeddingTimeout: 4,        // Seconds for question embeddings

    globalTimer: {
        enabled: true,
        timeoutSeconds: 29.55           // Global API timeout
    },

    streaming: {
        bufferSize: 1024,               // 1KB buffer for streaming
        flushInterval: 100              // Flush every 100ms
    },

    embeddingBatch: {
        enabled: true,
        batchSize: 300                  // Embeddings per batch
    }
}
```

#### Dynamic Chunking for Large Documents

```typescript
dynamicChunking: {
    enabled: true,
    pageThreshold: 300,                 // Switch strategy for PDFs > 300 pages
    defaultChunksToLLM: 25,            // Chunks for normal documents
    largeDocumentChunksToLLM: 10       // Reduced chunks for large documents
}
```

#### Vector Search Configuration

```typescript
vectorSearch: {
    useHNSW: true; // Enable HNSW index for fast similarity search
}
```

### Document Processing Settings

#### PDF Extraction

```typescript
textExtraction: {
    pdfMethod: "python-pymupdf",        // Primary extraction method
    fallbackEnabled: true,              // Enable fallback to alternative methods
    performanceLogging: true,

    pythonService: {
        url: "http://localhost:8000",
        timeout: 10000,                 // 10 second timeout
        healthCheckInterval: 300        // 5 minute health checks
    }
}
```

#### Tool Calling & Web Enrichment

```typescript
toolCalls: {
    enabled: true,                      // Enable web content enrichment
    advanced: {
        maxUrlsPerQuery: 2,
        maxUrlsFromDocs: 3,
        timeoutMs: 8000,
        maxBytes: 2000000,              // 2MB max content per URL
        concurrency: 2,
        respectRobotsTxt: true,
        allowedDomains: [],             // Empty = all domains allowed
        deniedDomains: ["127.0.0.1", "localhost", "169.254.169.254"]
    }
}
```

#### Security & Content Protection

```typescript
security: {
    promptInjectionProtection: {
        enabled: false,                 // Enable prompt injection detection
        strictMode: true,
        azureContentPolicy: true,       // Use Azure's content filtering
        preserveUrls: true,
        maxRiskScore: 40,
        logSuspiciousContent: true,
        blockHighRiskRequests: false
    }
}
```

### Recommended Production Values

For production environments, consider these optimizations:

-   **chunksToLLM**: 15-20 (reduce for cost optimization)
-   **enableLLMRacing**: `false` (cost-effective distribution)
-   **embeddingBatch.batchSize**: 200-500 (based on API rate limits)
-   **globalTimer.timeoutSeconds**: 25-30 (leave buffer for response processing)
-   **security.promptInjectionProtection.enabled**: `true`

---

## � API Usage

### **Primary Endpoint**

```http
POST /api/v1/hackrx/run
Content-Type: application/json
```

### **Request Format**

```json
{
    "documents": "https://example.com/document.pdf",
    "questions": ["What is my flight number?", "What are the key details?"]
}
```

### **Response Format**

```json
{
    "answers": [
        "Your flight number is 54aa68.",
        "The document contains travel booking details for your upcoming trip."
    ]
}
```

### **Example Requests**

#### **Document URL Processing**

```bash
curl -X POST http://localhost:3000/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -d '{
    "documents": "https://example.com/document.pdf",
    "questions": ["What is this document about?", "Key points?"]
  }'
```

#### **Flight Tracker Example**

```bash
curl -X POST http://localhost:3000/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -d '{
    "documents": "https://hackrx.blob.core.windows.net/document.pdf",
    "questions": ["What is my flight number?"]
  }'
```

---

## 🏗️ System Architecture & Design

### Overview

Fantastic Robo follows a modular, service-oriented architecture designed for scalability, reliability, and performance. The system processes documents through a sophisticated pipeline that combines multiple AI services with intelligent load balancing.

```
📄 Document Input → 🔍 Extraction → ✂️ Chunking → 🧮 Embeddings → 🔎 Vector Search → 🤖 LLM Processing → 📤 Streaming Response
```

### Core Architecture Components

#### 1. **Document Processing Pipeline**

**UnifiedTextExtractionService** (`src/services/extraction/`)

-   **PDF Extraction**: Python-based PyMuPDF service with fallback mechanisms
-   **DOCX Processing**: Semantic chunking with sentence-aware splitting
-   **XLSX Support**: Specialized Claude-based processing for spreadsheets
-   **PPTX Processing**: Mistral OCR integration for presentations
-   **Email & Image**: Dedicated extraction handlers
-   **Performance**: Configurable timeouts and health checks

**ChunkingService** (`src/services/chunking/`)

-   **Recursive Text Chunking**: Default strategy with semantic awareness
-   **Character-wise Chunking**: Token-aware with overlap management
-   **Page-wise Chunking**: Document structure preservation
-   **Dynamic Chunking**: Adaptive strategy based on document size

#### 2. **AI & Machine Learning Services**

**Load-Balanced LLM Service** (`src/services/LLM/`)

```typescript
class LLMService {
    // Dual client architecture for reliability
    private primaryClient: OpenAI;
    private secondaryClient: OpenAI | null;

    // Operating modes:
    // 1. Cost-Effective Distribution: Split questions between LLMs
    // 2. Racing Mode: Send same questions to both LLMs (expensive)
    // 3. Fallback Protection: Auto-switch on failures
}
```

**Features:**

-   ⚡ **Streaming Responses**: Real-time token streaming with configurable buffers
-   🔄 **Load Balancing**: Intelligent request distribution
-   🛡️ **Fault Tolerance**: Automatic failover and retry mechanisms
-   🧰 **Tool Calling**: Integrated flight tracking and web enrichment
-   📊 **Performance Monitoring**: Comprehensive metrics and logging

**Embedding Service** (`src/services/embeddings/`)

```typescript
class BatchedEmbeddingService {
    // Batch processing for efficiency
    batchSize: 300,                    // Configurable batch size
    loadBalancing: true,               // Dual endpoint support
    concurrency: "unlimited",          // Parallel processing
    timeouts: "configurable"           // Per-operation timeouts
}
```

#### 3. **Vector Search & Retrieval**

**InMemoryVectorService** (`src/services/search/`)

-   **HNSW Index**: High-performance similarity search
-   **Batch Processing**: Optimized embedding generation
-   **Memory Management**: Efficient storage and retrieval
-   **Configurable Limits**: Dynamic chunk selection based on document size

```typescript
// Search configuration
vectorSearch: {
    useHNSW: true,                     // Enable HNSW indexing
    chunksToLLM: 25,                   // Max chunks to retrieve
    dynamicChunking: true              // Adapt to document size
}
```

#### 4. **Web Context Enrichment**

**WebContextService** (`src/services/webScraping/`)

-   **URL Detection**: Extract URLs from questions and documents
-   **Content Fetching**: Respect robots.txt and rate limits
-   **Context Integration**: Seamlessly blend web content with document content
-   **Security**: Domain allowlists and content filtering

#### 5. **Q&A Processing Engine**

**InMemoryQAService** (`src/services/qa/`)
The central orchestrator that coordinates all services:

```typescript
class InMemoryQAService {
    async processQuestionWithStreaming(questions: string[]) {
        // 1. Generate question embeddings (load balanced)
        // 2. Perform vector similarity search
        // 3. Enrich context with web content (if enabled)
        // 4. Generate streaming LLM responses (load balanced)
        // 5. Return real-time response streams
    }
}
```

### Service Integration Flow

#### Document Processing Flow

1. **Input**: URL or file buffer
2. **Type Detection**: File signature analysis
3. **Extraction**: Format-specific text extraction
4. **Cleaning**: Security filtering and sanitization
5. **Chunking**: Semantic content splitting
6. **Embedding**: Vectorization with load balancing
7. **Storage**: In-memory vector indexing

#### Question Processing Flow

1. **Input**: User questions array
2. **Embedding**: Question vectorization (load balanced)
3. **Search**: Vector similarity matching
4. **Enrichment**: Web content integration (optional)
5. **LLM Processing**: Response generation (streaming)
6. **Output**: Real-time response streams

### Performance Optimizations

#### Load Balancing Strategy

```typescript
// Cost-Effective Mode (Default)
if (!enableLLMRacing) {
    // Split questions between two LLMs
    firstHalf → primaryLLM
    secondHalf → secondaryLLM
}

// Racing Mode (Expensive)
if (enableLLMRacing) {
    // Send all questions to both LLMs
    allQuestions → [primaryLLM, secondaryLLM] // Race for fastest response
}
```

#### Dynamic Resource Management

-   **Batch Embeddings**: Process 300 chunks simultaneously
-   **Adaptive Chunking**: Reduce chunks for large documents (300+ pages)
-   **Global Timeouts**: 29.55s API timeout with cleanup
-   **Memory Efficiency**: In-memory vector storage with HNSW indexing

#### Monitoring & Observability

-   **Sentry Integration**: Performance tracking and error monitoring
-   **Cost Tracking**: API usage and token consumption metrics
-   **Health Checks**: Service availability monitoring
-   **Structured Logging**: Component-level logging with correlation IDs

---

## 🚀 Production Deployment

### **Automated CI/CD Pipeline**

The repository includes a complete CI/CD pipeline that:

-   ✅ **Tests** the application on every push
-   🐳 **Builds** Docker images automatically
-   🚀 **Deploys** to Digital Ocean on main branch
-   🔍 **Runs** health checks post-deployment

### **For Non-Breaking Changes**

Simple push to main branch - CI/CD handles everything:

```bash
git push origin main
```

### **For Breaking Changes Requiring Configuration**

Update `.github/workflows/deploy.yml` for:

-   New environment variables
-   Changed service dependencies
-   Modified deployment configurations
-   Updated health check endpoints

---

## 🧪 Testing & Development

### **Health Checks**

```bash
# Application health
curl http://localhost:3000/healthcheck

# Python PDF service health
curl http://localhost:8000/health
```

### **API Testing Examples**

```bash
# Basic document processing
curl -X POST http://localhost:3000/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -d '{
    "documents": "https://example.com/test.pdf",
    "questions": ["What is this about?", "Summarize the key points"]
  }'

# Flight tracking example
curl -X POST http://localhost:3000/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -d '{
    "documents": "https://hackrx.blob.core.windows.net/boarding-pass.pdf",
    "questions": ["What is my flight number?", "What gate should I go to?"]
  }'
```

### **Development Scripts**

```bash
# Development mode with hot reload
bun run dev

# Build for production
bun run build

# Start production build
bun run start

# Docker operations
bun run docker:up      # Start all services
bun run docker:down    # Stop all services
bun run docker:logs    # View logs
```

### **Useful Debug Commands**

```bash
# Check Python service status
docker ps | grep python-pdf-service
docker logs python-pdf-service

# Monitor application logs
tail -f logs/application.log

# View embedding service performance
grep "embedding" logs/application.log | tail -20
```

---

## ⚠️ Troubleshooting

### **Common Issues & Solutions**

#### 1. **Docker Service Issues**

```bash
# Problem: Python PDF service won't start
# Solution: Check Docker status and rebuild
docker ps
docker stop python-pdf-service
docker rm python-pdf-service
./setup.sh  # or setup.ps1 on Windows
```

#### 2. **Environment Variable Issues**

```bash
# Problem: LLM or Embedding errors
# Check: Ensure all required variables are set
echo $LLM_API_KEY
echo $EMBEDDINGS_MODEL_API_KEY

# For load balancing, verify secondary keys
echo $LLM_API_KEY_2
echo $EMBEDDINGS_MODEL_API_KEY_2
```

#### 3. **API Rate Limiting**

-   **Symptoms**: Timeout errors, embedding failures
-   **Solutions**:
    -   Reduce `embeddingBatch.batchSize` in config
    -   Increase timeout values
    -   Check API quota usage

#### 4. **Memory Issues with Large Documents**

-   **Symptoms**: Out of memory errors
-   **Solutions**:
    -   Enable `dynamicChunking` in config
    -   Reduce `chunksToLLM` value
    -   Set `enableLLMRacing: false` for cost-effective mode

#### 5. **Performance Issues**

```bash
# Check service health
curl http://localhost:3000/healthcheck
curl http://localhost:8000/health

# Monitor resource usage
docker stats python-pdf-service

# Check for errors in logs
grep -i error logs/application.log
```

### **Debug Configuration**

For debugging, temporarily modify `app.config.ts`:

```typescript
// Reduce processing for faster debugging
qaConfig: {
    chunksToLLM: 5,              // Reduce from 25
    embeddingTimeout: 10,        // Increase timeout
    enableLLMRacing: false,      // Use cost-effective mode
    embeddingBatch: {
        enabled: true,
        batchSize: 50            // Reduce from 300
    }
}
```

---

## 📞 Support & Contact

### **Technical Support**

For any technical questions, configuration issues, or API key setup assistance:

**Primary Contact:**

-   📧 **Email**: joyal2405@gmail.com
-   🏷️ **Subject**: [Fantastic Robo] - Your Issue Description

**Development Team:**

-   📧 **Email**: thisisyashgpt@gmail.com, raghavbhai4545@gmail.com, im.ashish.1001@gmail.com
-   🏷️ **Subject**: [HackRX] - Technical Support Request


---

## 📋 Built for Bajaj HackRX

**Competition Features Implemented:**

-   ✅ Advanced multi-format document processing (PDF, DOCX, XLSX, PPTX, images, emails)
-   ✅ AI-powered Q&A with intelligent tool calling and web content enrichment
-   ✅ Real-time streaming responses with load-balanced LLM architecture
-   ✅ Production-ready deployment with comprehensive monitoring and CI/CD
-   ✅ Scalable vector search with HNSW indexing and batched embeddings
-   ✅ Fault-tolerant design with automatic failover and retry mechanisms

**Technical Stack**:

-   **Runtime**: Bun + TypeScript
-   **AI Models**: Azure OpenAI + Anthropic Claude + Mistral
-   **Infrastructure**: Docker + Python microservices
-   **Monitoring**: Sentry + structured logging
-   **Vector Search**: HNSW + in-memory processing
-   **Deployment**: Automated CI/CD with Digital Ocean

**Team**: Squirtle Squad - Delivering enterprise-grade AI solutions with cutting-edge performance optimization.
