# BioM Render — Biomechanics .c3d / .trc viewer

A local web app for inspecting motion-capture trials: 3D marker playback, skeleton
building, gap interpolation, marker validity stats, and ground-reaction-force /
COP visualisation.

- **Backend** — FastAPI + [`ezc3d`](https://github.com/pyomeca/ezc3d) for robust
  C3D parsing (markers, analog/EMG, force plates + COP). Custom TRC parser. Runs on port **8137**.
- **Frontend** — Vite + React + TypeScript + Three.js (react-three-fiber). Dev server on port **5173**.

---

## How to run

### Prerequisites
- **Python 3.10+** (the project was built/tested on 3.13)
- **Node.js 18+** and npm

### 1. Backend (Python) — one-time setup

```bash
cd backend
python -m venv venv
# Windows:
venv/Scripts/python -m pip install -r requirements.txt
# macOS / Linux:
# source venv/bin/activate && pip install -r requirements.txt
```

> The venv at `backend/venv` may already exist from setup — if so, skip the create step.

### 2. Frontend (Node) — one-time setup

```bash
cd frontend
npm install
```

### 3. Start both servers

**Easiest — one command from the project root:**

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File run.ps1
```

```bash
# macOS / Linux
bash run.sh          # or:  chmod +x run.sh && ./run.sh
```

Both launch the backend (8137) and frontend (5173) together and stop them on `Ctrl+C`.
`run.sh` also performs the one-time setup automatically on first run (creates `backend/venv`,
installs Python deps, and runs `npm install` if needed) — so on macOS/Linux you can skip steps
1–2 and just run it. (The `backend/venv` in the repo is Windows-only; `run.sh` builds a fresh one.)

**Or run them manually in two terminals:**

```bash
# terminal 1 — backend
cd backend
venv/Scripts/python -m uvicorn app.main:app --port 8137      # Windows
# source venv/bin/activate && uvicorn app.main:app --port 8137  # macOS/Linux

# terminal 2 — frontend
cd frontend
npm run dev
```

### 4. Open the app

Go to **<http://localhost:5173>**. To load data:

- **Drag & drop** a `.c3d` / `.trc` file — or a whole **folder** containing them — anywhere
  onto the window. Dropping multiple files (or a folder) loads the first and lists the rest
  in a **Dropped files** dropdown.
- Or click **Upload .c3d / .trc** (multi-select supported).

The `examples/` folder holds reference samples only — they are **not** loaded automatically; load
your own data via drag & drop or the Upload button.

Saving (`Ctrl+S` / **Save**) **overwrites the original file in place** via the browser's File System
Access API (Chrome/Edge). The first save asks for write permission; subsequent saves are silent. This
requires opening the file through the **Upload** button or a drag & drop of the file itself (a writable
handle). In browsers without the API — or for files inside a dropped *folder* — Save falls back to a
**download** named `<name>_edited.c3d` / `.trc`.

The frontend proxies `/api` to the backend automatically, so no extra configuration is needed.

To stop: `Ctrl+C` in each terminal (or close the windows spawned by `run.ps1`).

---

## Features

| # | Feature |
|---|---------|
| 1 | Marker gap-fill: **linear, cubic spline, rigid-body (≥3 segment markers), pattern (1 donor marker)**. Linear/cubic never extrapolate and have a **Max gap (frames, default 15)** limit — longer gaps are left alone. If a frame range is selected on the graph, only that range is filled; otherwise all gaps are filled. |
| 2 | Build a skeleton by connecting markers; **export/import `.json`** (re-uploading re-applies the connections). |
| 3 | Per-marker & skeleton **colours** via an 8-swatch picker (+ "More color…" for the full picker); saved inside the skeleton `.json`. |
| 4 | Right sidebar lists every marker with **valid / total frames and %** plus an overall figure. |
| 5 | Selecting a marker opens a **time-series overlay** (X/Y/Z) over the bottom ~1/5 of the viewer (overlay — does not resize the 3D view). |
| 6 | **Spacebar** toggles play/pause; playback **loops** to the start when it reaches the end. |
| 7 | Force plates drawn on the ground; when force data exists a **force vector is drawn from the COP**, time-synced to playback even when analog is sampled faster than markers. |
| 8 | **Click a force plate** to plot its Fx/Fy/Fz; **Ctrl+click several plates** to plot their **resultant (summed) force**. Selected plates are highlighted. |
| 9 | **Resizable** panel borders (drag the dividers; drag the overlay's top edge to resize it). |
| 10 | 3D controls: **left-drag rotate, wheel zoom, right-drag pan**. Z-up scene. |
| 11 | **Ctrl + left-drag** in the 3D view box-selects markers (camera stays fixed); selection adds to the current set. |
| 12 | In the sidebar, **Shift+click** = range select, **Ctrl/⌘+click** = toggle; then **Apply** a colour to all selected markers at once. |
| 13 | **Make Skeleton** mode: click the first marker, then the next, in the 3D view to add a connection (chains, so A→B→C builds a chain). Esc stops. |
| 14 | **Z-up / Y-up** toggle (top bar): for Y-up source data it remaps `x,y,z → z,x,y` so the subject stands upright. |
| 15 | **Hover** any marker in the 3D view to see its name; name tags are drawn above the sphere (never occluding it) and always render on top. |
| 16 | Drag markers (⠿ handle) in the sidebar to **reorder** the list. |
| 17 | Graph (x-axis = frame #): **left-click/drag = scrub**, **wheel = zoom X**, **right-drag = pan X**, **Ctrl+drag = zoom to region**, **double-click = reset**. **Hover = tooltip + legend values**; click an **X/Y/Z legend** entry to show/hide that axis. |
| 18 | Frames with **missing marker data are shaded red** on the graph. **Click a red band** to select that whole gap; or **Shift+right-drag** to select any frame range. **🗑 Delete** removes the current frame (or the selected range → NaN). Edits keep the current zoom; fix gaps later with gap-fill. |
| 19 | **Trail** toggle (top bar, default off, **150** frames) draws the trajectory of the selected marker(s) over the previous N frames. |
| 20 | **Ctrl+Z** undoes the last gap-fill/delete; **Ctrl+S** overwrite-saves the edited data back to the source `.c3d`/`.trc` file. (Undo/Save buttons are also in the top bar.) |

All positions — markers, force-plate corners, COP — are normalised to millimetres using each
stream's own unit, so GRF vectors line up with the marker cloud even when the C3D stores points
in metres. Force/COP are resampled from the analog rate onto the marker timeline so they stay in
sync during playback.

## Notes

- The bundled `001.c3d` has force-plate *metadata* (4 plates) but **no recorded analog
  channels**, so plate outlines appear but force vectors do not. Files with analog force data
  show the COP force arrows and the GRF time series.
- Missing markers are `NaN` and excluded from validity counts.
