"""Serialise an edited Trial back to C3D/TRC bytes for the user to download.

A browser-uploaded file's original path is unknowable (and unwritable) from the
server, so "save" produces the edited file as a download rather than overwriting
in place."""
from __future__ import annotations

import os
import tempfile
import uuid

import numpy as np

from .parsers import Trial


def _unit_scale(units: str) -> float:
    return {"m": 1000.0, "cm": 10.0, "mm": 1.0}.get((units or "mm").lower(), 1.0)


def trial_bytes(trial: Trial) -> tuple[str, bytes]:
    """Return (download_filename, file_bytes) for the edited trial."""
    if trial.source == "c3d":
        return _download_name(trial, ".c3d"), _c3d_bytes(trial)
    if trial.source == "trc":
        return _download_name(trial, ".trc"), _trc_text(trial).encode("utf-8")
    raise ValueError(f"cannot save source type {trial.source}")


def _download_name(trial: Trial, ext: str) -> str:
    base = os.path.basename(trial.name or "edited")
    stem = os.path.splitext(base)[0]
    return f"{stem}_edited{ext}"


def _c3d_bytes(trial: Trial) -> bytes:
    import ezc3d

    if not trial.source_path or not os.path.isfile(trial.source_path):
        raise ValueError("original c3d no longer available; re-upload the file")
    c = ezc3d.c3d(trial.source_path)
    scale = _unit_scale(trial.orig_units)          # mm -> original units
    # trial.points: (nF, nM, 3) mm  ->  ezc3d points (4, nM, nF) in original units
    P = np.array(c["data"]["points"], dtype=float)  # (4, nM, nF); row 3 is the
                                                    # homogeneous coord (always 1), NOT residual
    edited = np.transpose(trial.points, (2, 1, 0)) / scale  # (3, nM, nF)
    nM = min(P.shape[1], edited.shape[1])
    nF = min(P.shape[2], edited.shape[2])
    P[:3, :nM, :nF] = edited[:, :nM, :nF]          # filled values; NaN for deleted frames
    c["data"]["points"] = P

    # ezc3d decides per-sample validity from meta_points["residuals"] on write
    # (residual < 0 => the coord is written as missing/NaN, regardless of P[:3]).
    # So drive residuals from the edited data or gap-fills silently vanish on save.
    invalid = np.isnan(edited[:, :nM, :nF]).any(axis=0)  # (nM, nF)
    meta = c["data"].get("meta_points")
    if meta is not None and "residuals" in meta:
        res = np.array(meta["residuals"], dtype=float)   # (1, nM, nF)
        res[0, :nM, :nF] = np.where(invalid, -1.0, 0.0)
        meta["residuals"] = res
        c["data"]["meta_points"] = meta

    tmp = os.path.join(tempfile.gettempdir(), f"biom_export_{uuid.uuid4().hex[:8]}.c3d")
    try:
        c.write(tmp)
        with open(tmp, "rb") as fp:
            return fp.read()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def _trc_text(trial: Trial) -> str:
    scale = _unit_scale(trial.orig_units)
    pts = trial.points / scale                     # (nF, nM, 3) in original units
    nF, nM, _ = pts.shape
    rate = trial.marker_rate
    units = trial.orig_units or "m"
    name = trial.name.replace(".trc", "")

    lines = []
    lines.append(f"PathFileType\t4\t(X/Y/Z)\t{name}")
    lines.append("DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames")
    lines.append(f"{rate}\t{rate}\t{nF}\t{nM}\t{units}\t{rate}\t1\t{nF}")
    hdr = "Frame#\tTime"
    for mn in trial.marker_names:
        hdr += f"\t{mn}\t\t"
    lines.append(hdr)
    sub = "\t"
    for i in range(nM):
        sub += f"\tX{i + 1}\tY{i + 1}\tZ{i + 1}"
    lines.append(sub)
    lines.append("")
    for f in range(nF):
        row = f"{f + 1}\t{f / rate:.7f}"
        for m in range(nM):
            x, y, z = pts[f, m]
            if np.isnan(x):
                row += "\t\t\t"
            else:
                row += f"\t{x:.7f}\t{y:.7f}\t{z:.7f}"
        lines.append(row)

    return "\n".join(lines)
