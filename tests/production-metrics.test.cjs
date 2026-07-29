const test = require("node:test");
const assert = require("node:assert/strict");

const {
  breakdownFromParts,
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
