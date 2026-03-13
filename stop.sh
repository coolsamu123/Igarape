#!/bin/bash
echo "Stopping CIOO Project Intelligence..."
# Kill any running Next.js dev server
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
# Also kill by port
lsof -ti:3333 2>/dev/null | xargs kill -9 2>/dev/null
echo "Server stopped."
