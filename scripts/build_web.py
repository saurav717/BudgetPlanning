"""Build the static website into dist/ (served by the Cloudflare Worker, or any static host).

    python scripts/build_web.py

Environment variables (all optional):
    LEDGER_GOOGLE_CLIENT_ID   OAuth client ID for "Sign in with Google" + Drive storage
    LEDGER_RELAY_URL          where the Plaid relay lives (default: same origin, /relay)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
CACHE = ROOT / ".cache" / "wheels"
# Must match WHEELS in web/py-worker.js
WHEELS = {"starlette": "0.46.2", "fastapi": "0.115.12", "python-multipart": "0.0.20"}


def fetch_wheels() -> list[Path]:
    CACHE.mkdir(parents=True, exist_ok=True)
    have = list(CACHE.glob("*.whl"))
    need = [f"{n}=={v}" for n, v in WHEELS.items()
            if not any(p.name.lower().startswith(n.replace("-", "_") + "-" + v) for p in have)]
    if need:
        subprocess.check_call([sys.executable, "-m", "pip", "download", "--no-deps", "--only-binary=:all:",
                               "-d", str(CACHE), *need])
    return [p for p in CACHE.glob("*.whl") if any(p.name.lower().startswith(n.replace("-", "_") + "-" + v) for n, v in WHEELS.items())]


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    static = DIST / "static"
    shutil.copytree(ROOT / "web", static, ignore=shutil.ignore_patterns("index.html"))
    shutil.copy(ROOT / "web" / "index.html", DIST / "index.html")
    # the Python engine, as a zip Pyodide unpacks
    with zipfile.ZipFile(static / "ledger.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((ROOT / "ledger").glob("*.py")):
            if f.name in ("cli.py",):
                continue
            z.write(f, f"ledger/{f.name}")
    (static / "wheels").mkdir()
    for w in fetch_wheels():
        shutil.copy(w, static / "wheels" / w.name)
    config = {
        "mode": "browser",
        "googleClientId": os.environ.get("LEDGER_GOOGLE_CLIENT_ID", ""),
        "relayUrl": os.environ.get("LEDGER_RELAY_URL", "relay"),
    }
    (DIST / "config.js").write_text(f"window.LEDGER_CONFIG = {json.dumps(config, indent=2)};\n")
    if (ROOT / "transparency.json").exists():
        shutil.copy(ROOT / "transparency.json", DIST / "transparency.json")
    files = sum(1 for _ in DIST.rglob("*") if _.is_file())
    size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"Built {files} files ({size / 1e6:.1f} MB) into {DIST.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
