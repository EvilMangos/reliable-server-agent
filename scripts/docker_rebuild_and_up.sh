#!/bin/bash
set -e

# Navigate to the job-agent-platform directory
cd "$(dirname "$0")/.."

echo "Building images without cache..."
docker compose build --no-cache

echo "Starting containers with force recreate..."
docker compose up --force-recreate "$@"
