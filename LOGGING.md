# Logging System Documentation

## Overview

The Fantastic Robo application includes a comprehensive logging system that captures all console logs and writes them to structured log files. This system provides both file-based and console logging with automatic log rotation and management features.

## Features

- ✅ **Automatic Console Interception**: Captures all `console.log`, `console.warn`, `console.error`, and `console.debug` calls
- 📁 **Multiple Log Files**: Organizes logs by level, date, and combined application logs
- 🔄 **Automatic Log Rotation**: Archives old logs to prevent disk space issues
- 🎨 **Colored Console Output**: Enhanced readability with color-coded log levels
- 📊 **Log Management CLI**: Powerful command-line tools for log analysis
- 🏥 **Health Check Integration**: Logging statistics available via API
- 🐳 **Docker Support**: Properly configured for containerized deployments

## Log Files Structure

```
src/logs/
├── application.log       # All logs combined
├── info.log             # Info level logs only
├── warn.log             # Warning level logs only
├── error.log            # Error level logs only
├── debug.log            # Debug level logs only
├── 2024-01-15.log       # Daily log files
├── 2024-01-16.log
└── archived/            # Auto-archived old logs
    └── old-logs...
```

## Configuration

### Environment Variables

Configure logging behavior with these environment variables:

```bash
# Logging Configuration
LOG_LEVEL=info                    # debug, info, warn, error
FILE_LOGGING=true                 # Enable/disable file logging
CONSOLE_LOGGING=true              # Enable/disable console logging
MAX_LOG_FILE_SIZE_MB=100          # Maximum log file size in MB
MAX_LOG_FILES=10                  # Maximum number of log files to keep
LOG_ARCHIVE_DAYS=7                # Archive logs older than N days
LOG_ROTATION=true                 # Enable/disable log rotation
LOG_FORMAT=detailed               # simple, detailed, json

# Production Logging (already in .env.production)
NODE_ENV=production               # Enables logging in production
```

### Log Levels

1. **DEBUG**: Detailed information for debugging
2. **INFO**: General application information
3. **WARN**: Warning messages that don't halt execution
4. **ERROR**: Error messages and exceptions

## Usage

### Automatic Logging

The logging system automatically captures all console output:

```typescript
// These will be automatically logged to files
console.log("📄 Processing PDF from URL:", url);
console.warn("⚠️ Memory usage is high");
console.error("❌ Failed to process document");
console.debug("🐛 Debug information");
```

### Structured Logging

Use the logging service directly for structured logging:

```typescript
import { loggingService } from "./services/logging.service";

// Create component-specific logger
const logger = loggingService.createComponentLogger("PDFProcessor");

// Log with metadata
logger.info("Processing started", {
    filename: "document.pdf",
    size: "2.5MB",
    userId: "user123"
});

logger.error("Processing failed", {
    error: error.message,
    stack: error.stack
});
```

## Log Management CLI

Use the powerful CLI tool for log management:

```bash
# Show logging statistics
bun scripts/log-manager.ts stats

# View recent logs (last 50 lines)
bun scripts/log-manager.ts tail

# View recent error logs only
bun scripts/log-manager.ts tail error 100

# View specific log file
bun scripts/log-manager.ts view 2024-01-15.log

# List all log files
bun scripts/log-manager.ts list

# Search for specific terms
bun scripts/log-manager.ts search "PDF processing"

# Search in error logs only
bun scripts/log-manager.ts search "failed" error

# Clean old logs (dry run)
bun scripts/log-manager.ts clean 30
```

## Production Deployment

### Docker Configuration

The application is configured to write logs to `/app/logs` inside the container, which is mounted to `/var/log/fantastic-robo` on the host:

```bash
# In deploy script
-v /var/log/fantastic-robo:/app/logs
```

### Log Monitoring

Monitor logs in production:

```bash
# View recent application logs
docker logs fantastic-robo --tail 50

# View live logs
docker logs fantastic-robo -f

# Use the monitoring script
~/monitor-fantastic-robo.sh

# Access logs directly on host
tail -f /var/log/fantastic-robo/application.log
```

### Health Check

Check logging status via the health endpoint:

```bash
curl http://localhost:3000/healthcheck
```

Response includes logging statistics:

```json
{
  "data": {
    "status": "ok",
    "logging": {
      "enabled": true,
      "directory": "/app/logs",
      "totalFiles": 8,
      "estimatedSize": "2.4 MB",
      "recentFiles": ["application.log", "error.log", "info.log"]
    }
  }
}
```

## Log Rotation and Archiving

- **Automatic Rotation**: Logs are automatically rotated daily at midnight
- **Archiving**: Logs older than 7 days (configurable) are moved to `archived/` folder
- **Cleanup**: Use the CLI tool to clean old logs safely

## Best Practices

### Development

1. Use appropriate log levels:
   ```typescript
   logger.debug("Detailed debug info");     // Development only
   logger.info("Operation completed");      // General info
   logger.warn("Non-critical issue");       // Warnings
   logger.error("Critical error occurred"); // Errors
   ```

2. Include context in logs:
   ```typescript
   logger.info("PDF processed successfully", {
       filename: file.name,
       pages: extractedPages,
       duration: processingTime
   });
   ```

### Production

1. Set appropriate log level (`info` or `warn` for production)
2. Monitor log file sizes and disk space
3. Set up log aggregation for distributed deployments
4. Use structured logging for better searchability
5. Regularly archive and clean old logs

## Troubleshooting

### Common Issues

1. **Logs not appearing**: Check if `NODE_ENV=test` (logging disabled in test mode)
2. **Permission errors**: Ensure Docker container has write access to log directory
3. **Large log files**: Enable log rotation and clean old logs regularly
4. **Missing logs**: Check if file logging is enabled (`FILE_LOGGING=true`)

### Debug Commands

```bash
# Check logging service status
bun scripts/log-manager.ts stats

# View recent errors
bun scripts/log-manager.ts tail error 20

# Search for specific issues
bun scripts/log-manager.ts search "permission denied"
```

## Integration with Monitoring

The logging system integrates with:

- **Sentry**: Error logs are automatically sent to Sentry
- **Health Checks**: Logging status included in health endpoint
- **Docker**: Logs available via `docker logs` command
- **Host System**: Logs mounted to host filesystem for external monitoring

## Future Enhancements

Planned improvements:

- [ ] Log aggregation to external services (ELK, Fluentd)
- [ ] Real-time log streaming via WebSocket
- [ ] Log compression for archived files
- [ ] Configurable log formats (JSON, structured)
- [ ] Integration with cloud logging services
