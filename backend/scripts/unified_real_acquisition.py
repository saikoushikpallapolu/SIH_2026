"""OceanScope India — Unified Frequency-Configured Real Ocean Data Acquisition Engine.

Implements Requirement 15:
Architecture accepts temporal frequency as a first-class configuration parameter:
['hourly', '3-hourly', '6-hourly', 'daily', 'weekly', 'monthly', 'observation', 'static'].

Allows adding higher-frequency sources without rewriting extraction or standardization logic.
Strictly isolated from frontend, shaders, renderer, and existing synthetic models.
"""
from __future__ import annotations

import os
import sys
import time
import json
import hashlib
import sqlite3
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_REAL_DIR = PROJECT_ROOT / "data" / "raw" / "real"
PROCESSED_REAL_DIR = PROJECT_ROOT / "data" / "processed" / "real"

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0
STANDARD_16_DEPTHS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000]

@dataclass
class OceanProductConfig:
    """Configurable descriptor for any oceanographic variable & temporal frequency."""
    product_id: str
    variable_name: str
    standard_name: str
    temporal_frequency: str  # 'hourly' | '3-hourly' | '6-hourly' | 'daily' | 'weekly' | 'monthly' | 'observation' | 'static'
    provider: str
    endpoint_template: str
    units_source: str
    units_target: str
    conversion_factor: float = 1.0
    conversion_offset: float = 0.0
    is_3d: bool = False
    depth_levels: List[int] = field(default_factory=lambda: STANDARD_16_DEPTHS)
    access_protocol: str = "opendap"  # 'opendap' | 'http_get' | 'rest_json' | 'erddap'
    description: str = ""

