# Multi-stage build optimized for CI/CD with aggressive caching
FROM oven/bun:1.2.21-alpine AS alpine-base

# Create a base image with all system dependencies (highly cacheable)
RUN apk add --no-cache \
    python3 \
    python3-dev \
    py3-pip \
    gcc \
    g++ \
    build-base \
    make \
    ca-certificates \
    tzdata \
    nodejs \
    npm \
    libstdc++ \
    libgcc \
    git \
    bash \
    && npm install -g node-gyp

# Separate stage for Playwright dependencies (cacheable independently)
FROM alpine-base AS playwright-base
RUN apk add --no-cache \
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ttf-freefont \
    font-noto \
    font-noto-cjk \
    font-noto-emoji

# Dependencies installation stage (most cacheable)
FROM playwright-base AS deps

WORKDIR /app

# Copy only package files first for maximum cache efficiency
COPY package*.json bun.lockb* ./

# Set environment variables for native module compilation
ENV CC=gcc
ENV CXX=g++
ENV npm_config_build_from_source=true
ENV npm_config_cache=/tmp/.npm

# Install dependencies (this layer will be cached unless package files change)
RUN bun install --frozen-lockfile --ignore-scripts

# Native modules build stage (separate for better caching)
FROM deps AS native-modules
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Rebuild native modules (cached separately from deps installation)
RUN cd node_modules/hnswlib-node && \
    npm run rebuild && \
    echo "✅ hnswlib-node rebuilt successfully"

# Verify hnswlib-node installation
RUN node -e "try { require('hnswlib-node'); console.log('✅ hnswlib-node loaded successfully'); } catch(e) { console.log('⚠️ hnswlib-node not available:', e.message); }"

# Playwright installation stage (separate for independent caching)
FROM native-modules AS playwright-install
WORKDIR /app

# Set Playwright to use system-installed Chromium and skip all downloads
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# Verify system browser is available
RUN echo "� Verifying system Chromium installation..." && \
    which chromium-browser && \
    chromium-browser --version && \
    echo "✅ System Chromium verified - skipping Playwright browser downloads"

# Build stage (only rebuilds when source code changes)
FROM playwright-install AS builder
WORKDIR /app

# Copy source code and build
COPY . .
RUN bun build src/index.ts --outdir ./dist --target node --external playwright --external chromium-bidi --external hnswlib-node --external @mistralai/mistralai --external electron --external officeparser --external pdfjs-dist --external unpdf --splitting

# Production stage - optimized runtime image
FROM playwright-base AS production

WORKDIR /app

# Copy only what's needed from previous stages
COPY --from=playwright-install /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Use system browser configuration (no additional downloads needed)
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# Verify that the native module works in production
RUN ls -la node_modules/hnswlib-node/build/ || echo "No build directory found"

# Quick verification instead of full rebuild in production
RUN node -e "try { require('hnswlib-node'); console.log('✅ hnswlib-node verified in production'); } catch(e) { console.log('❌ hnswlib-node error in production:', e.message); exit(1); }"

# Copy essential runtime files
COPY src ./src
COPY scripts ./scripts

# Make scripts executable and create logs directory
RUN chmod +x scripts/*.sh && mkdir -p logs

# Copy and setup entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Environment configuration
ENV NODE_ENV=production
ENV DOCKER_ENV=true
ENV PORT=3000
ENV GIT_REPO_URL="https://github.com/HackRx-6/Squirtle-Squad.git"

# Consistent Playwright configuration
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthcheck || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
