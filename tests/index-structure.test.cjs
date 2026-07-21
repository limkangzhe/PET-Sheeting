const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");

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
