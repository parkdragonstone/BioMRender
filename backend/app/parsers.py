"""Parse .c3d (via ezc3d) and .trc files into a common Trial structure.

All positional data is normalised to **millimetres** so the frontend can apply a
single scale factor.  Forces are in N, moments in N*mm, COP in mm.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class Plate:
    corners: np.ndarray            # (4, 3) mm  -- plate outline
    origin: np.ndarray            # (3,) mm
    force: np.ndarray             # (nF, 3) N  (may be empty)
    moment: np.ndarray            # (nF, 3) N*mm
    cop: np.ndarray               # (nF, 3) mm


@dataclass
class Trial:
    name: str
    source: str                    # "c3d" | "trc"
    marker_names: list[str]
    marker_rate: float
    n_frames: int
    units: str                     # always "mm" after normalisation
    points: np.ndarray             # (nF, nM, 3) float32, NaN = missing
    analog_rate: float = 0.0
    emg_names: list[str] = field(default_factory=list)
    emg: Optional[np.ndarray] = None        # (nA, nCh)
    plates: list[Plate] = field(default_factory=list)
    source_path: str = ""                   # original file (for overwrite-save)
    orig_units: str = "mm"                  # units of the source file


# --------------------------------------------------------------------------- #
# C3D
# --------------------------------------------------------------------------- #
def parse_c3d(path: str, name: str) -> Trial:
    import ezc3d

    c = ezc3d.c3d(path, extract_forceplat_data=True)
    pts = c["data"]["points"]                       # (4, nM, nF)
    xyz = np.asarray(pts[:3], dtype=np.float32)     # (3, nM, nF)
    points = np.transpose(xyz, (2, 1, 0)).copy()    # (nF, nM, 3)

    marker_names = [s.strip() for s in c["parameters"]["POINT"]["LABELS"]["value"]]
    marker_rate = float(c["parameters"]["POINT"]["RATE"]["value"][0])
    n_frames = points.shape[0]

    units = "mm"
    orig_units = "mm"
    try:
        u = c["parameters"]["POINT"]["UNITS"]["value"][0].strip().lower()
        orig_units = u or "mm"
        if u == "m":
            points *= 1000.0
        elif u == "cm":
            points *= 10.0
    except Exception:
        pass

    # ---- analog / EMG --------------------------------------------------- #
    analog_rate = 0.0
    emg_names: list[str] = []
    emg = None
    try:
        ana = np.asarray(c["data"]["analogs"])      # (1, nCh, nA)
        analog_rate = float(c["parameters"]["ANALOG"]["RATE"]["value"][0])
        labels = [s.strip() for s in c["parameters"]["ANALOG"]["LABELS"]["value"]]
        if ana.size and ana.shape[1] > 0:
            data = ana[0].T                          # (nA, nCh)
            # Heuristic: channels not consumed by force plates are treated as EMG/analog
            emg = data.astype(np.float32)
            emg_names = labels
    except Exception:
        pass

    # ---- force platforms ------------------------------------------------ #
    # Plate positions (corners/origin/COP) carry their own unit; normalise them
    # to mm so they line up with the (already-mm) marker cloud.
    def _pos_scale(unit) -> float:
        u = str(np.asarray(unit).reshape(-1)[0]).strip().lower() if unit is not None else "mm"
        return {"m": 1000.0, "cm": 10.0, "mm": 1.0}.get(u, 1.0)

    plates: list[Plate] = []
    try:
        for p in c["data"]["platform"]:
            ps = _pos_scale(p.get("unit_position"))
            force = np.asarray(p["force"]).T          # (nF, 3) or (0,3) -- N
            moment = np.asarray(p["moment"]).T
            cop = np.asarray(p["center_of_pressure"]).T * ps
            corners = np.asarray(p["corners"]).T * ps  # (4, 3) mm
            origin = np.asarray(p["origin"]).reshape(3) * ps
            plates.append(
                Plate(
                    corners=corners.astype(np.float32),
                    origin=origin.astype(np.float32),
                    force=force.astype(np.float32) if force.size else np.zeros((0, 3), np.float32),
                    moment=moment.astype(np.float32) if moment.size else np.zeros((0, 3), np.float32),
                    cop=cop.astype(np.float32) if cop.size else np.zeros((0, 3), np.float32),
                )
            )
    except Exception:
        pass

    return Trial(
        name=name, source="c3d", marker_names=marker_names, marker_rate=marker_rate,
        n_frames=n_frames, units=units, points=points, analog_rate=analog_rate,
        emg_names=emg_names, emg=emg, plates=plates,
        source_path=path, orig_units=orig_units,
    )


# --------------------------------------------------------------------------- #
# TRC
# --------------------------------------------------------------------------- #
def parse_trc(path: str, name: str) -> Trial:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    # line[1] = meta header names, line[2] = meta values
    meta_vals = lines[2].split("\t")
    data_rate = float(meta_vals[0])
    n_frames_hdr = int(float(meta_vals[2]))
    n_markers = int(float(meta_vals[3]))
    units = meta_vals[4].strip().lower()

    # line[3] = marker names row: "Frame#  Time  m1 _ _ m2 _ _ ..."
    name_cells = lines[3].split("\t")[2:]
    marker_names = [c.strip() for c in name_cells if c.strip()][:n_markers]

    # data starts at line 5 (after X1 Y1 Z1 row and a blank line in most files)
    data_rows = []
    for ln in lines[5:]:
        if not ln.strip():
            continue
        cells = ln.split("\t")
        if len(cells) < 2:
            continue
        data_rows.append(cells)

    n_frames = len(data_rows)
    points = np.full((n_frames, n_markers, 3), np.nan, dtype=np.float32)
    for i, cells in enumerate(data_rows):
        vals = cells[2:]
        for m in range(n_markers):
            base = m * 3
            try:
                x, y, z = vals[base], vals[base + 1], vals[base + 2]
                points[i, m, 0] = float(x) if x.strip() else np.nan
                points[i, m, 1] = float(y) if y.strip() else np.nan
                points[i, m, 2] = float(z) if z.strip() else np.nan
            except (IndexError, ValueError):
                pass

    if units == "m":
        points *= 1000.0
    elif units == "cm":
        points *= 10.0

    return Trial(
        name=name, source="trc", marker_names=marker_names, marker_rate=data_rate,
        n_frames=n_frames, units="mm", points=points,
        source_path=path, orig_units=(units or "mm"),
    )


# --------------------------------------------------------------------------- #
# Stats & serialisation
# --------------------------------------------------------------------------- #
def b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr, dtype=np.float32).tobytes()).decode("ascii")


def marker_stats(points: np.ndarray, names: list[str]) -> list[dict]:
    valid = ~np.isnan(points).any(axis=2)          # (nF, nM)
    total = points.shape[0]
    out = []
    for m, nm in enumerate(names):
        v = int(valid[:, m].sum())
        out.append({
            "name": nm,
            "valid": v,
            "total": total,
            "percent": round(100.0 * v / total, 1) if total else 0.0,
        })
    return out


def trial_to_payload(trial: Trial, trial_id: str) -> dict:
    nF, nM, _ = trial.points.shape
    plates = []
    for p in trial.plates:
        plates.append({
            "corners": p.corners.reshape(-1).tolist(),
            "origin": p.origin.tolist(),
            "hasData": bool(p.force.shape[0] > 0),
            "nFrames": int(p.force.shape[0]),
            "force": b64(p.force) if p.force.size else "",
            "cop": b64(p.cop) if p.cop.size else "",
            "moment": b64(p.moment) if p.moment.size else "",
        })

    emg = None
    if trial.emg is not None and trial.emg.size:
        emg = {
            "rate": trial.analog_rate,
            "names": trial.emg_names,
            "nFrames": int(trial.emg.shape[0]),
            "data": b64(trial.emg),        # (nA, nCh) row-major
            "nCh": int(trial.emg.shape[1]),
        }

    return {
        "trialId": trial_id,
        "name": trial.name,
        "source": trial.source,
        "markerNames": trial.marker_names,
        "markerRate": trial.marker_rate,
        "nFrames": nF,
        "nMarkers": nM,
        "units": trial.units,
        "points": b64(trial.points),       # frame-major: (f*nM + m)*3 + c
        "stats": marker_stats(trial.points, trial.marker_names),
        "plates": plates,
        "emg": emg,
    }
