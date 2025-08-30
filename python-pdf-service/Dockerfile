# Python PDF/PPTX Extraction Service - Optimized for caching
FROM python:3.11-slim AS base

# Install system dependencies in a single layer for better caching
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    curl \
    libfreetype6-dev \
    libfontconfig1-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Dependencies installation stage (most cacheable)
FROM base AS deps

WORKDIR /app

# Copy requirements first for maximum cache efficiency
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production stage
FROM base AS production

WORKDIR /app

# Copy pre-installed dependencies
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application code
COPY . .

EXPOSE 8000

# Health check using built-in urllib
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "main.py"]