(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PetProductionMetrics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function numberFrom(value) {
    const number = Number(String(value ?? "").replaceAll(",", "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeFallbackOutputKg(value) {
    const number = numberFrom(value);
    return number > 0 && number < 200 ? number * 1000 : number;
  }

  function breakdownFromParts(parts = {}) {
    const goodKg = numberFrom(parts.goodKg);
    const rejectKg = numberFrom(parts.rejectKg) + numberFrom(parts.badProductKg);
    const flakesKg = numberFrom(parts.flakesKg);
    const purgingKg = numberFrom(parts.purgingKg);
    const lossKg = numberFrom(parts.lossKg);
    const componentKg = goodKg + rejectKg + flakesKg + purgingKg + lossKg;

    return {
      goodKg,
      rejectKg,
      flakesKg,
      purgingKg,
      lossKg,
      totalKg: componentKg || normalizeFallbackOutputKg(parts.outputKg)
    };
  }

  function optionalNumber(value) {
    if (value == null || String(value).trim() === "") return NaN;
    const number = Number(String(value).replaceAll(",", "").trim());
    return Number.isFinite(number) ? number : NaN;
  }

  function reconcileRecordBreakdown(parts = {}, fallbackTotalKg = 0, goodRate = 0) {
    const componentValues = {
      goodKg: optionalNumber(parts.goodKg),
      rejectKg: optionalNumber(parts.rejectKg),
      flakesKg: optionalNumber(parts.flakesKg),
      purgingKg: optionalNumber(parts.purgingKg),
      lossKg: optionalNumber(parts.lossKg)
    };
    const hasComponents = Object.values(componentValues).some(Number.isFinite);

    if (hasComponents) return breakdownFromParts(componentValues);

    const totalKg = numberFrom(fallbackTotalKg);
    const goodKg = Math.round(totalKg * numberFrom(goodRate) / 100);
    return {
      goodKg,
      rejectKg: Math.max(0, totalKg - goodKg),
      flakesKg: 0,
      purgingKg: 0,
      lossKg: 0,
      totalKg
    };
  }

  function selectProductionRecords(summaryRecords, dailyRecords) {
    return dailyRecords?.size ? dailyRecords : summaryRecords;
  }

  return {
    breakdownFromParts,
    reconcileRecordBreakdown,
    selectProductionRecords
  };
});
