#!/bin/sh
set -e

# Bootstrap a fresh checkout of interdependent-api.
# Install dependencies from the committed package-lock.json.
# No local config is materialized here: the repo ships no .env template
# (.env is gitignored and provided out of band; see src/config/env.js).
npm ci
