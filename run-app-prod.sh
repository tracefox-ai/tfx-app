#!/bin/bash

# Script to run the Next.js app in production mode with API connection

# Default API port (should match the PORT used for the API server)
HYPERDX_API_PORT=${HYPERDX_API_PORT:-8000}
PORT=${PORT:-3000}

echo "Starting Next.js app in production mode..."
echo "App will proxy API requests to: http://127.0.0.1:$HYPERDX_API_PORT"
echo "App will run on: http://localhost:$PORT"
echo ""

cd packages/app

# Build if needed
if [ ! -d ".next" ]; then
  echo "Building Next.js app..."
  yarn build
fi

# Start the Next.js production server
HYPERDX_API_PORT=$HYPERDX_API_PORT \
PORT=$PORT \
NODE_ENV=production \
yarn start

