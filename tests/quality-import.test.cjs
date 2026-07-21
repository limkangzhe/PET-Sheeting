const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./fixtures/vision-report-sample.json");
const quality = require("../quality-import.js");

test("maps timestamps to the 08:00 production day", () => {
  assert.equal(quality.productionDateFor("2026/7/20 7:59:59"), "2026-07-19");
  assert.equal(quality.productionDateFor("2026/7/20 8:00:00"), "2026-07-20");
  assert.equal(quality.productionDateFor("2026/2/31 8:00:00"), "");
});

test("detects supported dates in thickness filenames", () => {
  assert.equal(quality.detectDateFromFilename("2026.07.19-23.59.02.Pro.jpg"), "2026-07-19");
  assert.equal(quality.detectDateFromFilename("trend-20260720.jpeg"), "2026-07-20");
  assert.equal(quality.detectDateFromFilename("trend.jpg"), "");
});

test("parses split report sections and aggregates by production day", () => {
  const result = quality.parseVisionPages(fixture, "Report(1).pdf");
  const day = result["2026-07-19"];
  assert.equal(day.workOrderCount, 2);
  assert.equal(day.totalDefects, 794);
  assert.equal(day.topDefects[0].name, "O-Crystal Point-G2");
  assert.equal(day.topDefects[0].count, 286);
  assert.equal(day.topDefects[1].name, "N-Crystal Point-G1");
  assert.equal(day.topDefects[1].count, 205);
  assert.ok(Math.abs(day.topDefects[0].density - 286 / ((1.186 * 564.58) + (1.186 * 2333.43))) < 0.000001);
  assert.ok(Math.abs(day.overallDensity - 794 / ((1.186 * 564.58) + (1.186 * 2333.43))) < 0.000001);
});

test("replaces one imported source without clearing production or the other source", () => {
  const current = {
    selectedDate: "2026-07-19",
    dailyRecords: [{ date: "2026-07-19", productionBreakdown: { goodKg: 26478 } }],
    qualityByDate: { "2026-07-18": { totalDefects: 10 } },
    thicknessByDate: { "2026-07-19": { sourceFile: "old.jpg", imageDataUrl: "old" } }
  };
  const next = quality.mergeDashboardSources(current, {
    qualityByDate: { "2026-07-19": { totalDefects: 794 } }
  });
  assert.equal(next.dailyRecords[0].productionBreakdown.goodKg, 26478);
  assert.equal(next.qualityByDate["2026-07-18"].totalDefects, 10);
  assert.equal(next.qualityByDate["2026-07-19"].totalDefects, 794);
  assert.equal(next.thicknessByDate["2026-07-19"].sourceFile, "old.jpg");
});

test("retains only the seven newest thickness days", () => {
  const input = Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return [`2026-07-${day}`, { sourceFile: `${day}.jpg` }];
  }));
  const result = quality.trimThicknessHistory(input, 7);
  assert.deepEqual(Object.keys(result), [
    "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06",
    "2026-07-07", "2026-07-08", "2026-07-09"
  ]);
});
