# Production and Quality Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the TV dashboard body as a 7:3 Production/Quality layout, enlarge the quality panels, show the complete thickness report, and accept either an image or the first page of a PDF as the thickness source.

**Architecture:** Keep the existing single-page dashboard and its six panel IDs/slot IDs. Move the KPI row into the main CSS grid, add fixed bilingual zone headings, change only the default grid geometry, and add one unified thickness-report importer in `quality-import.js` that returns the existing `{ sourceFile, importedAt, imageDataUrl }` shape.

**Tech Stack:** HTML, CSS Grid, browser JavaScript, local PDF.js, Canvas, Node.js built-in test runner.

## Global Constraints

- Use a 7:3 Production/Quality column ratio.
- Visual Inspection occupies the upper 45% and Thickness Trend the lower 55% of the Quality area.
- Keep all existing production content, import/download controls, cloud synchronization, manual data entry, and panel drag/resize behavior.
- Thickness reports accept JPG, JPEG, PNG, WebP, and PDF; PDF preview uses page 1.
- Thickness preview and full-screen viewer use contained scaling and never crop the report.
- Primary verification viewport is 1920x1080; 4K remains readable and narrow screens scroll without overlap.

---

### Task 1: Add image and PDF thickness report import

**Files:**
- Modify: `quality-import.js`
- Modify: `index.html`
- Test: `tests/quality-import.test.cjs`
- Test: `tests/index-structure.test.cjs`

**Interfaces:**
- Consumes: browser `File`, `window.pdfjsLib`, Canvas 2D context.
- Produces: `PetQualityImport.importThicknessReport(file, pdfjs, options) -> Promise<{sourceFile: string, importedAt: string, imageDataUrl: string}>`.

- [ ] **Step 1: Write failing importer tests**

Add tests asserting that `importThicknessReport` routes JPG/PNG/WebP through image compression and renders only page 1 of a PDF. The PDF mock must expose `getDocument()`, `getPage(1)`, `getViewport({ scale })`, and `render({ canvasContext, viewport }).promise`; assert the returned data URL, source filename, worker path, and that only page 1 was requested.

```js
test("renders the first PDF page as a thickness preview", async () => {
  const requestedPages = [];
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({
      getPage: async (pageNumber) => {
        requestedPages.push(pageNumber);
        return {
          getViewport: ({ scale }) => ({ width: 1000 * scale, height: 700 * scale }),
          render: () => ({ promise: Promise.resolve() })
        };
      }
    }) })
  };
  const result = await quality.importThicknessReport(
    { name: "thickness-2026-07-19.pdf", arrayBuffer: async () => new ArrayBuffer(0) },
    pdfjs
  );
  assert.deepEqual(requestedPages, [1]);
  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "vendor/pdf.worker.min.js");
  assert.equal(result.sourceFile, "thickness-2026-07-19.pdf");
  assert.match(result.imageDataUrl, /^data:image\/jpeg/);
});
```

- [ ] **Step 2: Run the importer tests and verify failure**

Run: `node --test tests/quality-import.test.cjs`

Expected: FAIL because `quality.importThicknessReport` does not exist.

- [ ] **Step 3: Implement the unified thickness importer**

Add a shared Canvas record helper, broaden `compressThicknessImage` to JPG/JPEG/PNG/WebP, add PDF page rendering, and export the unified function.

```js
async function renderThicknessPdf(file, pdfjs, options = {}) {
  if (!pdfjs?.getDocument) throw new Error("PDF parser is not loaded");
  pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.6, 1600 / base.width, 1280 / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return thicknessRecord(file.name, canvas, options.quality);
}

async function importThicknessReport(file, pdfjs, options = {}) {
  if (/\.pdf$/i.test(file?.name || "")) return renderThicknessPdf(file, pdfjs, options);
  if (/\.(?:jpe?g|png|webp)$/i.test(file?.name || "")) return compressThicknessImage(file, options);
  throw new Error(`Unsupported thickness report: ${file?.name || "unknown"}`);
}
```

Update the thickness file input to `accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"` and replace the call in `parseSelectedImports()` with:

```js
parsed.thickness = await PetQualityImport.importThicknessReport(files.thickness, window.pdfjsLib);
```

- [ ] **Step 4: Run all importer and structure tests**

