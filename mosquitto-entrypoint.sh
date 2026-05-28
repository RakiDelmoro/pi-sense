#!/bin/sh
# Mosquitto doesn't accept plain text passwords — it requires a hashed password file
# created by the `mosquitto_passwd` tool. This script bridges that gap:
# it reads MQTT_USERNAME and MQTT_PASSWORD from .env, generates the hashed credentials
# file on first start, then launches Mosquitto. Without it, you'd have to manually run
# a Docker command to create the file before starting the production stack.
#
# NOTE ON ARCHITECTURE & SECURITY TRADEOFF:
# While pre-hashing passwords locally and mounting credentials as read-only files is 
# more "secure-by-default" (protecting against /proc or docker inspect process leaks),
# we intentionally retain this entrypoint script approach for the following reasons:
# 1. Simplicity First: Provides an frictionless developer experience with single-source-of-truth .env files.
# 2. Local/Edge Trust Boundary: Pi Sense runs inside a private network or flat home server context where the risk
#    of hostile local process snooping is extremely low compared to the severe friction of manual out-of-band hashing.
# 3. Automation-Driven: Minimizes setup steps on raw Raspberry Pi/edge containers without requiring auxiliary CLI devtools.

CREDENTIALS_FILE="/mosquitto/config/auth/credentials"
CREDENTIALS_DIR="/mosquitto/config/auth"

if [ -n "$MQTT_USERNAME" ] && [ -n "$MQTT_PASSWORD" ]; then
  mkdir -p "$CREDENTIALS_DIR"
  if [ ! -f "$CREDENTIALS_FILE" ]; then
    echo "Generating Mosquitto credentials for user: $MQTT_USERNAME"
    mosquitto_passwd -b -c "$CREDENTIALS_FILE" "$MQTT_USERNAME" "$MQTT_PASSWORD"
    chmod 644 "$CREDENTIALS_FILE"
    chown 188:188 "$CREDENTIALS_FILE" 2>/dev/null || true
  else
    echo "Credentials file already exists — skipping generation"
  fi
else
  echo "WARNING: MQTT_USERNAME and MQTT_PASSWORD not set — Mosquitto will fail to start"
fi

# Start Mosquitto
exec "$@"
