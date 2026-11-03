#!/usr/bin/env bash
# Atualiza as placas do K9 pela rede (OTA), sem cabo.
#   ./ota.sh            as duas (câmera e pernas)
#   ./ota.sh cam        só a ESP32-CAM  (k9cam.local)
#   ./ota.sh pernas     só a ESP32 normal, a que anda (k9.local)
# A senha vem de K9_OTA_PASS em k9v2-1_firmware/src/secrets.h (arquivo fora do git).
# As pernas estacionam durante a gravação; segure o robô ou deixe-o deitado.
set -u
cd "$(dirname "$(readlink -f "$0")")/k9v2-1_firmware" || exit 1

PASS=$(sed -n 's/.*K9_OTA_PASS *"\(.*\)".*/\1/p' src/secrets.h 2>/dev/null | tail -1)
[ -n "$PASS" ] || { echo "K9_OTA_PASS não definido em src/secrets.h"; exit 1; }

what="${1:-todas}"
declare -A ENVS=( [cam]=esp32cam-ota [pernas]=esp32dev-ota )
declare -A HOSTS=( [cam]=k9cam.local [pernas]=k9.local )
case "$what" in
  cam|pernas) list=("$what") ;;
  todas|all)  list=(cam pernas) ;;
  *) echo "uso: $0 [cam|pernas|todas]"; exit 2 ;;
esac

uptime_of() { curl -s -m 3 "http://$1/status" | sed -n 's/.*"uptime":\([0-9]*\).*/\1/p'; }
fail=0
for b in "${list[@]}"; do
  host=${HOSTS[$b]}
  echo "=== $b ($host) ==="
  before=$(uptime_of "$host")
  port_args=()
  if [ -z "$before" ]; then                       # mDNS falha em rede mesh: tenta o IP que o hub conhece
    key=ip; [ "$b" = cam ] && key=camIp
    ip=$(curl -s -m 3 http://localhost:3080/api/status | sed -n "s/.*\"$key\":\"\([0-9.]*\)\".*/\1/p")
    if [ -n "$ip" ]; then host=$ip; before=$(uptime_of "$host"); port_args=(--upload-port "$ip"); echo "  (nome não resolveu; usando o IP $ip)"; fi
  fi
  [ -n "$before" ] || { echo "  $host não responde (placa desligada ou fora do Wi-Fi). Pulando."; fail=1; continue; }
  [ "$b" = pernas ] && ./verifica_marcha_principal.sh
  echo "  online, uptime ${before}s. Gravando..."
  if PLATFORMIO_UPLOAD_FLAGS="--auth=$PASS" pio run -e "${ENVS[$b]}" -t upload "${port_args[@]}" 2>&1 | grep -E "Result:|SUCCESS|FAILED|rror" | tail -3; then :; fi
  ok=0
  for i in $(seq 1 30); do                       # espera a placa reiniciar e voltar (até ~60 s)
    sleep 2; up=$(uptime_of "$host")
    if [ -n "$up" ] && [ "$up" -lt "$before" ]; then ok=1; echo "  voltou: uptime ${up}s (reiniciou com o firmware novo)"; break; fi
  done
  [ "$ok" = 1 ] || { echo "  NÃO confirmei o reinício de $b. Confira a placa."; fail=1; }
done
exit $fail
