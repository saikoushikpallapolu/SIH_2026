"""Normalize Argo, BGC-Argo, Glider or CSV observations to a shared map/profile JSON shape."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def pick(frame: pd.DataFrame, *names: str, default: float | str | None = None):
    for name in names:
        if name in frame:
            return frame[name]
    return pd.Series([default] * len(frame), index=frame.index)


def clean_number(value: object) -> float | None:
    try:
        value = float(value)
        return value if np.isfinite(value) and abs(value) < 1e20 else None
    except (TypeError, ValueError):
        return None


def from_table(path: Path, kind: str) -> list[dict]:
    frame = pd.read_csv(path) if path.suffix.lower() in {".csv", ".txt"} else xr.open_dataset(path).to_dataframe().reset_index()
    latitude = pick(frame, "latitude", "LATITUDE", "lat")
    longitude = pick(frame, "longitude", "LONGITUDE", "lon")
    time = pick(frame, "time", "JULD", "TIME")
    ids = pick(frame, "id", "platform_number", "PLATFORM_NUMBER", "trajectory", default="unknown")
    temperature = pick(frame, "temperature", "TEMP_ADJUSTED", "TEMP", "temp")
    salinity = pick(frame, "salinity", "PSAL_ADJUSTED", "PSAL", "psal")
    chlorophyll = pick(frame, "chlorophyll", "CHLA_ADJUSTED", "CHLA", "chla")
    depth = pick(frame, "depth", "PRES_ADJUSTED", "PRES", "pressure", default=0)
    records: list[dict] = []
    for index in frame.index:
        lat, lon = clean_number(latitude[index]), clean_number(longitude[index])
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 360):
            continue
        records.append({
            "id": str(ids[index]).strip(), "kind": kind, "name": f"{kind} {str(ids[index]).strip()}",
            "latitude": lat, "longitude": lon, "timestamp": str(time[index]), "depth": clean_number(depth[index]) or 0,
            "temperature": clean_number(temperature[index]), "salinity": clean_number(salinity[index]), "chlorophyll": clean_number(chlorophyll[index]),
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--kind", choices=["Argo float", "BGC-Argo", "Glider", "CTD"], required=True)
    parser.add_argument("--collection", required=True, help="Output collection name, e.g. argo_2025q2")
    parser.add_argument("--out", default=str(PROJECT_ROOT / "data" / "observations"))
    args = parser.parse_args()
    records = from_table(Path(args.source), args.kind)
    destination = Path(args.out).resolve() / f"{args.collection}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(records, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Wrote {len(records)} normalized observation records to {destination}")


if __name__ == "__main__":
    main()
