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
  const visionHeaderAliases = {
    defectType: ["\u7f3a\u9677\u79cd\u7c7b", "\u00e7\u00bc\u00ba\u00e9\u2122\u00b7\u00e7\u00a7\u008d\u00e7\u00b1\u00bb"],
    defectQuantity: ["\u7f3a\u9677\u6570\u91cf", "\u00e7\u00bc\u00ba\u00e9\u2122\u00b7\u00e6\u2022\u00b0\u00e9\u2021\u008f"],
    density: ["\u5bc6\u5ea6", "\u00e5\u00af\u2020\u00e5\u00ba\u00a6"],
    total: ["\u603b\u8ba1", "\u00e6\u20ac\u00bb\u00e8\u00ae\u00a1"]
  };
  const isVisionHeader = (value, header) => visionHeaderAliases[header].includes(value);

  function parseTimestamp(value) {
    const match = clean(value).match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second = "0"] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 ||
        date.getDate() !== Number(day) || date.getHours() !== Number(hour) ||
        date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) return null;
    return date;
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
        if (!isVisionHeader(tokens[index], "defectType")) { index += 1; continue; }
        let cursor = index + 1;
        const ids = [];
        while (isOrderId(tokens[cursor]) && isVisionHeader(tokens[cursor + 1], "defectQuantity") && isVisionHeader(tokens[cursor + 2], "density")) {
          ids.push(tokens[cursor]);
          cursor += 3;
        }
        if (!ids.length) { index += 1; continue; }
        while (cursor < tokens.length && !isVisionHeader(tokens[cursor], "defectType")) {
          const name = tokens[cursor];
          const values = tokens.slice(cursor + 1, cursor + 1 + ids.length * 2);
          if (values.length !== ids.length * 2 || !values.every(isNumber)) { cursor += 1; continue; }
          ids.forEach((id, orderIndex) => {
            const order = orders.get(id);
            if (!order) return;
            const count = Number(values[orderIndex * 2]);
            const density = Number(values[orderIndex * 2 + 1]);
            if (isVisionHeader(name, "total")) {
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
      day.defects.forEach((defect) => {
        defect.density = area > 0 ? defect.count / area : null;
      });
      day.topDefects = day.defects.slice(0, 3);
    }
    return days;
  }

  function trimThicknessHistory(map = {}, limit = 7) {
    return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-limit));
  }

  function createPanelSizePersistence(storage, key, version) {
    const observedSizes = new WeakMap();

    function load() {
      try {
        const saved = JSON.parse(storage.getItem(key));
        return saved && saved.version === version && saved.panels && typeof saved.panels === "object" ? saved.panels : {};
      } catch {
        return {};
      }
    }

    function save(measurements) {
      const panels = {};
      measurements.forEach(({ id, width, height, slot }) => {
        if (!id || !Number.isFinite(width) || !Number.isFinite(height) || !slot || !Number.isFinite(slot.width) || !Number.isFinite(slot.height) || !slot.width || !slot.height) return;
        if (width === slot.width && height === slot.height) return;
        panels[id] = {
          widthRatio: Math.min(1, Math.max(0, width / slot.width)),
          heightRatio: Math.min(1, Math.max(0, height / slot.height))
        };
      });
      storage.setItem(key, JSON.stringify({ version, panels }));
      return panels;
    }

    function restore(size, slot, minimum) {
      if (!size || !Number.isFinite(size.widthRatio) || !Number.isFinite(size.heightRatio) || !slot?.width || !slot?.height) return null;
      return {
        width: Math.min(slot.width, Math.max(Math.min(minimum.width, slot.width), slot.width * size.widthRatio)),
        height: Math.min(slot.height, Math.max(Math.min(minimum.height, slot.height), slot.height * size.heightRatio))
      };
    }

    function observe(panel, size) {
      const prior = observedSizes.get(panel);
      observedSizes.set(panel, size);
      return Boolean(prior && (prior.width !== size.width || prior.height !== size.height));
    }

    function reset(panels = []) {
      storage.removeItem(key);
      panels.forEach((panel) => {
        panel.style.removeProperty("width");
        panel.style.removeProperty("height");
      });
    }

    return { load, save, restore, observe, reset };
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

  async function extractVisionPdf(file, pdfjs) {
    if (!file || !/\.pdf$/i.test(file.name || "")) {
      throw new Error(`Unsupported vision file: ${file?.name || "unknown"}`);
    }
    if (!pdfjs?.getDocument) throw new Error("PDF parser is not loaded");
    pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    const documentTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await documentTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        tokens: content.items.map((item) => clean(item.str)).filter(Boolean)
      });
    }
    const result = parseVisionPages(pages, file.name);
    if (!Object.keys(result).length) throw new Error(`Unrecognized vision report: ${file.name}`);
    return result;
  }

  async function compressThicknessImage(file, options = {}) {
    if (!file || !/\.jpe?g$/i.test(file.name || "")) {
      throw new Error(`Thickness trend requires JPG: ${file?.name || "unknown"}`);
    }
    const maxWidth = Math.min(1600, Number(options.maxWidth) || 1600);
    const maxHeight = Math.min(1280, Number(options.maxHeight) || 1280);
    const quality = Math.min(0.72, Number(options.quality) || 0.72);
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return {
      sourceFile: file.name,
      importedAt: new Date().toISOString(),
      imageDataUrl: canvas.toDataURL("image/jpeg", quality)
    };
  }

  return {
    productionDateFor,
    detectDateFromFilename,
    parseVisionPages,
    trimThicknessHistory,
    createPanelSizePersistence,
    mergeDashboardSources,
    extractVisionPdf,
    compressThicknessImage
  };
});
