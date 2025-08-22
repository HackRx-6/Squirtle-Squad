# 🚀 Quick Setup - Python PDF Microservice

## One-Command Setup

### Windows:
```powershell
./setup.ps1
```

### Linux/Mac:
```bash
chmod +x setup.sh && ./setup.sh
```

## Manual Setup (if needed)

### 1. Build Python PDF Service
```bash
docker build -t python-pdf-service ./python-pdf-service
```

### 2. Start Python PDF Service
```bash
docker run -d --name python-pdf-service -p 8000:8000 python-pdf-service
```

### 3. Start Bun Server
```bash
bun run dev
```

## Test Your Setup

### Health Check:
```bash
curl http://localhost:8000/health
curl http://localhost:3000/healthcheck
```

### Test PDF Processing:
```bash
curl -X POST http://localhost:3000/api/v1/hackrx/run \
  -H "Content-Type: application/json" \
  -d '{
    "documents": "YOUR_PDF_URL",
    "questions": ["What is this document about?"]
  }'
```

## What This Does

1. **Python PDF Service** (Port 8000): Ultra-fast PDF text extraction using PyMuPDF
2. **Bun Server** (Port 3000): Main API with embeddings and Q&A
3. **Automatic Fallback**: If Python service fails, falls back to unpdf

## Performance

- **Python PyMuPDF**: ~400 pages/sec (3x faster than unpdf)
- **Total Processing**: Under 30 seconds for large PDFs
- **Microservice Architecture**: Independent scaling and deployment

## Troubleshooting

### Python Service Not Starting:
```bash
docker logs python-pdf-service
```

### Port Already in Use:
```bash
docker stop python-pdf-service
docker rm python-pdf-service
```

### Service Communication Issues:
```bash
docker exec -it python-pdf-service curl http://localhost:8000/health
```

That's it! 🎉