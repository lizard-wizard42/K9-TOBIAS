#!/usr/bin/env bash
cd "$(dirname "$(readlink -f "$0")")" || exit 1

# If port 3080 is free, start the server in the background não estiver em uso, inicia o servidor em background
if ! ss -tln | grep -q ':3080 '; then
  nohup node server.js > /tmp/k9_control_hub.log 2>&1 &
  sleep 1
fi

# Open the panel in the default browser
xdg-open "http://localhost:3080" >/dev/null 2>&1 &
