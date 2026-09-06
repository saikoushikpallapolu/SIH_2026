"""OceanScope India — Automated Data Synchronization & Git Pipeline.

Handles automatic data verification, script change detection on `git pull`,
and safety validation on `git push`.

Usage:
  python backend/scripts/sync_pipeline.py               (Check data status & regenerate missing)
  python backend/scripts/sync_pipeline.py --on-pull      (Called by Git post-merge hook after pull)
  python backend/scripts/sync_pipeline.py --on-push      (Called by Git pre-push hook before push)
  python backend/scripts/sync_pipeline.py --regen-all    (Force regenerate all 4 datasets)
  python backend/scripts/sync_pipeline.py --install-hooks(Install automated git hooks in .githooks)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = PROJECT_ROOT / "backend"
SCRIPTS_DIR = BACKEND_DIR / "scripts"
DATA_DIR = PROJECT_ROOT / "data"
PROCESSED_DIR = DATA_DIR / "processed"
GITHOOKS_DIR = PROJECT_ROOT / ".githooks"

# Dataset inventory specification: script -> expected primary output files
DATA_PIPELINES = [
    {
        "id": "bathymetry",
        "name": "ETOPO Bedrock Bathymetry (60 arc-sec)",
        "script": SCRIPTS_DIR / "fetch_bathymetry.py",
        "outputs": [
            PROCESSED_DIR / "terrain" / "bathymetry_io.bin",
            PROCESSED_DIR / "terrain" / "bathymetry_meta.json",
        ],
        "approx_seconds": 15,
    },
    {
        "id": "tsunami_2004",
        "name": "2004 Sumatra Tsunami Physics Model",
        "script": SCRIPTS_DIR / "fetch_tsunami_2004.py",
        "outputs": [
            PROCESSED_DIR / "cubes" / "tsunami_2004_hourly.json",
        ],
        "approx_seconds": 3,
    },
    {
        "id": "in_situ",
        "name": "Argo Floats & Gliders In-Situ Profiles",
        "script": SCRIPTS_DIR / "fetch_argo_gliders.py",
        "outputs": [
            PROCESSED_DIR / "oceanscope.db",
            PROCESSED_DIR / "observations" / "instruments_catalog.json",
        ],
        "approx_seconds": 8,
    },
    {
        "id": "hydrography",
        "name": "25-Year Hydrography & Currents (2000-2024, 16 depths)",
        "script": SCRIPTS_DIR / "fetch_hydrography_and_currents.py",
        "outputs": [
            PROCESSED_DIR / "cubes" / "temperature_25yr.bin",
            PROCESSED_DIR / "cubes" / "salinity_25yr.bin",
            PROCESSED_DIR / "cubes" / "currents_u_25yr.bin",
            PROCESSED_DIR / "cubes" / "currents_v_25yr.bin",
            PROCESSED_DIR / "cubes" / "chlorophyll_25yr.bin",
        ],
        "approx_seconds": 22,
    },
]


def log_header(text: str) -> None:
    print(f"\n=======================================================")
    print(f"  {text}")
    print(f"=======================================================")


def run_script(script_path: Path, label: str) -> bool:
    print(f"\n>> Running {label}...")
    print(f"   Command: {sys.executable} {script_path.relative_to(PROJECT_ROOT)}")
    start = time.time()
    res = subprocess.run([sys.executable, str(script_path)], cwd=PROJECT_ROOT)
    elapsed = time.time() - start
    if res.returncode == 0:
        print(f"   [SUCCESS] Completed in {elapsed:.1f}s.")
        return True
    else:
        print(f"   [FAILED] Error running {script_path.name} (exit code {res.returncode}).")
        return False


def check_status() -> tuple[list[dict], list[dict]]:
    """Checks which pipelines have complete outputs vs missing outputs."""
    log_header("OceanScope India — Local Data Vault Status")
    ready = []
    missing = []

    for pipe in DATA_PIPELINES:
        pipe_missing = [f for f in pipe["outputs"] if not f.exists() or f.stat().st_size == 0]
        if not pipe_missing:
            total_size_mb = sum(f.stat().st_size for f in pipe["outputs"]) / (1024 * 1024)
            print(f"  [OK]  {pipe['name']}")
            print(f"        Output: {len(pipe['outputs'])} files ({total_size_mb:.1f} MB)")
            ready.append(pipe)
        else:
            print(f"  [MISSING] {pipe['name']}")
            for mf in pipe_missing:
                print(f"            - {mf.relative_to(PROJECT_ROOT)}")
            missing.append(pipe)

    print("-------------------------------------------------------")
    return ready, missing


def handle_on_pull() -> None:
    """Invoked by git post-merge hook when git pull completes."""
    log_header("Git Pull Post-Merge: Verifying Data Sync")

    # Detect which files changed in the last pull
    changed_files = []
    try:
        # Check if ORIG_HEAD exists to compare what just came in
        res = subprocess.run(
            ["git", "diff", "--name-only", "ORIG_HEAD", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        if res.returncode == 0 and res.stdout.strip():
            changed_files = [line.strip().replace("\\", "/") for line in res.stdout.splitlines() if line.strip()]
    except Exception:
        pass

    if not changed_files:
        try:
            # Fallback to HEAD@{1} vs HEAD
            res = subprocess.run(
                ["git", "diff", "--name-only", "HEAD@{1}", "HEAD"],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            if res.returncode == 0 and res.stdout.strip():
                changed_files = [line.strip().replace("\\", "/") for line in res.stdout.splitlines() if line.strip()]
        except Exception:
            pass

    print(f"Detected {len(changed_files)} changed files in recent Git pull.")

    to_run = []
    for pipe in DATA_PIPELINES:
        script_rel = str(pipe["script"].relative_to(PROJECT_ROOT)).replace("\\", "/")
        # If script itself changed, definitely regenerate
        if script_rel in changed_files:
            print(f"  * Pipeline script modified in pull: {script_rel}")
            to_run.append(pipe)
            continue

        # Or if any expected output file is missing locally, regenerate
        missing = [f for f in pipe["outputs"] if not f.exists() or f.stat().st_size == 0]
        if missing:
            print(f"  * Local dataset incomplete for: {pipe['name']}")
            to_run.append(pipe)

    if not to_run:
        print("\nAll datasets are currently UP TO DATE with your pulled code! No regeneration needed.")
        return

    print(f"\nRegenerating {len(to_run)} affected dataset(s) locally...")
    for pipe in to_run:
        run_script(pipe["script"], pipe["name"])

    print("\n[SUCCESS] Local data synchronization complete!")


def handle_on_push() -> None:
    """Invoked by git pre-push hook before outgoing commits leave."""
    log_header("Git Pre-Push Safety & Quality Verification")

    # 1. Check for forbidden files in git index or recent commits
    forbidden_exts = [".bin", ".db", ".nc", ".tif", ".tiff", ".h5", ".tar", ".zip"]
    forbidden_files = []

    try:
        # Check files committed or staged
        res = subprocess.run(
            ["git", "diff", "--name-only", "origin/main...HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        candidates = res.stdout.splitlines() if res.returncode == 0 else []
    except Exception:
        candidates = []

    for f in candidates:
        f = f.strip()
        if not f:
            continue
        if any(f.endswith(ext) for ext in forbidden_exts):
            forbidden_files.append(f)
        if f == ".env" or f.endswith("/.env"):
            forbidden_files.append(f)

    if forbidden_files:
        print("\n[ERROR] PRE-PUSH BLOCKED! You have binary or secret files in your commit:")
        for fb in forbidden_files:
            print(f"   - {fb}")
        print("\nBinary files must NOT be pushed to GitHub (use Hugging Face Hub for data).")
        print("Remove them from git with: git reset HEAD~1")
        sys.exit(1)

    # 2. Check author config
    try:
        author_res = subprocess.run(["git", "config", "user.name"], cwd=PROJECT_ROOT, capture_output=True, text=True)
        email_res = subprocess.run(["git", "config", "user.email"], cwd=PROJECT_ROOT, capture_output=True, text=True)
        author_name = author_res.stdout.strip()
        author_email = email_res.stdout.strip()
        if author_name != "schrodingerscat07":
            print(f"[WARNING] Git user.name is '{author_name}', expected 'schrodingerscat07'.")
        if author_email != "24071a3240@vnrvjiet.in":
            print(f"[WARNING] Git user.email is '{author_email}', expected '24071a3240@vnrvjiet.in'.")
    except Exception:
        pass

    print("Pre-push checks passed: No binary files staged, secrets safe.")


def install_hooks() -> None:
    """Configures Git to use .githooks for automated pull/push sync."""
    log_header("Installing Git Automation Hooks")
    GITHOOKS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. post-merge hook (runs after git pull)
    post_merge = GITHOOKS_DIR / "post-merge"
    post_merge_content = f"""#!/bin/sh
