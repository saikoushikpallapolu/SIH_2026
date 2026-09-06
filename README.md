# OceanScope India

High-graphics browser prototype for visualising Indian Ocean model fields and in-situ observations.

## Run the visual prototype

```powershell
cd oceanscope-india
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The current application deliberately uses realistic deterministic mock fields; selecting a location changes its depth/time/variable value and the scene contains Argo, BGC-Argo, and Glider examples.

## Phase plan

1. **Phase 1 — visual foundation (complete):** cinematic WebGL globe, field selection, timeline, depth navigation, markers, mock data contract.
2. **Phase 2 — scientific workspace:** true horizontal depth slices, vertical transect curtain, profile modal, model-vs-observation charts, dynamic colourbar.
3. **Phase 3 — real data:** run NetCDF/observation ingestion, build chunked tiles, replace mock provider with API calls, validate values with INCOIS.
4. **Phase 4 — production readiness:** quarterly import workflow, cache/CDN, auth/RBAC, PostGIS catalogue, monitoring and audit trail.

See [DATA_COLLECTION.md](./DATA_COLLECTION.md) for exactly what to collect and where it belongs.

## Cloud Data Synchronization (Hugging Face Hub)

The complete 25-year multimodal dataset (~2.55 GB) is hosted on the Hugging Face Hub at [Maybe-Heisenberg-07/koushik_captain_incois](https://huggingface.co/datasets/Maybe-Heisenberg-07/koushik_captain_incois).

To pull the complete dataset locally:
```powershell
python backend/scripts/sync_data.py --pull
```

To inspect local data status:
```powershell
python backend/scripts/sync_data.py --status
```

To push newly processed cubes or events:
```powershell
python backend/scripts/sync_data.py --push
```

