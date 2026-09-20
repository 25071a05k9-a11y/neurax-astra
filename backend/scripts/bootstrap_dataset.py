from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from app.config import MENDELEY_DOI, RAW_DATA_DIR


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Place organizer dataset files in the backend data directory without changing their contents."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Downloaded Mendeley files to copy into backend/app/data/raw.",
    )
    args = parser.parse_args()
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not args.paths:
        print(f"Dataset DOI: {MENDELEY_DOI}")
        print("Download version 2 from the Mendeley Data record, then run:")
        print("  python scripts/bootstrap_dataset.py <downloaded-file> [more-files ...]")
        print(f"Target directory: {RAW_DATA_DIR}")
        return 0

    copied = 0
    for source in args.paths:
        if not source.is_file():
            print(f"SKIP: {source} is not a file")
            continue
        destination = RAW_DATA_DIR / source.name
        shutil.copy2(source, destination)
        print(f"COPIED: {source} -> {destination}")
        copied += 1
    print(f"Copied {copied} file(s). Restart the backend so local data is rescanned.")
    return 0 if copied else 1


if __name__ == "__main__":
    raise SystemExit(main())
