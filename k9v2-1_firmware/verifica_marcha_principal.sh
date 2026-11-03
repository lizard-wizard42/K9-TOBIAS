#!/usr/bin/env bash
# Confere se o main.cpp ainda tem a marcha principal do K9 (MK3 diagonal 1,25 Hz, 29/10/2026).
# Só avisa; quem decide é você. Uso: ./verifica_marcha_principal.sh  (chamado pelo ota.sh antes de gravar as pernas)
cd "$(dirname "$(readlink -f "$0")")" || exit 1
f=src/main.cpp; ok=1
grep -Eq '^#define GAIT_BOOT 4\b' $f || { echo "  AVISO: GAIT_BOOT não é 4 (a placa não ligaria na marcha 5)"; ok=0; }
grep -Eq '"5 MK3 a51 f1\.25", +1\.25f, 51\.0f, 0\.66f, -6\.0f, 1\.00f, 2\.00f' $f || { echo "  AVISO: a linha do preset 5 (1,25 Hz, 51, 0,66, -6, 1,00, rampa 2,00) mudou"; ok=0; }
grep -Eq '^  \{ 0, 180, 180, 0 \}, \{ 0, 180, 180, 0 \}, \{ 0, 180, 180, 0 \}, \{ 0, 180, 180, 0 \}, \{ 0, 180, 180, 0 \},' $f || { echo "  AVISO: a fase diagonal do preset 5 mudou"; ok=0; }
[ $ok = 1 ] && echo "  marcha principal intacta (preset 5 diagonal 1,25 Hz, GAIT_BOOT 4)"
exit 0
