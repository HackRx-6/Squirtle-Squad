#!/bin/bash

echo "🔍 LangSmith Monitoring Diagnostic Script"
echo "========================================"

# Check if running in container
if [ -f /.dockerenv ]; then
    echo "📦 Running inside Docker container"
else
    echo "💻 Running on host system"
fi

echo ""
echo "🔧 Environment Variables:"
echo "------------------------"
echo "NODE_ENV: ${NODE_ENV:-'not set'}"
echo "LANGCHAIN_TRACING_V2: ${LANGCHAIN_TRACING_V2:-'not set'}"
echo "LANGCHAIN_API_KEY: ${LANGCHAIN_API_KEY:+***SET***}${LANGCHAIN_API_KEY:-'not set'}"
echo "LANGCHAIN_PROJECT: ${LANGCHAIN_PROJECT:-'not set'}"
echo "LANGCHAIN_ENDPOINT: ${LANGCHAIN_ENDPOINT:-'not set (using default)'}"

echo ""
echo "🌐 Network Connectivity:"
echo "------------------------"

# Test LangSmith API connectivity
echo "Testing LangSmith API connectivity..."
if command -v curl >/dev/null 2>&1; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${LANGCHAIN_API_KEY}" https://api.smith.langchain.com/projects 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ LangSmith API: Accessible (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "401" ]; then
        echo "❌ LangSmith API: Authentication failed (HTTP $HTTP_CODE) - Check LANGCHAIN_API_KEY"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo "❌ LangSmith API: Connection failed - Check network/firewall"
    else
        echo "⚠️ LangSmith API: Unexpected response (HTTP $HTTP_CODE)"
    fi
else
    echo "⚠️ curl not available - cannot test API connectivity"
fi

echo ""
echo "📊 Application Status:"
echo "---------------------"

# Check if app is running
if pgrep -f "bun.*fantastic-robo" > /dev/null; then
    echo "✅ Application: Running"
else
    echo "❌ Application: Not running"
fi

# Check logs for monitoring-related messages
echo ""
echo "📝 Recent Monitoring Logs:"
echo "-------------------------"
if [ -f "/app/logs/app.log" ]; then
    tail -20 /app/logs/app.log | grep -i "langsmith\|monitoring" || echo "No monitoring logs found"
elif docker logs fantastic-robo 2>/dev/null | tail -20 | grep -i "langsmith\|monitoring"; then
    echo "Found monitoring logs in Docker logs"
else
    echo "No log files found - check application startup"
fi

echo ""
echo "🔧 Recommendations:"
echo "------------------"

if [ "${LANGCHAIN_TRACING_V2}" != "true" ]; then
    echo "❌ Set LANGCHAIN_TRACING_V2=true"
fi

if [ -z "${LANGCHAIN_API_KEY}" ]; then
    echo "❌ Set LANGCHAIN_API_KEY with your LangSmith API key"
fi

if [ -z "${LANGCHAIN_PROJECT}" ]; then
    echo "⚠️ Set LANGCHAIN_PROJECT for better organization"
fi

if [ "${NODE_ENV}" = "test" ]; then
    echo "⚠️ NODE_ENV=test disables monitoring - use 'production' for production"
fi

echo ""
echo "✅ Diagnostic complete!"
