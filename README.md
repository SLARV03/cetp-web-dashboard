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

## Deploy

It's a static site — the repository root is the deployable directory.

**Vercel**

1. Push this folder to GitHub.
2. In Vercel: *New Project* → import the repo.
3. Framework preset: **Other**. Build command: *(leave empty)*. Output directory: `.`
4. Deploy. `index.html` is served at the root.

No environment variables and no build step are needed.

**Anywhere else** — GitHub Pages, Netlify, or any static host: serve the folder as-is. You can
also just open `index.html` from disk; it works offline with no server.

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

**Rebuilding after editing `src/`:**

```bash
python3 src/build.py
```

That regenerates `index.html`. Python 3 is the only requirement — no npm, no bundler.

## Notes & caveats

- Reference discharge limits default to CPCB inland-surface values (COD 250, BOD 30, TSS 100
  mg/L). **Replace them with the plant's actual consent limits** in ⚙ Config.
- The F/M convention (COD basis, substrate at the primary outlet, full aeration volume) was
  inferred from three years of plant data and reproduces the review panel's published target
  bands, but has not yet been confirmed by the plant's engineers.
- Where a parameter isn't logged (e.g. Cat-1 MBBR outlet, some Cat-3 SVI), the chart shows
  "no data" rather than guessing.

## Roadmap

This is the browser demo. A React fork (Vite → Vercel, later Windows via Tauri and Android) is
planned; `cetp_core.js` is written to port across unchanged.
