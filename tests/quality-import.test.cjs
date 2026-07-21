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

test("parses Unicode vision report headers with fixture-equivalent aggregation", () => {
  const unicodeFixture = structuredClone(fixture);
  const aliases = new Map([
    [fixture[1].tokens[0], "\u7f3a\u9677\u79cd\u7c7b"],
    [fixture[1].tokens[2], "\u7f3a\u9677\u6570\u91cf"],
    [fixture[1].tokens[3], "\u5bc6\u5ea6"],
    [fixture[2].tokens.at(-5), "\u603b\u8ba1"]
  ]);
  unicodeFixture.forEach((page) => {
    page.tokens = page.tokens.map((token) => aliases.get(token) || token);
  });

  const expected = quality.parseVisionPages(fixture, "fixture.pdf")["2026-07-19"];
  const actual = quality.parseVisionPages(unicodeFixture, "Report(1).pdf")["2026-07-19"];

  assert.deepEqual(
    {
      workOrderCount: actual.workOrderCount,
      totalDefects: actual.totalDefects,
      overallDensity: actual.overallDensity,
      topDefects: actual.topDefects
    },
    {
      workOrderCount: expected.workOrderCount,
      totalDefects: expected.totalDefects,
      overallDensity: expected.overallDensity,
      topDefects: expected.topDefects
    }
  );
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

test("exposes browser file import functions", () => {
  assert.equal(typeof quality.extractVisionPdf, "function");
  assert.equal(typeof quality.compressThicknessImage, "function");
});

test("extracts vision PDF pages with the local worker", async () => {
  const pdfjs = {
    GlobalWorkerOptions: {},
    getDocument: ({ data }) => {
      assert.ok(data instanceof ArrayBuffer);
      return {
        promise: Promise.resolve({
          numPages: fixture.length,
          getPage: async (pageNumber) => ({
            getTextContent: async () => ({ items: fixture[pageNumber - 1].tokens.map((str) => ({ str })) })
          })
        })
      };
    }
  };
  const file = { name: "vision-report.pdf", arrayBuffer: async () => new ArrayBuffer(0) };

  const result = await quality.extractVisionPdf(file, pdfjs);

  assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, "vendor/pdf.worker.min.js");
  assert.equal(result["2026-07-19"].totalDefects, 794);
});

test("compresses oversized thickness images within hard limits", async () => {
  const originalCreateImageBitmap = global.createImageBitmap;
  const originalDocument = global.document;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      fillRect() {},
      drawImage() {}
    }),
    toDataURL: (...args) => {
      canvas.toDataURLArgs = args;
      return "data:image/jpeg;base64,compressed";
    }
  };
  const bitmap = { width: 4000, height: 2000, closeCalled: false, close() { this.closeCalled = true; } };
  global.createImageBitmap = async () => bitmap;
  global.document = { createElement: () => canvas };

  try {
    const result = await quality.compressThicknessImage(
      { name: "thickness.jpg" },
      { maxWidth: 4000, maxHeight: 4000, quality: 1 }
    );

    assert.equal(canvas.width, 1600);
    assert.equal(canvas.height, 800);
    assert.equal(canvas.width / canvas.height, bitmap.width / bitmap.height);
    assert.deepEqual(canvas.toDataURLArgs, ["image/jpeg", 0.72]);
    assert.equal(bitmap.closeCalled, true);
    assert.equal(result.sourceFile, "thickness.jpg");
  } finally {
    if (originalCreateImageBitmap === undefined) delete global.createImageBitmap;
    else global.createImageBitmap = originalCreateImageBitmap;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});
