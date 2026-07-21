(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PetQualityImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
  const clean = (value) => String(value ?? "").trim();
  const isNumber = (value) => /^-?\d+(?:\.\d+)?$/.test(clean(value));
  const isOrderId = (value) => /^--\d+$/.test(clean(value));
  const pad = (value) => String(value).padStart(2, "0");

  function parseTimestamp(value) {
    const match = clean(value).match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second = "0"] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function productionDateFor(value) {
    const date = parseTimestamp(value);
    if (!date) return "";
    if (date.getHours() < 8) date.setDate(date.getDate() - 1);
    return dateKey(date);
  }

  function detectDateFromFilename(name) {
    const value = clean(name);
    const match = value.match(/(20\d{2})[._-](0?[1-9]|1[0-2])[._-](0?[1-9]|[12]\d|3[01])(?!\d)/) ||
      value.match(/(20\d{2})(0?[1-9]|1[0-2])(0?[1-9]|[12]\d|3[01])(?!\d)/);
    if (!match) return "";
    const candidate = `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
    const date = new Date(`${candidate}T12:00:00`);
    return Number.isNaN(date.getTime()) || dateKey(date) !== candidate ? "" : candidate;
  }

  function parseWorkOrders(pages) {
    const orders = new Map();
    for (const page of pages) {
      const tokens = (page.tokens || []).map(clean).filter(Boolean);
      for (let index = 4; index < tokens.length; index += 1) {
        if (!isOrderId(tokens[index])) continue;
        const [endTime, startTime, length, width] = tokens.slice(index - 4, index);
        if (!parseTimestamp(endTime) || !parseTimestamp(startTime) || !isNumber(length) || !isNumber(width)) continue;
        orders.set(tokens[index], {
          id: tokens[index], endTime, startTime,
          lengthM: Number(length), widthCm: Number(width), defects: {}
        });
      }
    }
    return orders;
  }

  function parseDefectSections(pages, orders) {
    for (const page of pages) {
      const tokens = (page.tokens || []).map(clean).filter(Boolean);
      let index = 0;
      while (index < tokens.length) {
        if (tokens[index] !== "ç¼ºé™·ç§ç±»") { index += 1; continue; }
        let cursor = index + 1;
        const ids = [];
        while (isOrderId(tokens[cursor]) && tokens[cursor + 1] === "ç¼ºé™·æ•°é‡" && tokens[cursor + 2] === "å¯†åº¦") {
          ids.push(tokens[cursor]);
          cursor += 3;
        }
        if (!ids.length) { index += 1; continue; }
        while (cursor < tokens.length && tokens[cursor] !== "ç¼ºé™·ç§ç±»") {
          const name = tokens[cursor];
          const values = tokens.slice(cursor + 1, cursor + 1 + ids.length * 2);
          if (values.length !== ids.length * 2 || !values.every(isNumber)) { cursor += 1; continue; }
          ids.forEach((id, orderIndex) => {
            const order = orders.get(id);
            if (!order) return;
            const count = Number(values[orderIndex * 2]);
            const density = Number(values[orderIndex * 2 + 1]);
            if (name === "æ€»è®¡") {
              order.totalCount = count;
              order.totalDensity = density;
            } else {
              order.defects[name] = { name, count, density };
            }
          });
          cursor += 1 + ids.length * 2;
        }
        index = Math.max(cursor, index + 1);
      }
    }
  }

  function parseVisionPages(pages, sourceFile = "") {
    const orders = parseWorkOrders(pages);
    parseDefectSections(pages, orders);
    const days = {};
    for (const order of orders.values()) {
      const date = productionDateFor(order.startTime);
      if (!date || !Number.isFinite(order.totalCount)) continue;
      const day = days[date] ||= {
        sourceFile, importedAt: new Date().toISOString(), workOrderCount: 0,
        totalDefects: 0, overallDensity: null, topDefects: [], defects: [], workOrders: []
      };
      day.workOrderCount += 1;
      day.totalDefects += order.totalCount;
      day.workOrders.push(order);
    }
    for (const day of Object.values(days)) {
      const totals = new Map();
      let area = 0;
      for (const order of day.workOrders) {
        area += order.widthCm / 100 * order.lengthM;
        for (const defect of Object.values(order.defects)) {
          const current = totals.get(defect.name) || { name: defect.name, count: 0, density: 0 };
          current.count += defect.count;
          totals.set(defect.name, current);
        }
      }
      day.overallDensity = area > 0 ? day.totalDefects / area : null;
      day.defects = [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      day.topDefects = day.defects.slice(0, 3);
    }
    return days;
  }

  function trimThicknessHistory(map = {}, limit = 7) {
    return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-limit));
  }

  function mergeDashboardSources(current, patch = {}) {
    const next = clone(current);
    if (patch.production) {
      next.dailyRecords = clone(patch.production.dailyRecords || []);
      next.selectedDate = patch.production.selectedDate || next.selectedDate;
    }
    next.qualityByDate = { ...(next.qualityByDate || {}), ...(clone(patch.qualityByDate) || {}) };
    next.thicknessByDate = trimThicknessHistory({ ...(next.thicknessByDate || {}), ...(clone(patch.thicknessByDate) || {}) });
    if (patch.selectedDate) next.selectedDate = patch.selectedDate;
    return next;
  }

  return { productionDateFor, detectDateFromFilename, parseVisionPages, trimThicknessHistory, mergeDashboardSources };
});
