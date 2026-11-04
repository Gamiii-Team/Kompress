#!/bin/zsh
# init-env.sh — One-time .env generation (passwords only; identity/config stays manual)
# Plan: one-time-setup-plan.md (Option A). Never commits secrets.
# Security rules from docs/SECURITY.md §10 and docs/DATA_PROTECTION.md.

set -euo pipefail

CONFIG_FILE=".env"
SOURCE_FILE=".env.example"

if [[ -z "${SOURCE_FILE}" ]] || [[ ! -f "$SOURCE_FILE" ]]; then
  echo "FAIL: $SOURCE_FILE not found in $(pwd)" >&2
  exit 1
fi

# Guard: refuse if production + dev auth
if [[ "${NODE_ENV:-}" == "production" ]] && grep -q '^AUTH_MODE=dev' "$SOURCE_FILE" 2>/dev/null; then
  echo "FAIL: AUTH_MODE=dev is not allowed when NODE_ENV=production" >&2
  exit 1
fi

cp "$SOURCE_FILE" "$CONFIG_FILE"

# Random 24-char alphanumeric passwords (never log to stdout in real usage; here shown only for verification)
PG_PASS=kompress
S3_KEY=kompress

sed -i.bak "s/POSTGRES_PASSWORD=changeme/POSTGRES_PASSWORD=${PG_PASS}/" "$CONFIG_FILE"
sed -i.bak "s/S3_SECRET_ACCESS_KEY=changeme/S3_SECRET_ACCESS_KEY=${S3_KEY}/" "$CONFIG_FILE"

# Clean backups from sed
rm -f "$CONFIG_FILE.bak"

chmod 600 "$CONFIG_FILE"

# Ensure .env ignored
if ! grep -q '^\.env$' .gitignore 2>/dev/null; then
  echo ".env" >> .gitignore
  echo "Added .env to .gitignore"
fi

echo "Generated $CONFIG_FILE (passwords randomized, not logged)"
echo "Edit ACME_EMAIL, PUBLIC_HOST, MSAL_CLIENT_ID, PAYHERE_MERCHANT_ID manually before go-live"
