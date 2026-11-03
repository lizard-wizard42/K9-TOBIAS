#!/usr/bin/env python3
"""Prepare isolated software-only review artifacts. Never publishes or flashes."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOP_FILES = {'.gitattributes', '.gitignore', '.env.example', 'README.md', 'LICENSE', 'THIRD_PARTY.md', 'CONTRIBUTING.md', 'SECURITY.md', 'ota.sh'}
PREFIXES = ('k9_control_hub/', 'k9_vivo/', 'k9v2-1_firmware/', 'docs/', 'tools/', '.github/')
FORBIDDEN_SUFFIXES = {'.stl', '.3mf', '.blend', '.blend1', '.step', '.stp', '.obj', '.fbx', '.bin', '.zip', '.mp3', '.mp4', '.mov', '.jks', '.keystore', '.pyc'}
FORBIDDEN_PARTS = {'.git', '.pio', 'node_modules', '.venv', '__pycache__', '.gradle', 'build', 'data', '.k9work'}


def selected(name):
    p = pathlib.PurePosixPath(name)
    if name not in TOP_FILES and not name.startswith(PREFIXES):
        return False
    if any(part in FORBIDDEN_PARTS for part in p.parts) or p.suffix.lower() in FORBIDDEN_SUFFIXES:
        return False
    if p.name in {'secrets.h', 'secret.md', 'secrets.md', '.env', 'local.properties'} or p.name.endswith('.secret'):
        return False
    if p.name.startswith('.env') and p.name != '.env.example':
        return False
    return True


def prepare(destination):
    destination = destination.resolve()
    if destination.exists():
        raise SystemExit(f'Refusing to overwrite existing destination: {destination}')
    if destination == ROOT or destination in ROOT.parents:
        raise SystemExit('Destination must not contain the working project')
    destination.mkdir(parents=True)
    source = destination / 'source'
    source.mkdir()
    # Index + new unignored files, not a recursive copy of the working directory.
    names = subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    manifest = []
    for name in sorted(set(names)):
        if not name or not selected(name):
            continue
        src = ROOT / name
        if not src.is_file() or src.is_symlink():
            continue
        dst = source / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        manifest.append({'path': name, 'bytes': dst.stat().st_size, 'sha256': hashlib.sha256(dst.read_bytes()).hexdigest()})
    for required in ('k9v2-1_firmware/platformio.ini', 'k9v2-1_firmware/src/main.cpp', 'k9v2-1_firmware/src/cam_stable/web_cam_server.h', 'k9v2-1_firmware/src/secrets.example.h', 'k9_control_hub/server.js', 'k9_vivo/package.json'):
        if not (source / required).is_file():
            raise SystemExit(f'Missing required source: {required}')
    (destination / 'MANIFEST.json').write_text(json.dumps({'state': 'PUBLIC SOURCE — component terms in THIRD_PARTY.md', 'files': manifest}, indent=2) + '\n')
    artifacts = []
    for slug, guide in [('ESP32_DEVKIT_PERNAS', 'esp32dev.md'), ('ESP32_CAM_CAMERA', 'esp32cam.md')]:
        artifact = destination / f'K9_{slug}_SOURCE.zip'
        with zipfile.ZipFile(artifact, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted((source / 'k9v2-1_firmware').rglob('*')):
                if path.is_file():
                    archive.write(path, str(path.relative_to(source)))
            for name in ('LICENSE', 'THIRD_PARTY.md', 'docs/PUBLIC-EDITION.md', 'docs/AUDIO.md'):
                archive.write(source / name, name)
            archive.writestr('START-HERE.txt', f'PUBLIC SOURCE\nBoard guide: k9v2-1_firmware/boards/{guide}\nBoth shared targets are included. Build your own target with your own local credentials.\nRespect the component-specific terms in THIRD_PARTY.md.\n')
        artifacts.append(artifact)
    checksums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in artifacts + [destination / 'MANIFEST.json'])
    (destination / 'SHA256SUMS.txt').write_text(checksums)
    print(f'{len(manifest)} software files prepared in {source}')
    print('Two firmware source archives + manifest + checksums; nothing published or uploaded.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    prepare(parser.parse_args().output)