Run: `node --test tests/quality-import.test.cjs tests/index-structure.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the importer change**

```bash
git add quality-import.js index.html tests/quality-import.test.cjs tests/index-structure.test.cjs
git commit -m "feat: import thickness image or PDF reports"
```

### Task 2: Rebuild the dashboard as Production and Quality zones

**Files:**
- Modify: `index.html`
- Test: `tests/index-structure.test.cjs`

**Interfaces:**
- Consumes: existing `.kpis`, six `[data-panel-id]` elements, `defaultPanelSlots`, drag/resize persistence.
- Produces: `.zone-heading.production-heading`, `.zone-heading.quality-heading`, and a ten-row `.main-grid` with unchanged slot names.

- [ ] **Step 1: Replace the old slot test with failing zone-layout assertions**

Assert that `.screen` has two rows, `.kpis` uses `grid-area: kpis`, both zone headings exist, the grid uses the approved four columns and ten-row area map, the quality panels occupy one right-side column, and the thickness thumbnail uses `object-fit: contain`.

```js
test("uses the approved production and quality TV layout", () => {
  assert.match(html, /class="zone-heading production-heading"/);
  assert.match(html, /class="zone-heading quality-heading"/);
  assert.match(html, /grid-template-columns:\s*minmax\(250px, 1\.05fr\) minmax\(320px, 1\.15fr\) minmax\(320px, 1\.15fr\) minmax\(420px, 1\.45fr\)/);
  assert.match(html, /"production production production quality"[\s\S]*"kpis kpis kpis vision"[\s\S]*"spec downtime month thickness"/);
  assert.match(html, /\.thickness-image-button img\s*\{[^}]*object-fit:\s*contain;/s);
});
```

- [ ] **Step 2: Run the structure test and verify failure**

Run: `node --test tests/index-structure.test.cjs`

Expected: FAIL because zone headings and the new grid do not exist and the thumbnail still uses `cover`.

- [ ] **Step 3: Implement the approved grid and quality sizing**

Move the existing KPI section inside `.main-grid`, add the two headings, and use this default geometry:

```css
.screen {
  grid-template-rows: auto 1fr;
}

.main-grid {
  grid-template-columns: minmax(250px, 1.05fr) minmax(320px, 1.15fr) minmax(320px, 1.15fr) minmax(420px, 1.45fr);
  grid-template-rows: 40px repeat(9, minmax(0, 1fr));
  grid-template-areas:
    "production production production quality"
    "kpis kpis kpis vision"
    "kpis kpis kpis vision"
    "spec shift month vision"
    "spec shift month vision"
    "spec shift month thickness"
    "spec downtime month thickness"
    "spec downtime month thickness"
    "spec downtime month thickness"
    "spec downtime month thickness";
}

.production-heading { grid-area: production; }
.quality-heading { grid-area: quality; }
.kpis { grid-area: kpis; }
.thickness-image-button img { object-fit: contain; }
```

Change `.vision-bars` to one full-width row per defect and increase quality metric typography within the larger panel. Keep all `data-panel-id`, `data-slot`, `layoutKey`, and panel persistence code unchanged.

- [ ] **Step 4: Run all automated tests**

Run: `node --test tests/quality-import.test.cjs tests/index-structure.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the layout change**

```bash
git add index.html tests/index-structure.test.cjs
git commit -m "feat: enlarge production and quality dashboard zones"
```

### Task 3: Verify TV rendering and publish

**Files:**
- Verify: `index.html`
- Verify: `quality-import.js`
- Verify: `dashboard-data.json`

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: tested GitHub Pages dashboard on `main` without changing synchronized production data.

- [ ] **Step 1: Start a local static server**

Run: `python -m http.server 4173 --bind 127.0.0.1`

Expected: dashboard loads at `http://127.0.0.1:4173/`.

- [ ] **Step 2: Verify 1920x1080 rendering**

Open the page at 1920x1080 and assert through browser inspection that `document.documentElement.scrollWidth === 1920`, no two visible panels overlap, the quality column is approximately 30% of the body width, and the thickness image has `object-fit: contain` with its full natural aspect ratio visible.

- [ ] **Step 3: Verify the two thickness import paths**

Import one supported image and one PDF report in separate runs. Confirm the detected/entered date, preview filename, dashboard image, click-to-open full-screen preview, and synchronized payload all use the selected report.

- [ ] **Step 4: Verify regression-sensitive controls**

Confirm Update, Sync, Pull, Download, Layout, Data Entry, panel drag, panel resize, and Reset Layout remain usable. Check browser console for zero errors.

- [ ] **Step 5: Merge current remote data and publish**

```bash
git fetch origin main
git merge origin/main
git push origin HEAD:main
```

Expected: push succeeds without overwriting newer `dashboard-data.json`; GitHub Pages serves the new layout.

- [ ] **Step 6: Recheck the live dashboard**

Open `https://limkangzhe.github.io/PET-Sheeting/` at 1920x1080, bypass cache, repeat the no-overlap/full-image checks, and record the deployed commit hash.
