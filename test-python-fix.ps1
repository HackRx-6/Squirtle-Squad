#!/usr/bin/env pwsh
Write-Host "🧪 Testing Python PDF Service Fix" -ForegroundColor Green

# Build the image
Write-Host "📦 Building Python service..." -ForegroundColor Cyan
docker build -t python-pdf-test ./python-pdf-service

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

# Run the container
Write-Host "🚀 Starting container..." -ForegroundColor Cyan
$containerId = docker run -d --name python-test -p 8001:8000 python-pdf-test

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Container start failed!" -ForegroundColor Red
    exit 1
}

# Wait a moment for startup
Write-Host "⏳ Waiting for service to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check container logs
Write-Host "📋 Container logs:" -ForegroundColor Cyan
docker logs python-test

# Test health check using urllib (same as Docker health check)
Write-Host "🏥 Testing health check with urllib..." -ForegroundColor Cyan
$healthResult = docker exec python-test python -c "import urllib.request; response = urllib.request.urlopen('http://localhost:8000/health'); print('Health check passed:', response.getcode() == 200)"
Write-Host "Health check result: $healthResult" -ForegroundColor Green

# Test with curl from host
Write-Host "🌐 Testing health check from host..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8001/health" -TimeoutSec 5
    Write-Host "✅ Health check successful from host!" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json)" -ForegroundColor White
} catch {
    Write-Host "❌ Health check failed from host: $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup
Write-Host "🧹 Cleaning up..." -ForegroundColor Cyan
docker stop python-test
docker rm python-test

Write-Host "✅ Test completed!" -ForegroundColor Green