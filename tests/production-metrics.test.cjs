const test = require("node:test");
const assert = require("node:assert/strict");

const {
  breakdownFromParts,
  reconcileRecordBreakdown,
  selectProductionRecords
} = require("../production-metrics.js");

test("keeps small component totals in kilograms", () => {
  const breakdown = breakdownFromParts({
    lossKg: 146,
    outputKg: 146
  });

  assert.equal(breakdown.lossKg, 146);
  assert.equal(breakdown.totalKg, 146);
});

test("combines reject and nonconforming kilograms", () => {
  const breakdown = breakdownFromParts({
    goodKg: 900,
    rejectKg: 10,
    badProductKg: 8,
    flakesKg: 50,
    purgingKg: 5,
    lossKg: 27
  });

  assert.equal(breakdown.rejectKg, 18);
  assert.equal(breakdown.totalKg, 1000);
  assert.equal(breakdown.goodKg / breakdown.totalKg * 100, 90);
});

test("uses detailed daily records instead of adding the summary twice", () => {
  const summary = new Map([["2026-07-01", { source: "summary" }]]);
  const daily = new Map([["2026-07-01", { source: "daily" }]]);

  assert.equal(selectProductionRecords(summary, daily), daily);
  assert.equal(selectProductionRecords(summary, new Map()), summary);
});

test("ignores an inflated stored total when kilogram components are available", () => {
  const breakdown = reconcileRecordBreakdown({
    goodKg: 850698,
    rejectKg: 18246,
    flakesKg: 57403,
    purgingKg: 3417,
    lossKg: 10424,
    totalKg: 3242883
  }, 0, 0);

  assert.equal(breakdown.totalKg, 940188);
  assert.equal((breakdown.goodKg / breakdown.totalKg * 100).toFixed(1), "90.5");
});

test("keeps legacy rate-only records working", () => {
  const breakdown = reconcileRecordBreakdown({}, 1000, 90);

  assert.equal(breakdown.goodKg, 900);
  assert.equal(breakdown.rejectKg, 100);
  assert.equal(breakdown.totalKg, 1000);
});
