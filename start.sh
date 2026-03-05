#!/bin/sh
echo "[start.sh] Iniciando compress-server en port 3456..."
node /opt/compress-server.js &
sleep 1
if kill -0 $! 2>/dev/null; then
  echo "[start.sh] compress-server OK (PID: $!)"
else
  echo "[start.sh] WARN: compress-server no arranco"
fi
echo "[start.sh] Iniciando n8n..."
exec n8n
