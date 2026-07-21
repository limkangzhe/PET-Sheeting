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
  assert.match(body, /await\s+publishRemotePayload\(dashboardPayload\(\)\)/);
  assert.match(body, /if\s*\(published\)\s*\{[\s\S]*localOverride\s*=\s*false[\s\S]*remoteHoldKey/);
  assert.match(body, /else\s*\{[\s\S]*localOverride\s*=\s*true[\s\S]*not synchronized/i);
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
