#!/usr/bin/env bash
# Checagem rápida antes de sair com o robô: só LÊ o estado (não manda nenhum comando).
PORT=${PORT:-3080}
H="http://localhost:$PORT"
ok(){ printf '  \033[32mOK\033[0m   %s\n' "$1"; }; bad(){ printf '  \033[31mFALHA\033[0m %s\n' "$1"; FAIL=1; }; warn(){ printf '  \033[33mAVISO\033[0m %s\n' "$1"; }
FAIL=0
echo "K9-MK3 — checagem de campo"
curl -s -m 3 -o /dev/null "$H/" && ok "hub no ar ($H)" || { bad "hub fora do ar: rode ./restart.sh"; exit 1; }
LAN=$(hostname -I 2>/dev/null | awk '{print $1}'); [ -n "$LAN" ] && echo "  celular: http://$LAN:$PORT"
ST=$(curl -s -m 4 "$H/api/status")
python3 - "$ST" <<'PY' || FAIL=1
import json,sys
G="\033[32mOK\033[0m   ";R="\033[31mFALHA\033[0m ";Y="\033[33mAVISO\033[0m "
d=json.loads(sys.argv[1] or "{}"); t=d.get("telemetry",{}) ; bad=0
def p(tag,msg): print("  "+tag+msg)
if d.get("online"): p(G,"pernas online em %s"%d.get("ip"))
else: p(R,"pernas offline"); bad=1
r=t.get("rssi")
if r is not None: p(G if r>-70 else Y,"Wi-Fi das pernas %d dBm%s"%(r,"" if r>-70 else " (fraco: fique mais perto)"))
if t.get("controlsVersion")==2: p(G,"firmware com marchas novas (controlsVersion 2)")
else: p(R,"firmware das pernas desatualizado (grave de novo)"); bad=1
g=t.get("gait"); p(G if g in (5,6) else Y,"marcha %s%s"%(g," (MK3 lados juntos, a que anda para frente)" if g==6 else " (MK3 diagonal)" if g==5 else " (a recomendada é a 6)"))
tr=t.get("trim")
if tr and all(v==1500 for v in tr): p(G,"ajustes das patas no padrão (1500 µs)")
elif tr: p(Y,"ajustes das patas diferentes do padrão: %s"%tr)
if t.get("hold"): p(Y,"patas em retenção do centro (qualquer comando libera)")
sys.exit(bad)
PY
CAM=$(curl -s -m 4 "$H/api/camera/status")
python3 - "$CAM" <<'PY' || FAIL=1
import json,sys,os
d=json.loads(sys.argv[1] or "{}")
if d.get("online"): print("  \033[32mOK\033[0m   câmera online em %s (%s dBm)"%(d.get("ip"),d.get("rssi")))
elif os.environ.get("NEED_CAM")=="1": print("  \033[31mFALHA\033[0m câmera offline (%s): ligue a ESP32-CAM e espere ~20 s"%d.get("lastError","sem resposta")); sys.exit(1)
else: print("  \033[33mAVISO\033[0m câmera offline (ok se foi desligada de propósito; use NEED_CAM=1 para exigir)")
PY
[ "$FAIL" = 0 ] && echo "=> pronto para o campo" || echo "=> corrija os itens FALHA antes de sair"
exit $FAIL
