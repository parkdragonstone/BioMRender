"""Marker gap-filling methods.

Each function takes the (nF, 3) target marker and fills NaN gaps, leaving valid
frames untouched.  Optional restrictions:
  - frange = (start, end) inclusive: only fill gaps overlapping this frame range.
  - max_gap (linear/cubic): skip gaps longer than this many frames.
Leading/trailing gaps are only fillable by rigid/pattern (which use other markers);
linear/cubic never extrapolate.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

Range = Optional[tuple[int, int]]


def _runs(valid: np.ndarray) -> list[tuple[int, int]]:
    """All maximal runs of invalid frames as [start, end) pairs."""
    n = len(valid)
    runs, i = [], 0
    while i < n:
        if not valid[i]:
            j = i
            while j < n and not valid[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _select(valid: np.ndarray, max_gap: Optional[int], frange: Range,
            interior_only: bool) -> list[tuple[int, int]]:
    """Sub-ranges (lo, hi) to actually fill, after applying the limits."""
    n = len(valid)
    out: list[tuple[int, int]] = []
    for s, e in _runs(valid):
        if interior_only and (s == 0 or e == n):     # can't extrapolate
            continue
        if max_gap is not None and (e - s) > max_gap:  # gap too long
            continue
        lo, hi = s, e
        if frange is not None:
            lo = max(lo, frange[0])
            hi = min(hi, frange[1] + 1)
            if lo >= hi:
                continue
        out.append((lo, hi))
    return out


def interp_linear(target: np.ndarray, max_gap: Optional[int] = None, frange: Range = None) -> np.ndarray:
    out = target.copy()
    valid = ~np.isnan(target).any(axis=1)
    if valid.sum() < 2:
        return out
    idx = np.arange(len(target))
    vi = idx[valid]
    for lo, hi in _select(valid, max_gap, frange, interior_only=True):
        for c in range(3):
            out[lo:hi, c] = np.interp(idx[lo:hi], vi, target[valid, c])
    return out


def interp_cubic(target: np.ndarray, max_gap: Optional[int] = None, frange: Range = None) -> np.ndarray:
    from scipy.interpolate import CubicSpline

    out = target.copy()
    valid = ~np.isnan(target).any(axis=1)
    if valid.sum() < 4:
        return interp_linear(target, max_gap, frange)
    idx = np.arange(len(target))
    vi = idx[valid]
    cs = [CubicSpline(vi, target[valid, c]) for c in range(3)]
    for lo, hi in _select(valid, max_gap, frange, interior_only=True):
        for c in range(3):
            out[lo:hi, c] = cs[c](idx[lo:hi])
    return out


def interp_rigid(target: np.ndarray, sources: list[np.ndarray], frange: Range = None) -> np.ndarray:
    """Fill gaps using a rigid body of >=3 source markers on the same segment.
    For each gap frame, the rigid transform (Kabsch) mapping the sources from the
    nearest fully-valid frame to the current frame is applied to the target."""
    out = target.copy()
    if len(sources) < 3:
        return interp_linear(target, None, frange)
    S = np.stack(sources, axis=1)                  # (nF, k, 3)
    tvalid = ~np.isnan(target).any(axis=1)
    svalid = ~np.isnan(S).any(axis=(1, 2))
    ref_all = np.where(tvalid & svalid)[0]
    if ref_all.size == 0:
        return out
    for lo, hi in _select(tvalid, None, frange, interior_only=False):
        for f in range(lo, hi):
            if not svalid[f]:
                continue
            ref = ref_all[np.argmin(np.abs(ref_all - f))]
            R, t = _kabsch(S[ref], S[f])
            out[f] = R @ target[ref] + t
    return out


def _kabsch(P: np.ndarray, Q: np.ndarray):
    """Rigid transform R,t such that R*P + t ~= Q.  P,Q are (k,3)."""
    cP = P.mean(axis=0)
    cQ = Q.mean(axis=0)
    H = (P - cP).T @ (Q - cQ)
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    t = cQ - R @ cP
    return R, t


def interp_pattern(target: np.ndarray, donor: np.ndarray, frange: Range = None) -> np.ndarray:
    """Fill gaps using a single donor marker that follows a similar path.
    The offset (target - donor) is interpolated across the gap and re-added."""
    out = target.copy()
    tvalid = ~np.isnan(target).any(axis=1)
    dvalid = ~np.isnan(donor).any(axis=1)
    both = tvalid & dvalid
    if both.sum() < 2:
        return interp_linear(target, None, frange)
    idx = np.arange(len(target))
    bi = idx[both]
    diff = target - donor
    for lo, hi in _select(tvalid, None, frange, interior_only=False):
        for f in range(lo, hi):
            if not dvalid[f]:
                continue
            off = np.array([np.interp(f, bi, diff[both, c]) for c in range(3)])
            out[f] = donor[f] + off
    return out
