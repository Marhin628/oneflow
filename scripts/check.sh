#!/usr/bin/env bash
# Runs every automated check: backend API tests, frontend build, Playwright browser tests.
# All tests use throwaway databases; instance/oneflow.db is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Backend API tests"
.venv/bin/python -m unittest discover tests -v

echo "== Frontend build"
(cd frontend && npx vite build)

echo "== Browser tests (Playwright)"
(cd frontend && npx playwright test "$@")
