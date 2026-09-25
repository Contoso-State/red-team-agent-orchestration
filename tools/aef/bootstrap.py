#!/usr/bin/env python3
"""Build the pinned AEF revision in this target; never install from the source tree."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import venv

ROOT = Path(__file__).resolve().parents[2]
COMMIT = json.loads((ROOT / "tools/aef/source-lock.json").read_text())["commit"]
WORK = ROOT / "engagements/aef-integration-verification"


def venv_python(environment, platform=None):
    """Use the executable layout created by venv on the target platform."""
    return environment / ("Scripts/python.exe" if (platform or os.name) == "nt" else "bin/python")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("Python 3.11 or newer is required")
    source = args.source.resolve(strict=True)
    if source == ROOT or source in ROOT.parents or ROOT in source.parents:
        parser.error("Source and target must be disjoint repositories")
    # Reject target output redirection through an existing symbolic link.
    for path in (ROOT / "engagements", WORK):
        if path.is_symlink():
            parser.error("Target output directories cannot be symbolic links")
    WORK.mkdir(parents=True, exist_ok=True)
    def git(*argv):
        return subprocess.check_output(["git", "--no-optional-locks", "-C", str(source), *argv])
    if git("rev-parse", COMMIT + "^{commit}").decode().strip() != COMMIT:
        parser.error("Pinned source revision unavailable")
    epoch = git("show", "-s", "--format=%ct", COMMIT).decode().strip()
    archive = git("archive", COMMIT, "aef", "README.md", "pyproject.toml")
    # Extract regular source files only. Git symlinks are never followed.
    with tempfile.TemporaryDirectory(prefix="wheel-build-", dir=WORK) as build_dir:
        build = Path(build_dir)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for item in tar:
                path = build / item.name
                if path.is_absolute() and not path.resolve().is_relative_to(build):
                    raise ValueError("Archive path outside target build directory")
                if item.isdir():
                    path.mkdir(parents=True, exist_ok=True)
                elif item.isfile():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(tar.extractfile(item).read())
                else:
                    raise ValueError("Non-regular source archive member")
        # The revision travels with the installed package, so a stale runtime
        # cannot claim the new revision just because target code was updated.
        (build / "aef/_redteam_build.json").write_text(json.dumps({"sourceCommit": COMMIT}) + "\n")
        environment = WORK / ".venv"
        if environment.is_symlink():
            raise ValueError("Target environment cannot be a symbolic link")
        if not environment.exists():
            venv.EnvBuilder(with_pip=True).create(environment)
        python = venv_python(environment)
        cache, temp, wheels = (WORK / name for name in ("pip-cache", "tmp", "wheels"))
        for path in (cache, temp, wheels):
            if path.is_symlink():
                raise ValueError("Target build paths cannot be symbolic links")
            path.mkdir(exist_ok=True)
        env = {**os.environ, "PIP_CACHE_DIR": str(cache), "TMPDIR": str(temp),
               "PYTHONDONTWRITEBYTECODE": "1", "SOURCE_DATE_EPOCH": epoch,
               "PIP_DISABLE_PIP_VERSION_CHECK": "1"}
        def pip(*argv):
            subprocess.run([str(python), "-I", "-B", "-m", "pip", *argv],
                           cwd=ROOT, env=env, check=True)
        pip("install", "-r", str(ROOT / "tools/aef/requirements.txt"), "hatchling==1.27.0")
        # Build into an empty revision-specific directory; do not accidentally
        # reinstall a stale wheel if upstream changes its package version.
        built_wheels = build / "dist"
        pip("wheel", "--no-deps", "--no-build-isolation", "--wheel-dir", str(built_wheels), str(build))
        candidates = list(built_wheels.glob("aef_core-*.whl"))
        if len(candidates) != 1:
            raise ValueError("Expected exactly one built AEF wheel")
        wheel = wheels / candidates[0].name
        wheel.write_bytes(candidates[0].read_bytes())
        pip("install", "--no-deps", "--force-reinstall", str(wheel))
        installed = subprocess.check_output([str(python), "-I", "-B", "-m", "pip", "freeze"],
                                            cwd=ROOT, env=env).decode().splitlines()
        provenance = {"sourceCommit": COMMIT, "wheelSHA256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
                      "python": str(python.relative_to(ROOT)), "dependencies": installed,
                      "upstreamWrites": 0, "build": "git archive; target-local wheel"}
        (WORK / "installation.json").write_text(json.dumps(provenance, indent=2) + "\n")
        print(json.dumps({key: value for key, value in provenance.items() if key != "dependencies"}))


if __name__ == "__main__":
    main()
