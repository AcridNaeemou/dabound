#!/usr/bin/env bash
# DaBound — one-command demo launcher.
#   ./start.sh            → http://localhost:8080
# Prints the Wi-Fi URL too, so a cohort member's phone can open Driver mode.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v18+). Install it, then re-run ./start.sh"
  exit 1
fi

# reuse a running instance if the port is already answering
if curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "DaBound is already running on port ${PORT}."
else
  echo "Starting DaBound backend on port ${PORT}…"
  PORT="$PORT" nohup node server.js > /tmp/obreroute.log 2>&1 &
  sleep 2
fi

IP=""
if command -v ipconfig >/dev/null 2>&1; then IP="$(ipconfig getifaddr en0 2>/dev/null || true)"; fi
if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$IP" ] && command -v ip >/dev/null 2>&1; then
  IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)"
fi

cat <<BANNER

  DaBound MVP is up.

   Passenger app   http://localhost:${PORT}
   Admin console   http://localhost:${PORT}   (admin / dabound)
   GPS phone mode  http://localhost:${PORT}/#/driver/dev-01
   Demo console    http://localhost:${PORT}/#/demo

BANNER

if [ -n "$IP" ]; then
  cat <<BANNER
   On a phone in the same Wi-Fi:
     Passenger  http://${IP}:${PORT}
     GPS phone  http://${IP}:${PORT}/#/driver/dev-01

BANNER
fi

echo "   Logs: /tmp/obreroute.log    Stop: pkill -f 'node server.js'"
echo
