#!/bin/bash
set -e

echo "🚀 Building images for Kubernetes/Helm deployment..."

# Load env
if [ ! -f .env ]; then
  echo "❌ Error: .env file not found"
  exit 1
fi

VERSION=$(grep "^IMAGE_VERSION=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'" | xargs)
SUB_TAG=$(grep "^IMAGE_VERSION_SUB_TAG=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'" | xargs || echo "")

if [ -z "$VERSION" ]; then
  echo "❌ Error: IMAGE_VERSION not found in .env"
  exit 1
fi

echo "📦 Building App Image (version: ${VERSION}${SUB_TAG})..."
make build-app

# Tagging logic from deploy.sh
BUILT_TAG="hyperdx/hyperdx:${VERSION}${SUB_TAG}"
TARGET_TAG="docker.hyperdx.io/hyperdx/hyperdx:${VERSION}"

if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${BUILT_TAG}$"; then
   BUILT_TAG="hyperdx/hyperdx:${VERSION}"
fi

echo "🏷️  Tagging App Image: ${TARGET_TAG}"
docker tag "${BUILT_TAG}" "${TARGET_TAG}"

echo "📦 Building Collector Image (tag: dev)..."
docker build -t hyperdx/otel-collector:dev ./docker/otel-collector

echo "✅ Images built successfully!"
echo "   - App: ${TARGET_TAG}"
echo "   - Collector: hyperdx/otel-collector:dev"
