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

  function selectProductionRecords(summaryRecords, dailyRecords) {
    return dailyRecords?.size ? dailyRecords : summaryRecords;
  }

  return {
    breakdownFromParts,
    selectProductionRecords
  };
});
