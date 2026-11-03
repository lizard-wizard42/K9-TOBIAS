#!/usr/bin/env bash
# Liga o serviço de super-resolução (vídeo melhorado por IA). Precisa do hub no ar (lê o relay do hub).
# Instalação (uma vez): python3 -m venv ~/k9-superres/venv && ~/k9-superres/venv/bin/pip install ncnn pillow numpy
#                       modelo: ~/k9-superres/models/realesr-animevideov3-x2.{param,bin} (veja README.md)
cd "$(dirname "$(readlink -f "$0")")" || exit 1
export K9_SR_MODELS="${K9_SR_MODELS:-$HOME/k9-superres/models}"
exec "$HOME/k9-superres/venv/bin/python" superres.py "$@"
