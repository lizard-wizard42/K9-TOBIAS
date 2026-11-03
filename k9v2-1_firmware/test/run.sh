#!/usr/bin/env bash
# Roda os testes em C da matemática do robô (gait_core.h). Precisa de gcc.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
out=$(mktemp -d); r=0
for t in anim_scratch_test anim_beg_test anim_laugh_test anim_personality_test; do
  echo "== $t"; gcc -std=c11 -Wall -Wextra -O1 "$t.c" -lm -o "$out/$t" && "$out/$t" || r=1
done
echo "== audio_test"
g++ -std=c++17 -Wall -Wextra -I stubs -I ../src audio_test.cpp -o "$out/audio_test" && "$out/audio_test" || r=1
rm -rf "$out"; exit $r
