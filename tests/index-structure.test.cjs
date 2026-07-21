const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");

function functionBody(name) {
  const start = html.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === "{") depth += 1;
    if (html[index] === "}" && --depth === 0) return html.slice(open + 1, index);
  }
  assert.fail(`could not extract ${name}`);
}

test("loads local PDF.js and quality import scripts before dashboard code", () => {
  const pdf = html.indexOf('src="vendor/pdf.min.js"');
  const quality = html.indexOf('src="quality-import.js"');
  const dashboard = html.indexOf("const storageKey");
  assert.ok(pdf > 0 && quality > pdf && dashboard > quality);
});

test("provides a three-source import dialog and preview", () => {
  for (const id of [
    "importOverlay", "productionFileInput", "visionFileInput", "thicknessFileInput",
    "importPreview", "confirmImport", "cancelImport"
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test("synchronized payload includes quality and thickness maps", () => {
  assert.match(html, /qualityByDate:\s*data\.qualityByDate/);
  assert.match(html, /thicknessByDate:\s*data\.thicknessByDate/);
});

test("confirmed imports publish merged data and preserve local data on publish failure", () => {
  const body = functionBody("confirmSelectedImports");
  assert.match(body, /await\s+publishCurrentData\(\)/);
  assert.match(body, /try\s*\{[\s\S]*localOverride\s*=\s*false[\s\S]*setSyncState\("synced"\)/);
  assert.match(body, /catch\s*\(error\)\s*\{[\s\S]*localOverride\s*=\s*true[\s\S]*setSyncState\("pending", error\.message/);
  assert.match(body, /saveData\(\);[\s\S]*render\(\);/);
});

test("production JSON parsing carries normalized quality and thickness maps into the import patch", () => {
  const parseBody = functionBody("parseSelectedImports");
  const confirmBody = functionBody("confirmSelectedImports");
  assert.match(parseBody, /const production = normalizeSyncedData\(payload\)/);
  assert.match(parseBody, /qualityByDate:\s*production\.qualityByDate/);
  assert.match(parseBody, /thicknessByDate:\s*production\.thicknessByDate/);
  assert.match(confirmBody, /parsed\.production\.qualityByDate/);
  assert.match(confirmBody, /parsed\.production\.thicknessByDate/);
});

test("confirmed imports lock controls and only clean up their own generation", () => {
  const confirmBody = functionBody("confirmSelectedImports");
  const lockBody = functionBody("setImportControlsLocked");
  assert.match(html, /const importState = \{ parsed: null, token: 0, confirming: false \};/);
  assert.match(confirmBody, /if \(importState\.confirming\) return;/);
  assert.match(confirmBody, /importState\.confirming = true;/);
  assert.match(confirmBody, /setImportControlsLocked\(true\)/);
  assert.match(confirmBody, /const operationToken = importState\.token;/);
  assert.match(confirmBody, /if \(operationToken !== importState\.token \|\| !isCurrentSyncOperation\(syncOperationToken\)\) return;/);
  assert.match(confirmBody, /finally\s*\{[\s\S]*importState\.confirming = false;[\s\S]*setImportControlsLocked\(false\)/);
  for (const id of ["productionFileInput", "visionFileInput", "thicknessFileInput", "confirmImport", "clearImport", "cancelImport"]) {
    assert.match(lockBody, new RegExp(`"${id}"`));
  }
  assert.match(lockBody, /\.disabled = locked/);
  assert.match(lockBody, /正在同步 \/ Syncing/);
  assert.match(html, /if \(importState\.confirming\) return;[\s\S]*clearSelectedImports\(\)/);
});

test("registers compact quality panels and thickness lightbox", () => {
  for (const value of [
    'data-panel-id="vision"', 'data-panel-id="thickness"',
    'id="visionTotal"', 'id="visionDensity"', 'id="visionBars"',
    'id="thicknessImage"', 'id="thicknessLightbox"'
  ]) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /defaultPanelOrder\s*=\s*\[[^\]]*"vision"[^\]]*"thickness"/s);
});

test("renders absent visual density as no data", () => {
  const body = functionBody("updateQualityPanels");
  assert.match(body, /quality\?\.overallDensity\s*==\s*null\s*\?\s*null\s*:\s*Number\(quality\?\.overallDensity\)/);
});

test("uses complete fixed slots for the six dashboard panels", () => {
  assert.match(html, /grid-template-areas:\s*"spec shift month month"\s*"spec shift month month"\s*"spec downtime month month"\s*"spec downtime vision thickness"/s);
  for (const id of ["spec", "shift", "downtime", "month", "vision", "thickness"]) {
    assert.match(html, new RegExp(`data-panel-id="${id}"[^>]*data-slot="${id}"|data-slot="${id}"[^>]*data-panel-id="${id}"`));
  }
  const applyBody = functionBody("applyPanelLayout");
  const loadBody = functionBody("loadPanelLayout");
  const dragBody = functionBody("setupPanelDrag");
  assert.match(html, /const layoutKey = "pet-sheet-dashboard-panel-layout-v3"/);
  assert.match(applyBody, /panel\.dataset\.slot\s*=\s*normalized\[panel\.dataset\.panelId\]/);
  assert.doesNotMatch(applyBody, /appendChild/);
  assert.match(loadBody, /isValidPanelLayout\(saved\)/);
  assert.match(dragBody, /dragged\.dataset\.slot\s*=\s*targetSlot/);
  assert.match(dragBody, /panel\.dataset\.slot\s*=\s*draggedSlot/);
});

test("keeps the thickness viewer modal and current when data changes", () => {
  assert.match(html, /id="thicknessLightbox"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="thicknessLightboxTitle"/);
  const openBody = functionBody("openThicknessLightbox");
  const closeBody = functionBody("closeThicknessLightbox");
  const updateBody = functionBody("updateQualityPanels");
  assert.match(openBody, /lightboxReturnFocus\s*=\s*document\.activeElement/);
  assert.match(openBody, /requestAnimationFrame\(\(\)\s*=>\s*el\("thicknessClose"\)\.focus\(\)\)/);
  assert.match(closeBody, /el\("thicknessFullImage"\)\.removeAttribute\("src"\)/);
  assert.match(closeBody, /lightboxReturnFocus\.focus\(\)/);
  assert.match(updateBody, /lightbox\.classList\.contains\("open"\)/);
  assert.match(updateBody, /el\("thicknessFullImage"\)\.src\s*=\s*thickness\.imageDataUrl/);
  assert.match(html, /event\.key === "Tab"/);
});

test("exposes pending cloud state and retry without discarding local data", () => {
  assert.match(html, /id="retrySync"/);
  assert.match(html, /function retryPendingSync\s*\(/);
  assert.match(html, /localOverride\s*&&/);
  assert.match(html, /GitHub Token.*401|401.*GitHub Token/s);
});

test("keeps pending local data on automatic pulls and confirms forced pulls", () => {
  const start = html.indexOf("async function loadSyncedData");
  const body = html.slice(start, html.indexOf("\n    function saveData", start));
  assert.match(body, /if\s*\(!force\s*&&\s*localOverride\)\s*return/);
  assert.match(body, /force\s*&&\s*localOverride\s*&&\s*!confirm\(/);
  assert.match(body, /localOverride\s*&&\s*localSyncedAt\s*&&\s*remoteSyncedAt\s*&&\s*remoteSyncedAt\s*<=\s*localSyncedAt/);
});

test("serializes retry completion against newer dashboard sync operations", () => {
  const retryBody = functionBody("retryPendingSync");
  const syncStateBody = functionBody("setSyncState");
  const publishBody = functionBody("publishCurrentData");
  const publishedStateBody = functionBody("applyPublishedState");
  assert.match(html, /let syncOperation = 0;/);
  assert.match(html, /let retryInFlight = false;/);
  assert.doesNotMatch(publishBody, /dataSourceLabel|remoteHoldKey/);
  assert.match(publishedStateBody, /if\s*\(!isCurrentSyncOperation\(operationToken\)\)\s*return false/);
  assert.match(publishedStateBody, /dataSourceLabel\s*=\s*"GitHub云同步 \/ GitHub Sync"/);
  assert.match(publishedStateBody, /localStorage\.setItem\(remoteHoldKey/);
  assert.match(retryBody, /if\s*\(!localOverride\s*\|\|\s*importState\.confirming\s*\|\|\s*retryInFlight\)\s*return/);
  assert.match(retryBody, /const operationToken = beginSyncOperation\(\)/);
  assert.match(retryBody, /await publishCurrentData\(\);\s*if\s*\(!applyPublishedState\(operationToken\)\)\s*return;\s*localOverride\s*=\s*false/);
  assert.match(retryBody, /catch\s*\(error\)\s*\{\s*if\s*\(!isCurrentSyncOperation\(operationToken\)\)\s*return;\s*localOverride\s*=\s*true/);
  assert.match(retryBody, /finally\s*\{[\s\S]*retryInFlight\s*=\s*false[\s\S]*if\s*\(isCurrentSyncOperation\(operationToken\)\)\s*setSyncState\(syncState\)/);
  assert.match(syncStateBody, /state\s*===\s*"syncing"\s*\|\|\s*retryInFlight/);
  for (const name of ["confirmSelectedImports", "handleUploadedFile", "readForm"]) {
    assert.match(functionBody(name), /beginSyncOperation\(\)/);
  }
  assert.match(functionBody("confirmSelectedImports"), /await publishCurrentData\(\);[\s\S]*applyPublishedState\(syncOperationToken\)/);
  assert.match(functionBody("handleUploadedFile"), /await publishCurrentData\(\);\s*if\s*\(!applyPublishedState\(operationToken\)\)\s*return/);
  const pullStart = html.indexOf("async function loadSyncedData");
  const pullBody = html.slice(pullStart, html.indexOf("\n    function saveData", pullStart));
  assert.match(pullBody, /const operationToken = beginSyncOperation\(\)/);
  assert.match(pullBody, /if\s*\(!isCurrentSyncOperation\(operationToken\)\)\s*return/);
});
