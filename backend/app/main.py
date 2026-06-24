"""FastAPI backend for the Biomechanics Marker Editor.

Trials are cached in memory (single-user local app), keyed by a generated id, so
interpolation can operate server-side without round-tripping the full dataset.
"""
from __future__ import annotations

import base64
import os
import tempfile
import uuid

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import interpolation as interp
from .parsers import Trial, b64, marker_stats, parse_c3d, parse_trc, trial_to_payload
from .writers import trial_bytes

app = FastAPI(title="Marker Editor API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TRIALS: dict[str, Trial] = {}


def _load(path: str, name: str) -> Trial:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".c3d":
        return parse_c3d(path, name)
    if ext == ".trc":
        return parse_trc(path, name)
    raise HTTPException(400, f"Unsupported file type: {ext}")


@app.post("/api/trial/upload")
async def upload_trial(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in (".c3d", ".trc"):
        raise HTTPException(400, "only .c3d or .trc")
    data = await file.read()
    # Persist uploads (don't delete) so overwrite-save has a stable path.
    uploads = os.path.join(tempfile.gettempdir(), "biom_render_uploads")
    os.makedirs(uploads, exist_ok=True)
    saved_path = os.path.join(uploads, f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename or 'upload')}")
    with open(saved_path, "wb") as fp:
        fp.write(data)
    trial = _load(saved_path, file.filename or "uploaded")
    tid = uuid.uuid4().hex[:12]
    TRIALS[tid] = trial
    return trial_to_payload(trial, tid)


class InterpRequest(BaseModel):
    trialId: str
    marker: str
    method: str                         # linear | cubic | rigid | pattern
    sources: list[str] = []             # rigid: >=3 segment markers; pattern: 1 donor
    apply: bool = True                  # persist into the cached trial
    maxGap: int | None = None           # linear/cubic: skip gaps longer than this
    rangeStart: int | None = None       # only fill gaps overlapping [start, end]
    rangeEnd: int | None = None


@app.post("/api/interpolate")
def interpolate(req: InterpRequest):
    trial = TRIALS.get(req.trialId)
    if trial is None:
        raise HTTPException(404, "trial not found (reload the file)")
    if req.marker not in trial.marker_names:
        raise HTTPException(400, "unknown marker")
    mi = trial.marker_names.index(req.marker)
    target = trial.points[:, mi, :].copy()

    frange = None
    if req.rangeStart is not None and req.rangeEnd is not None:
        frange = (int(req.rangeStart), int(req.rangeEnd))

    if req.method == "linear":
        filled = interp.interp_linear(target, req.maxGap, frange)
    elif req.method == "cubic":
        filled = interp.interp_cubic(target, req.maxGap, frange)
    elif req.method == "rigid":
        srcs = [trial.points[:, trial.marker_names.index(s), :] for s in req.sources
                if s in trial.marker_names]
        if len(srcs) < 3:
            raise HTTPException(400, "rigid needs >=3 source markers")
        filled = interp.interp_rigid(target, srcs, frange)
    elif req.method == "pattern":
        if not req.sources or req.sources[0] not in trial.marker_names:
            raise HTTPException(400, "pattern needs 1 donor marker")
        donor = trial.points[:, trial.marker_names.index(req.sources[0]), :]
        filled = interp.interp_pattern(target, donor, frange)
    else:
        raise HTTPException(400, f"unknown method {req.method}")

    before_valid = int((~np.isnan(target).any(axis=1)).sum())
    after_valid = int((~np.isnan(filled).any(axis=1)).sum())

    if req.apply:
        trial.points[:, mi, :] = filled

    return {
        "marker": req.marker,
        "data": b64(filled),            # (nF, 3)
        "nFrames": filled.shape[0],
        "beforeValid": before_valid,
        "afterValid": after_valid,
        "filled": after_valid - before_valid,
        "stats": marker_stats(trial.points, trial.marker_names),
    }


@app.get("/api/trial/{trial_id}/marker/{marker}")
def get_marker(trial_id: str, marker: str):
    trial = TRIALS.get(trial_id)
    if trial is None:
        raise HTTPException(404, "trial not found")
    if marker not in trial.marker_names:
        raise HTTPException(400, "unknown marker")
    mi = trial.marker_names.index(marker)
    return {"marker": marker, "data": b64(trial.points[:, mi, :]), "nFrames": trial.n_frames}


class SetMarkerRequest(BaseModel):
    trialId: str
    marker: str
    data: str               # base64 Float32, (nF, 3) — overwrites the marker (NaN allowed)


@app.post("/api/set_marker")
def set_marker(req: SetMarkerRequest):
    """Overwrite one marker's whole trajectory (used by delete and undo to keep the
    server-side copy in sync, so rigid/pattern interpolation stays correct)."""
    trial = TRIALS.get(req.trialId)
    if trial is None:
        raise HTTPException(404, "trial not found")
    if req.marker not in trial.marker_names:
        raise HTTPException(400, "unknown marker")
    mi = trial.marker_names.index(req.marker)
    arr = np.frombuffer(base64.b64decode(req.data), dtype=np.float32).reshape(-1, 3)
    if arr.shape[0] != trial.n_frames:
        raise HTTPException(400, "frame count mismatch")
    trial.points[:, mi, :] = arr
    return {"stats": marker_stats(trial.points, trial.marker_names)}


@app.get("/api/download/{trial_id}")
def download(trial_id: str):
    """Serialise the edited trial and return it as a file download (the browser
    can't write back to the uploaded file's original path)."""
    trial = TRIALS.get(trial_id)
    if trial is None:
        raise HTTPException(404, "trial not found")
    try:
        filename, data = trial_bytes(trial)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"export failed: {e}")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/health")
def health():
    return {"ok": True, "trials": len(TRIALS)}
