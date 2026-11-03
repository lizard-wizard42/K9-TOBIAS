#!/usr/bin/env bash
# Localize neutral Blender/script paths, or reset them before committing.
# Usage: tools/set-repo-path.sh [--reset]
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
python3 - "${1:-}" <<'PY'
import pathlib
import subprocess
import sys

if sys.argv[1] not in ('', '--reset'):
    raise SystemExit('Usage: tools/set-repo-path.sh [--reset]')
root = pathlib.Path.cwd()
placeholder = '/path/to/minirobo'
source, target = (str(root), placeholder) if sys.argv[1] else (placeholder, str(root))
# Only tracked text assets: never secrets, backups, dependencies or binary models.
files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
for name in files:
    path = root / name
    if not name.startswith(('Historico/', 'MK5/', 'docs/', 'sim/')):
        continue
    if path.suffix not in ('.py', '.sh', '.md', '.json', '.txt') or not path.is_file():
        continue
    text = path.read_text(encoding='utf-8')
    if source in text:
        path.write_text(text.replace(source, target), encoding='utf-8')
        print(f'updated {name}')
PY
