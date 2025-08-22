# Simple setup script for Fantastic Robo with Python PDF Service

Write-Host "🚀 Setting up Fantastic Robo with Python PDF Service" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green

# Check if Docker is installed
try {
    docker --version | Out-Null
    Write-Host "✅ Docker is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Check if Docker is running
try {
    docker ps | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Build Python PDF service
Write-Host "`n🐍 Building Python PDF service..." -ForegroundColor Cyan
try {
    docker build -t python-pdf-service ./python-pdf-service
    Write-Host "✅ Python PDF service built successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to build Python PDF service" -ForegroundColor Red
    exit 1
}

# Start Python PDF service
Write-Host "`n🚀 Starting Python PDF service..." -ForegroundColor Cyan
try {
    # Stop existing container if running
    docker stop python-pdf-service 2>$null
    docker rm python-pdf-service 2>$null
    
    # Start new container
    docker run -d --name python-pdf-service -p 8000:8000 python-pdf-service
    Write-Host "✅ Python PDF service started on port 8000" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to start Python PDF service" -ForegroundColor Red
    exit 1
}

# Wait for service to be ready
Write-Host "`n⏳ Waiting for Python PDF service to be ready..." -ForegroundColor Cyan
$maxWait = 30
$waited = 0

while ($waited -lt $maxWait) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method GET -TimeoutSec 2
        if ($response.status -eq "healthy") {
            Write-Host "✅ Python PDF service is healthy!" -ForegroundColor Green
            break
        }
    } catch {
        # Service not ready yet
    }
    
    Start-Sleep 2
    $waited += 2
    Write-Host "  Waiting... ($waited/$maxWait seconds)" -ForegroundColor Yellow
}

if ($waited -ge $maxWait) {
    Write-Host "⚠️ Python PDF service took longer than expected to start" -ForegroundColor Yellow
    Write-Host "Check logs with: docker logs python-pdf-service" -ForegroundColor White
}

Write-Host "`n🎉 Setup complete!" -ForegroundColor Green
Write-Host "==================" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Python PDF service running on: http://localhost:8000" -ForegroundColor White
Write-Host "✅ Ready to start Bun server with: bun run dev" -ForegroundColor White
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Run: bun run dev" -ForegroundColor White
Write-Host "  2. Test in Postman: POST http://localhost:3000/api/v1/hackrx/run" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Useful commands:" -ForegroundColor Cyan
Write-Host "  Check Python service: curl http://localhost:8000/health" -ForegroundColor White
Write-Host "  View Python logs: docker logs python-pdf-service" -ForegroundColor White
Write-Host "  Stop Python service: docker stop python-pdf-service" -ForegroundColor White