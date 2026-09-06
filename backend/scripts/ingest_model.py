"""Normalize a CF-like ocean model NetCDF/OPeNDAP source into chunked Zarr.

Example:
  python scripts/ingest_model.py --source ./data/raw/incois_model.nc --dataset-id incois_io_2025q2

The browser never reads the source NetCDF. A future tile service reads this Zarr store by
variable/time/depth/spatial chunk and serializes GPU-ready tiles.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[2]

CANONICAL_NAMES = {
    "thetao": ("thetao", "temp", "temperature", "TEMP", "water_temperature"),
    "so": ("so", "salt", "salinity", "PSAL", "water_salinity"),
    "uo": ("uo", "u", "u_current", "eastward_sea_water_velocity"),
    "vo": ("vo", "v", "v_current", "northward_sea_water_velocity"),
    "wo": ("wo", "w", "vertical_velocity", "upward_sea_water_velocity"),
    "chl": ("chl", "chla", "chlorophyll", "CHLA", "chlorophyll_a"),
    "zos": ("zos", "ssh", "sla", "sea_surface_height"),
}
DIMENSIONS = {
    "time": ("time", "TIME", "ocean_time"),
    "depth": ("depth", "DEPTH", "lev", "level", "z"),
    "latitude": ("latitude", "lat", "LATITUDE", "nav_lat"),
    "longitude": ("longitude", "lon", "LONGITUDE", "nav_lon"),
}


def first_match(candidates: tuple[str, ...], available: set[str]) -> str | None:
    return next((name for name in candidates if name in available), None)


def normalize(dataset: xr.Dataset) -> xr.Dataset:
    rename: dict[str, str] = {}
    available = set(dataset.variables) | set(dataset.dims)
    for canonical, candidates in DIMENSIONS.items():
        if canonical not in available:
            matched = first_match(candidates, available)
            if matched:
                rename[matched] = canonical
    dataset = dataset.rename(rename)
    available = set(dataset.data_vars)
    variable_rename: dict[str, str] = {}
    for canonical, candidates in CANONICAL_NAMES.items():
        matched = first_match(candidates, available)
        if matched and matched != canonical:
            variable_rename[matched] = canonical
    dataset = dataset.rename(variable_rename)
    required = {"time", "latitude", "longitude"}
    missing = required - set(dataset.dims) - set(dataset.coords)
    if missing:
        raise ValueError(f"Missing required CF coordinates: {sorted(missing)}")
    model_variables = [name for name in CANONICAL_NAMES if name in dataset.data_vars]
    if not model_variables:
        raise ValueError(f"No supported variables found. Available variables: {list(dataset.data_vars)}")
    keep = model_variables + [name for name in ("depth", "latitude", "longitude", "time") if name in dataset]
    return dataset[keep].sortby("time")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Local NetCDF path or OPeNDAP URL")
    parser.add_argument("--dataset-id", required=True, help="Stable identifier, e.g. incois_io_2025q2")
    parser.add_argument("--out", default=str(PROJECT_ROOT / "data" / "processed"), help="Processed-data root")
    parser.add_argument("--lat-min", type=float)
    parser.add_argument("--lat-max", type=float)
    parser.add_argument("--lon-min", type=float)
    parser.add_argument("--lon-max", type=float)
    args = parser.parse_args()

    output_root = Path(args.out).resolve()
    dataset = xr.open_dataset(args.source, chunks={})
    dataset = normalize(dataset)
    if all(value is not None for value in (args.lat_min, args.lat_max, args.lon_min, args.lon_max)):
        dataset = dataset.sel(latitude=slice(args.lat_min, args.lat_max), longitude=slice(args.lon_min, args.lon_max))
    chunking = {"time": 1, "latitude": min(256, dataset.sizes["latitude"]), "longitude": min(256, dataset.sizes["longitude"])}
    if "depth" in dataset.dims:
        chunking["depth"] = 1
    dataset = dataset.chunk(chunking)
    dataset.attrs.update({"oceanscope_schema": "1.0", "dataset_id": args.dataset_id, "source": args.source})
    zarr_path = output_root / "zarr" / f"{args.dataset_id}.zarr"
    zarr_path.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_zarr(zarr_path, mode="w", consolidated=True)

    catalog_path = output_root.parent / "catalog" / "catalog.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    current = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"datasets": []}
    record = {"id": args.dataset_id, "zarr_path": str(zarr_path), "variables": list(dataset.data_vars), "dimensions": dict(dataset.sizes), "time_start": str(dataset.time.values[0]), "time_end": str(dataset.time.values[-1]), "source": args.source}
    current["datasets"] = [item for item in current["datasets"] if item["id"] != args.dataset_id] + [record]
    catalog_path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    print(f"Wrote {zarr_path} with {list(dataset.data_vars)}")


if __name__ == "__main__":
    main()
