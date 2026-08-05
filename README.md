# CETP-Baddi — Operations Dashboard (web demo)

An interactive dashboard for the daily effluent data of the Baddi Common Effluent Treatment
Plant. Load the plant's Excel workbooks and it charts the whole treatment train in process
order — Equalization → Primary → Secondary → Tertiary — with target bands, hydraulic metrics
and a switchable time window.

**Zero dependencies.** No frameworks, no CDN, no build step required — `index.html` is a single
self-contained file with its own `.xlsx` reader (ZIP + DEFLATE + OOXML) and SVG chart engine.

## Privacy — nothing is uploaded or stored

Files are parsed **entirely in the browser**, in memory, for the current session only:

- No server, no upload — the workbooks never leave the machine.
- **No workbook data is written to the browser** (`PERSIST_DATA = false` in `src/app.js`).
  Load the files again each time you open the page.
- Only lightweight UI preferences (theme, time window, target values) are kept in
  `localStorage`. Clear them with **⚙ Config → Reset targets to defaults**.

## Using it

1. Open the page.
2. Drag in `Category-1.xlsx`, `Category-2.xlsx`, `Category-3.xlsx` (one, two, or all three) —
   or click to browse.
3. Switch categories, pick a window (15 / 30 / 60 / 90 days / All), toggle the flow overlay,
   and edit any target in **⚙ Config**.

> The demo needs the plant's workbooks to show anything. Anyone opening the deployed link
> without them will see the drop screen — consider shipping a small sample workbook if you want
> the link to be self-demonstrating.

## What it shows

| Stage | Charts |
|---|---|
| **1 · Equalization** | flow received · COD (unfiltered/filtered) & BOD · particulate COD (shared scale) · BOD/COD ratio · influent turbidity · equalization HRT |
| **2 · Primary** | primary vs overall COD removal · particulate COD vs amount removed · turbidity in → primary o/f · colour in/out (Cat-2/3) · primary HRT · primary SOR |
| **3 · Secondary** | DO by chamber with anoxic/low bands · MLSS & MLVSS · MLVSS:MLSS vs 0.70 / 0.65 targets · sludge wastage & recycle · SVI · F/M vs band · secondary COD removal · secondary clarifier turbidity · aeration HRT · secondary clarifier SOR |
| **4 · Tertiary** | final COD / BOD / TSS vs consent limits · effluent NH₄-N · tertiary SOR |
| **5 · Raw explorer** | plot any logged column |

Plus KPI cards (final COD, final BOD, lowest chamber DO, MLSS, sludge wastage, overall COD
removal, F/M) and a **flow overlay** on a right-hand axis where it adds context.

Hydraulic metrics (F/M, HRT, SOR) use the plant's tank capacities, built in for **Cat-1** and
**Cat-3**. **Cat-2 capacities are not yet available**, so those charts stay disabled for that
train until the volumes are entered in ⚙ Config.

## Repo layout

```
index.html        ← the deployable dashboard (built artifact — this is what Vercel serves)
src/
  cetp_core.js    ← dependency-free .xlsx reader + parser + metric column maps
  app.js          ← UI, KPIs, SVG chart engine   (PERSIST_DATA flag lives here)
  styles.css      ← dark + light themes
  template.html   ← HTML shell with __CSS__ / __CORE__ / __APP__ / __BGIMG__ tokens
  bg_b64.txt      ← background image, base64
  build.py        ← inlines src/* into index.html
```
