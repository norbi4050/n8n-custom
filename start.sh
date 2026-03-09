#!/bin/sh
echo "[start.sh] Iniciando compress+pdf server en port 3456..."
node /opt/compress-server.js &
sleep 2
if kill -0 $! 2>/dev/null; then
  echo "[start.sh] compress+pdf server OK (PID: $!)"
else
  echo "[start.sh] WARN: compress+pdf server no arranco"
fi
echo "[start.sh] Iniciando n8n..."
exec n8n
