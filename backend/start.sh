#!/bin/bash
# Render provides PORT env var, fallback to 8000 for local
PORT=${PORT:-8000}
cd "$(dirname "$0")"
python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