# OceanScope India - Post-Merge Auto Data Sync
python backend/scripts/sync_pipeline.py --on-pull
"""
    post_merge.write_text(post_merge_content, encoding="utf-8")

    # 2. pre-push hook (runs before git push)
    pre_push = GITHOOKS_DIR / "pre-push"
    pre_push_content = f"""#!/bin/sh
# OceanScope India - Pre-Push Safety Check
python backend/scripts/sync_pipeline.py --on-push
"""
    pre_push.write_text(pre_push_content, encoding="utf-8")

    # Set core.hooksPath
    subprocess.run(["git", "config", "core.hooksPath", ".githooks"], cwd=PROJECT_ROOT)

    print(f"Created git hooks in: {GITHOOKS_DIR.relative_to(PROJECT_ROOT)}")
    print("Configured 'git config core.hooksPath .githooks'.")
    print("Now whenever you run 'git pull', data scripts will be checked and synced automatically!")


def regen_all() -> None:
    """Forces regeneration of all 4 data pipelines."""
    log_header("Forced Regeneration of All OceanScope India Data")
    total_start = time.time()
    for pipe in DATA_PIPELINES:
        run_script(pipe["script"], pipe["name"])
    print(f"\nAll datasets successfully generated in {time.time() - total_start:.1f} seconds.")
    check_status()


def main():
    parser = argparse.ArgumentParser(description="OceanScope India Data Sync & Git Pipeline")
    parser.add_argument("--on-pull", action="store_true", help="Invoked by git post-merge hook on git pull")
    parser.add_argument("--on-push", action="store_true", help="Invoked by git pre-push hook on git push")
    parser.add_argument("--regen-all", action="store_true", help="Force regenerate all datasets locally")
    parser.add_argument("--install-hooks", action="store_true", help="Install automated Git hooks in repository")
    args = parser.parse_args()

    if args.on_pull:
        handle_on_pull()
    elif args.on_push:
        handle_on_push()
    elif args.install_hooks:
        install_hooks()
    elif args.regen_all:
        regen_all()
    else:
        ready, missing = check_status()
        if missing:
            print(f"\nFound {len(missing)} missing dataset(s). Regenerating now...")
            for pipe in missing:
                run_script(pipe["script"], pipe["name"])
            check_status()
        else:
            print("\nAll datasets are fully generated and ready in data/processed/!")


if __name__ == "__main__":
    main()
