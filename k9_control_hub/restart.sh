#!/usr/bin/env bash
# Reinicia o hub com segurança: para o antigo, ESPERA a porta liberar, sobe o novo e confirma.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
PORT=${PORT:-3080}
PID=$(ss -tlnp 2>/dev/null | grep ":$PORT " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$PID" ] && kill "$PID"
for _ in $(seq 1 15); do ss -tln | grep -q ":$PORT " || break; sleep 1; done
nohup node server.js > /tmp/k9_control_hub.log 2>&1 &
for _ in $(seq 1 10); do sleep 1; curl -s -m 2 -o /dev/null "http://localhost:$PORT/" && { echo "hub no ar: http://localhost:$PORT"; exit 0; }; done
echo "hub NÃO subiu, veja /tmp/k9_control_hub.log"; exit 1
