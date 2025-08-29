# Multi-stage build optimized for CI/CD with hnswlib-node support
FROM oven/bun:1.2.21-alpine AS base

# Essential Alpine packages for native modules compilation (hnswlib-node requires Python for node-gyp)
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
    # Playwright browser dependencies
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-cjk \
    font-noto-emoji

# Install node-gyp globally to ensure proper native module building
RUN npm install -g node-gyp

WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json bun.lockb* ./

# Set environment variables for native module compilation
ENV CC=gcc
ENV CXX=g++
ENV npm_config_build_from_source=true
ENV npm_config_cache=/tmp/.npm

# Install dependencies and handle native modules properly
RUN bun install --frozen-lockfile --ignore-scripts

# Manually rebuild native modules to ensure compatibility (requires Python for node-gyp)
RUN cd node_modules/hnswlib-node && \
    npm run rebuild && \
    echo "✅ hnswlib-node rebuilt successfully"

# Install Playwright browsers
RUN bunx playwright install chromium && \
    echo "✅ Playwright browsers installed successfully"

# Verify hnswlib-node installation
RUN node -e "try { require('hnswlib-node'); console.log('✅ hnswlib-node loaded successfully'); } catch(e) { console.log('⚠️ hnswlib-node not available:', e.message); }"

# Copy source code and build (excluding native modules from bundle)
COPY . .
RUN bun build src/index.ts --outdir ./dist --target node --external playwright --external chromium-bidi --external hnswlib-node --external @mistralai/mistralai --external electron --external officeparser --external pdfjs-dist --external unpdf --splitting

# Production stage - use Bun for production
FROM oven/bun:1.2.21-alpine

# Runtime packages including build tools for native modules (Python needed for node-gyp)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ca-certificates \
    tzdata \
    libstdc++ \
    libgcc \
    gcc \
    g++ \
    make \
    build-base \
    nodejs \
    npm \
    git \
    # Playwright browser dependencies
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-cjk \
    font-noto-emoji

# Install node-gyp globally in production stage too
RUN npm install -g node-gyp

WORKDIR /app

# Copy built application
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./

# Install Playwright browsers in production
RUN bunx playwright install chromium && \
    echo "✅ Playwright browsers installed in production"

# Verify that the native module was copied correctly
RUN ls -la node_modules/hnswlib-node/build/ || echo "No build directory found"

# Rebuild native modules in production environment to ensure compatibility (requires Python)
RUN cd node_modules/hnswlib-node && npm run rebuild

# Create symlinks for all the paths that hnswlib-node might look for
RUN ARCH=$(uname -m) && \
    NODE_VERSION=$(node -v | cut -d'.' -f1 | cut -d'v' -f2) && \
    mkdir -p /app/build /app/lib/binding/node-v127-linux-${ARCH} /app/compiled/22.6.0/linux/${ARCH} && \
    if [ -f node_modules/hnswlib-node/build/Release/addon.node ]; then \
      cp node_modules/hnswlib-node/build/Release/addon.node /app/build/addon.node && \
      cp node_modules/hnswlib-node/build/Release/addon.node /app/lib/binding/node-v127-linux-${ARCH}/addon.node && \
      cp node_modules/hnswlib-node/build/Release/addon.node /app/compiled/22.6.0/linux/${ARCH}/addon.node && \
      echo "✅ Native module copied to expected paths for architecture: ${ARCH}"; \
    else \
      echo "❌ Native module build failed"; \
      exit 1; \
    fi

# Verify the rebuilt native module exists
RUN ls -la node_modules/hnswlib-node/build/ && \
    node -e "try { require('hnswlib-node'); console.log('✅ hnswlib-node loaded successfully in production stage'); } catch(e) { console.log('❌ hnswlib-node error in production stage:', e.message); }"

# Copy source files needed at runtime
COPY src ./src

# Create logs directory
RUN mkdir -p logs

# Environment
ENV NODE_ENV=production
ENV DOCKER_ENV=true
ENV PORT=3000
# Playwright configuration
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthcheck || exit 1

CMD ["bun", "run", "start"]
