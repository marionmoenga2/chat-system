#!/bin/bash
# Render provides PORT env var, fallback to 10000
PORT=${PORT:-10000}
cd "$(dirname "$0")"
python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
