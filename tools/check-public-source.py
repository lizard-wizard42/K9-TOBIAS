#!/usr/bin/env python3
"""Check tracked source boundaries without uploading or operating hardware."""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
forbidden_dirs = {'Historico', 'MK5', 'Impressao 3D', 'references', 'Sounds', 'sim', 'Midia', 'Divulgacao', '.k9work'}
forbidden_suffixes = {'.stl', '.3mf', '.blend', '.blend1', '.step', '.stp', '.zip', '.bin', '.mp3', '.mp4', '.mov', '.jks', '.keystore'}
forbidden_names = {'secrets.h', 'secret.md', 'secrets.md', '.env', 'local.properties'}
errors = []
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
for name in files:
    if not name:
        continue
    path = pathlib.PurePosixPath(name)
    if path.parts[0] in forbidden_dirs or path.suffix.lower() in forbidden_suffixes or path.name in forbidden_names:
        errors.append(f'Private/non-code asset tracked: {name}')
    if path.name.startswith('.env') and path.name != '.env.example':
        errors.append(f'Environment file tracked: {name}')
    src = root / name
    if not src.is_file():
        continue
    data = src.read_bytes()
    if b'\0' not in data and len(data) < 2_000_000:
        # Do not match generic path variables or the source of this checker.
        if re.search(rb'/home/[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\', data):
            errors.append(f'Personal home path: {name}')
        if re.search(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----', data):
            errors.append(f'Private key: {name}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print('Tracked software boundaries and personal-path checks passed.')
