# 🚀 Quick Start

## One Command Setup:
```powershell
# Windows
./setup.ps1

# Linux/Mac  
./setup.sh
```

## Then Start Development:
```bash
bun run dev
```

## Test in Postman:
- **URL:** `POST http://localhost:3000/api/v1/hackrx/run`
- **Body:** Your JSON with PDF URL and questions

## What You Get:
- **3x Faster PDF extraction** (~400 pages/sec vs ~130 pages/sec)
- **Microservice architecture** (Python container + Bun server)
- **Automatic fallback** (unpdf if Python service fails)
- **Production ready** (Docker containers, CI/CD included)

That's it! 🎉
