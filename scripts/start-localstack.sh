#!/bin/bash

# Stop any running LocalStack container
echo "🛑 Stopping any running LocalStack container..."
docker stop localstack 2>/dev/null || true

# Start LocalStack with required services
echo "🚀 Starting LocalStack with required services..."
docker run --rm \
  --name localstack \
  -p 4566:4566 \
  -e SERVICES=dynamodb,events,scheduler \
  -e DEBUG=1 \
  localstack/localstack:latest

# Note: The script will keep running until LocalStack is stopped
# To stop LocalStack, press Ctrl+C 