# Extensible Global Registry of Authoritative Products by Frequency
PRODUCT_REGISTRY: Dict[str, Dict[str, OceanProductConfig]] = {
    "monthly": {
        "temperature": OceanProductConfig(
            product_id="noaa_godas_pottmp_monthly",
            variable_name="pottmp",
            standard_name="thetao",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/pottmp.{year}.nc",
            units_source="K",
            units_target="degC",
            conversion_offset=-273.15,
            is_3d=True,
            description="NOAA GODAS 3D Potential Temperature Monthly Reanalysis"
        ),
        "salinity": OceanProductConfig(
            product_id="noaa_godas_salt_monthly",
            variable_name="salt",
            standard_name="so",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/salt.{year}.nc",
            units_source="kg/kg",
            units_target="PSU",
            conversion_factor=1000.0,
            is_3d=True,
            description="NOAA GODAS 3D Practical Salinity Monthly Reanalysis"
        ),
        "currents_u": OceanProductConfig(
            product_id="noaa_godas_ucur_monthly",
            variable_name="ucur",
            standard_name="uo",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/ucur.{year}.nc",
            units_source="m/s",
            units_target="m/s",
            is_3d=True,
            description="NOAA GODAS 3D Eastward Zonal Current"
        ),
        "currents_v": OceanProductConfig(
            product_id="noaa_godas_vcur_monthly",
            variable_name="vcur",
            standard_name="vo",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/vcur.{year}.nc",
            units_source="m/s",
            units_target="m/s",
            is_3d=True,
            description="NOAA GODAS 3D Northward Meridional Current"
        ),
        "ssh": OceanProductConfig(
            product_id="noaa_godas_ssh_monthly",
            variable_name="sshg",
            standard_name="zos",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/sshg.{year}.nc",
            units_source="m",
            units_target="m",
            is_3d=False,
            description="NOAA GODAS Sea Surface Height Relative to Geoid"
        ),
        "mld": OceanProductConfig(
            product_id="noaa_godas_mld_monthly",
            variable_name="dbss_obml",
            standard_name="mlotst",
            temporal_frequency="monthly",
            provider="NOAA PSL / NCEP EMC",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/godas/dbss_obml.{year}.nc",
            units_source="m",
            units_target="m",
            is_3d=False,
            description="NOAA GODAS Ocean Mixed Layer Depth"
        ),
        "sst": OceanProductConfig(
            product_id="noaa_oisst_v2_1_monthly",
            variable_name="sst",
            standard_name="tos",
            temporal_frequency="monthly",
            provider="NOAA NCEI / PSL",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.mon.mean.nc",
            units_source="degC",
            units_target="degC",
            is_3d=False,
            description="NOAA 0.25-deg Optimum Interpolation Sea Surface Temperature Monthly"
        ),
        "chlorophyll": OceanProductConfig(
            product_id="esa_cci_chla_monthly",
            variable_name="chlor_a",
            standard_name="chl",
            temporal_frequency="monthly",
            provider="ESA Ocean Colour CCI / NOAA OceanWatch",
            endpoint_template="https://oceanwatch.pifsc.noaa.gov/erddap/griddap/esa-cci-chla-monthly-v6-0",
            units_source="mg/m^3",
            units_target="mg/m^3",
            is_3d=False,
            access_protocol="erddap",
            description="ESA Ocean Colour Climate Change Initiative v6.0 Chlorophyll-a Monthly"
        )
    },
    "daily": {
        "sst": OceanProductConfig(
            product_id="noaa_oisst_v2_1_daily",
            variable_name="sst",
            standard_name="tos",
            temporal_frequency="daily",
            provider="NOAA NCEI / PSL",
            endpoint_template="https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.{year}.nc",
            units_source="degC",
            units_target="degC",
            is_3d=False,
            description="NOAA 0.25-deg Optimum Interpolation Daily SST High-Resolution"
        ),
        "currents": OceanProductConfig(
            product_id="copernicus_glorys12v1_daily",
            variable_name="uo,vo",
            standard_name="uo,vo",
            temporal_frequency="daily",
            provider="Copernicus Marine Service (CMEMS)",
            endpoint_template="https://my.cmems-du.eu/thredds/dodsC/global-reanalysis-phy-001-030-daily",
            units_source="m/s",
            units_target="m/s",
            is_3d=True,
            description="GLORYS12V1 Global Ocean Physics Daily Reanalysis"
        )
    },
    "6-hourly": {
        "surface_winds_waves": OceanProductConfig(
            product_id="ecmwf_era5_6hourly",
            variable_name="u10,v10,swh",
            standard_name="uas,vas,swh",
            temporal_frequency="6-hourly",
            provider="ECMWF / Copernicus CDS",
            endpoint_template="https://cds.climate.copernicus.eu/api/v2",
            units_source="m/s, m",
            units_target="m/s, m",
            is_3d=False,
            access_protocol="rest_json",
            description="ERA5 6-hourly Ocean Surface Winds and Significant Wave Height"
        )
    },
    "hourly": {
        "tidal_elevation": OceanProductConfig(
            product_id="fes2014_tides_hourly",
            variable_name="tide_height",
            standard_name="zos_tide",
            temporal_frequency="hourly",
            provider="AVISO+ / CNES",
            endpoint_template="https://www.aviso.altimetry.fr/fes2014",
            units_source="m",
            units_target="m",
            is_3d=False,
            description="FES2014 Finite Element Tidal Solution Hourly Height"
        )
    },
    "observation": {
        "argo_ctd": OceanProductConfig(
            product_id="argo_gdac_profiles",
            variable_name="pressure,temperature,salinity",
            standard_name="ctd_profiles",
            temporal_frequency="observation",
            provider="Argo GDAC / Argovis API",
            endpoint_template="https://argovis-api.colorado.edu/argo",
            units_source="dbar, degC, PSU",
            units_target="dbar, degC, PSU",
            is_3d=False,
            access_protocol="rest_json",
            description="Argo Float Station CTD Profiles"
        ),
        "gliders": OceanProductConfig(
            product_id="imos_anfog_gliders",
            variable_name="TIME,LAT,LON,DEPTH,TEMP,PSAL",
            standard_name="glider_trajectories",
            temporal_frequency="observation",
            provider="IMOS / ANFOG / AODN",
            endpoint_template="https://thredds.aodn.org.au/thredds/fileServer/IMOS/ANFOG",
            units_source="degC, PSU, m",
            units_target="degC, PSU, m",
            is_3d=False,
            access_protocol="http_get",
            description="Autonomous Underwater Ocean Glider High-Frequency Mission Trajectories"
        )
    },
    "static": {
        "bathymetry": OceanProductConfig(
            product_id="noaa_etopo_2022",
            variable_name="elevation",
            standard_name="elevation",
            temporal_frequency="static",
            provider="NOAA NCEI / OceanWatch",
            endpoint_template="https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s",
            units_source="m",
            units_target="m",
            is_3d=False,
            access_protocol="erddap",
            description="ETOPO 2022 60s Bedrock Elevation Grid"
        )
    }
}

class UnifiedRealAcquisitionEngine:
    """Config-driven engine to execute and monitor real data acquisition by frequency."""

    def __init__(self):
        self.registry = PRODUCT_REGISTRY

    def get_supported_frequencies(self) -> List[str]:
        return list(self.registry.keys())

    def get_products_for_frequency(self, frequency: str) -> Dict[str, OceanProductConfig]:
        return self.registry.get(frequency, {})

    def resolve_product(self, frequency: str, variable: str) -> Optional[OceanProductConfig]:
        freq_dict = self.registry.get(frequency, {})
        return freq_dict.get(variable)

    def print_catalog(self):
        print("\n=======================================================")
        print("OCEANSCOPE INDIA — REAL DATA FREQUENCY REGISTRY")
        print("=======================================================")
        for freq, products in self.registry.items():
            print(f"\n[Frequency Mode: '{freq}'] ({len(products)} products)")
            for var_key, cfg in products.items():
                print(f"  • {var_key:<16} | ID: {cfg.product_id:<28} | Provider: {cfg.provider}")
                print(f"    Protocol: {cfg.access_protocol:<10} | Target Units: {cfg.units_target} | 3D: {cfg.is_3d}")

if __name__ == "__main__":
    engine = UnifiedRealAcquisitionEngine()
    engine.print_catalog()
