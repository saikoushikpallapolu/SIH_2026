"""Cloud synchronization script for OceanScope India using Hugging Face Hub.

Enables group teammates to push and pull the processed 25-year oceanographic
database with a single command.

Usage:
  python backend/scripts/sync_data.py --push   (Upload local data to Hugging Face)
  python backend/scripts/sync_data.py --pull   (Download data from Hugging Face)
  python backend/scripts/sync_data.py --status (Check local data inventory)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
ENV_FILE = PROJECT_ROOT / ".env"


def load_env() -> dict[str, str]:
    config = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                config[key.strip()] = val.strip().strip("\"'")
    return config


def get_repo_id(config: dict[str, str]) -> str:
    user = config.get("HF_USERNAME") or os.environ.get("HF_USERNAME")
    ds_name = config.get("HF_DATASET_NAME") or os.environ.get("HF_DATASET_NAME", "oceanscope-india-data")
    if not user or user == "your_huggingface_username":
        print("[ERROR] Please set HF_USERNAME in your .env file!")
        sys.exit(1)
    return f"{user}/{ds_name}"


def status():
    print("=== OceanScope India Local Data Inventory ===")
    if not PROCESSED_DIR.exists():
        print("No processed data found. Run the ingestion scripts first!")
        return

    total_bytes = 0
    file_count = 0
    for path in PROCESSED_DIR.rglob("*"):
        if path.is_file():
            size = path.stat().st_size
            total_bytes += size
            file_count += 1
            rel = path.relative_to(PROCESSED_DIR)
            if size > 1024 * 1024:
                print(f" - {rel} ({size / (1024*1024):.1f} MB)")
            else:
                print(f" - {rel} ({size / 1024:.1f} KB)")

    print("---------------------------------------------")
    print(f"Total: {file_count} files, {total_bytes / (1024*1024):.1f} MB ({total_bytes / (1024*1024*1024):.2f} GB)")


def push_to_hub():
    config = load_env()
    token = config.get("HF_TOKEN") or os.environ.get("HF_TOKEN")
    if not token or "your_huggingface" in token:
        print("[ERROR] Please add your valid HF_TOKEN in .env with WRITE permissions.")
        sys.exit(1)

    repo_id = get_repo_id(config)
    is_private = config.get("HF_PRIVATE", "false").lower() == "true"

    api = HfApi(token=token)
    print(f"Connecting to Hugging Face Hub as: {repo_id}...")

    try:
        api.create_repo(repo_id=repo_id, repo_type="dataset", private=is_private, exist_ok=True)
        print(f"Repository {repo_id} verified/created on Hugging Face.")
    except Exception as e:
        print(f"Repo setup warning/error: {e}")

    print(f"Uploading local dataset from {PROCESSED_DIR} to Hugging Face...")
    try:
        api.upload_folder(
            folder_path=str(PROCESSED_DIR),
            repo_id=repo_id,
            repo_type="dataset",
            commit_message="Update OceanScope India 25-Year Multimodal Ocean Atlas"
        )
        print("SUCCESS! Dataset successfully uploaded to Hugging Face Hub.")
        print(f"View your dataset at: https://huggingface.co/datasets/{repo_id}")
    except Exception as e:
        print(f"Upload failed: {e}")


def pull_from_hub():
    config = load_env()
    repo_id = get_repo_id(config)
    token = config.get("HF_TOKEN") or os.environ.get("HF_TOKEN")
    if token and "your_huggingface" in token:
        token = None

    print(f"Downloading dataset from Hugging Face: {repo_id}...")
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    try:
        snapshot_download(
            repo_id=repo_id,
            repo_type="dataset",
            local_dir=str(PROCESSED_DIR),
            token=token
        )
        print("SUCCESS! All 25-year oceanographic data successfully downloaded.")
        status()
    except Exception as e:
        print(f"Download failed: {e}")


def main():
    parser = argparse.ArgumentParser(description="Sync OceanScope data with Hugging Face Hub")
    parser.add_argument("--push", action="store_true", help="Upload local processed data to Hugging Face")
    parser.add_argument("--pull", action="store_true", help="Download dataset from Hugging Face")
    parser.add_argument("--status", action="store_true", help="Print local data storage inventory")
    args = parser.parse_args()

    if args.push:
        push_to_hub()
    elif args.pull:
        pull_from_hub()
    else:
        status()


if __name__ == "__main__":
    main()
