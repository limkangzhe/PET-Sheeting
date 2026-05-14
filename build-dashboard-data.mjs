import { inflateRawSync } from "node:zlib";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, basename } from "node:path";

const config = {
  inputFile: process.env.DASHBOARD_SOURCE_FILE || process.argv[2] || "",
  dataDir: process.env.DASHBOARD_DATA_DIR || "data",
  outputFile: process.env.DASHBOARD_DATA_FILE || "dashboard-data.json",
  month: process.env.DASHBOARD_MONTH || "",
  totalSheetTitle: process.env.TOTAL_SHEET_TITLE || "总产量",
  downtimeSheetTitle: process.env.DOWNTIME_SHEET_TITLE || "每小时产量",
  dailyTarget: numberFrom(process.env.DAILY_TARGET_T, 28),
  dayTarget: numberFrom(process.env.DAY_SHIFT_TARGET_T, 14),
  nightTarget: numberFrom(process.env.NIGHT_SHIFT_TARGET_T, 14),
  lineSpeed: numberFrom(process.env.DEFAULT_LINE_SPEED, 1400),
  speedSet: numberFrom(process.env.DEFAULT_SET_SPEED, 1500),
  goodTarget: numberFrom(process.env.DEFAULT_GOOD_TARGET, 88),
  scrapLimit: numberFrom(process.env.DEFAULT_SCRAP_LIMIT, 3)
};

const defaults = {
  lineName: "PET-A01 主线 / PET-A01 Main Line",
  runState: "RUN",
  batchStatus: "批次进行中 / Batch Running",
  spec: "透明片材 / Clear Sheet",
  thickness: "0.80 mm",
  width: "820 mm",
  customer: "",
  material: "15%新料 / 85%回料",
  traction: "张力稳定 / Stable Tension"
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const sourceFile = config.inputFile || await findSourceFile();
  const ext = extname(sourceFile).toLowerCase();
  let totalValues = [];
  let downtimeValues = [];

  if (ext === ".xlsx") {
    const workbook = parseXlsx(await readFile(sourceFile));
    const inferredMonth = inferMonth(sourceFile, []);
    totalValues = workbook.sheets.get(config.totalSheetTitle) || firstNonEmptySheet(workbook);
    downtimeValues = workbook.sheets.get(config.downtimeSheetTitle) || [];
    const records = parseTotalProduction(totalValues, inferredMonth);
    mergeRecordMaps(records, parseDailyWorksheets(workbook, inferredMonth));
    if (downtimeValues.length) mergeDowntime(records, downtimeValues, inferredMonth);
    await writePayload(records, sourceFile);
    return;
  } else if (ext === ".csv") {
    totalValues = parseCsv(await readFile(sourceFile, "utf8"));
    const downtimeCsv = await findOptionalFile(["downtime.csv", "停机.csv"]);
    downtimeValues = downtimeCsv ? parseCsv(await readFile(downtimeCsv, "utf8")) : [];
  } else {
    throw new Error(`Unsupported source file: ${sourceFile}. Use .xlsx or .csv.`);
  }

  const records = parseTotalProduction(totalValues, inferMonth(sourceFile, totalValues));
  if (downtimeValues.length) mergeDowntime(records, downtimeValues, inferMonth(sourceFile, totalValues));
  await writePayload(records, sourceFile);
}

async function writePayload(records, sourceFile) {
  const dailyRecords = [...records.values()]
    .filter((record) => rollStats(record).totalKg >= 1000)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!dailyRecords.length) {
    throw new Error("No production records were found. Check that the file has Date, Shift and production columns.");
  }

  const payload = {
    source: `CSV/Excel 手动同步 / Manual File Sync (${basename(sourceFile)})`,
    syncedAt: new Date().toISOString(),
    selectedDate: process.env.DASHBOARD_SELECTED_DATE || dailyRecords.at(-1).date,
    dailyRecords
  };

  await writeFile(config.outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Built ${config.outputFile} from ${sourceFile}`);
  console.log(`Records: ${dailyRecords.length}, selectedDate: ${payload.selectedDate}`);
}

function mergeRecordMaps(target, source) {
  for (const [date, incoming] of source.entries()) {
    const record = ensureRecord(target, date);
    Object.assign(record, incoming, {
      dayRollsKg: incoming.dayRollsKg?.length ? incoming.dayRollsKg : record.dayRollsKg,
      nightRollsKg: incoming.nightRollsKg?.length ? incoming.nightRollsKg : record.nightRollsKg,
      downtime: {
        ...(record.downtime || {}),
        ...(incoming.downtime || {})
      },
      productionBreakdown: addBreakdown(record.productionBreakdown, incoming.productionBreakdown)
    });
  }
}

function addBreakdown(a = {}, b = {}) {
  return {
    goodKg: numberFrom(a.goodKg) + numberFrom(b.goodKg),
    rejectKg: numberFrom(a.rejectKg) + numberFrom(b.rejectKg),
    flakesKg: numberFrom(a.flakesKg) + numberFrom(b.flakesKg),
    purgingKg: numberFrom(a.purgingKg) + numberFrom(b.purgingKg),
    lossKg: numberFrom(a.lossKg) + numberFrom(b.lossKg),
    totalKg: numberFrom(a.totalKg) + numberFrom(b.totalKg)
  };
}

function applyProductionFormula(record, breakdown) {
  const totalKg = numberFrom(breakdown?.totalKg);
  const goodKg = numberFrom(breakdown?.goodKg);
  if (totalKg > 0) {
    record.goodRate = round(goodKg / totalKg * 100, 1);
    record.scrapRate = round((totalKg - goodKg) / totalKg * 100, 1);
  }
  record.productionBreakdown = {
    goodKg,
    rejectKg: numberFrom(breakdown?.rejectKg),
    flakesKg: numberFrom(breakdown?.flakesKg),
    purgingKg: numberFrom(breakdown?.purgingKg),
    lossKg: numberFrom(breakdown?.lossKg),
    totalKg
  };
}

async function findSourceFile() {
  const files = await readdir(config.dataDir, { withFileTypes: true }).catch(() => []);
  const candidates = files
    .filter((file) => file.isFile())
    .map((file) => join(config.dataDir, file.name))
    .filter((file) => [".xlsx", ".csv"].includes(extname(file).toLowerCase()))
    .filter((file) => !basename(file).toLowerCase().includes("downtime"));
  if (!candidates.length) {
    throw new Error(`No .xlsx or .csv file found in ${config.dataDir}/. Upload an exported file first.`);
  }
  return candidates.sort().at(-1);
}

async function findOptionalFile(names) {
  const files = await readdir(config.dataDir, { withFileTypes: true }).catch(() => []);
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  const match = files.find((file) => file.isFile() && lowerNames.has(file.name.toLowerCase()));
  return match ? join(config.dataDir, match.name) : "";
}

function parseTotalProduction(values, month) {
  const records = new Map();
  if (!values.length) return records;

  const headerRowIndex = values.findIndex((row) => row.some((cell) => same(cell, "Date") || same(cell, "日期")));
  if (headerRowIndex < 0) return records;

  const header = values[headerRowIndex].map((cell) => String(cell || "").trim());
  const columns = {
    date: findColumn(header, ["Date", "日期"]),
    shift: findColumn(header, ["Shift", "班次"]),
    goodKg: findColumn(header, ["成品"]),
    badKg: findColumn(header, ["不良品"]),
    flakesKg: findColumn(header, ["边料破碎", "Flakes"]),
    purgingKg: findColumn(header, ["机头料", "换网", "Purging"]),
    lossKg: findColumn(header, ["无形损耗", "Loss"]),
    badProductKg: findColumn(header, ["不合格品Kg"]),
    goodRolls: findColumn(header, ["合格品卷材"]),
    badRolls: findColumn(header, ["不合格品卷材"]),
    outputKg: findColumn(header, ["产量"]),
    poNo: findColumn(header, ["PO No.", "PO"]),
    customer: findColumn(header, ["Customer", "客户"]),
    material: findColumn(header, ["Metal", "材料", "Material"])
  };

  for (const row of values.slice(headerRowIndex + 1)) {
    const day = parseDay(row[columns.date]);
    const shift = parseShift(row[columns.shift]);
    if (!day || !shift) continue;

    const date = `${month}-${String(day).padStart(2, "0")}`;
    const record = ensureRecord(records, date);
    const goodKg = numberFrom(row[columns.goodKg], 0);
    const rejectKg = numberFrom(row[columns.badKg], 0) + numberFrom(row[columns.badProductKg], 0);
    const flakesKg = numberFrom(row[columns.flakesKg], 0);
    const purgingKg = numberFrom(row[columns.purgingKg], 0);
    const lossKg = numberFrom(row[columns.lossKg], 0);
    const componentKg = goodKg + rejectKg + flakesKg + purgingKg + lossKg;
    const outputKg = normalizeKg(componentKg || numberFrom(row[columns.outputKg], 0));
    const rollCount = Math.max(1, Math.round(numberFrom(row[columns.goodRolls], 0) + numberFrom(row[columns.badRolls], 0)));
    const rolls = outputKg > 0 ? distributeRolls(outputKg, rollCount) : [];

    if (shift === "day") record.dayRollsKg = rolls;
    if (shift === "night") record.nightRollsKg = rolls;

    if (outputKg > 0) {
      record.goodRate = round(goodKg / outputKg * 100, 1);
      record.scrapRate = round((outputKg - goodKg) / outputKg * 100, 1);
      record.productionBreakdown = {
        goodKg,
        rejectKg,
        flakesKg,
        purgingKg,
        lossKg,
        totalKg: outputKg
      };
    }

    record.progress = clamp(goodKg / (record.targetOutput * 1000) * 100, 0, 100);
    record.orderNo = text(row[columns.poNo]) || record.orderNo;
    record.customer = text(row[columns.customer]) || record.customer;
    record.material = text(row[columns.material]) || record.material;
  }

  return records;
}

function mergeDowntime(records, values, month) {
  const headerRowIndex = values.findIndex((row) => row.some((cell) => same(cell, "号") || same(cell, "日期") || same(cell, "Date")));
  if (headerRowIndex < 0) return;

  const header = values[headerRowIndex].map((cell) => String(cell || "").trim());
  const columns = {
    date: findColumn(header, ["号", "Date", "日期"]),
    shift: findColumn(header, ["班组", "Shift"]),
    changeover: findColumn(header, ["停机换款", "Changeover"]),
    production: findColumn(header, ["生产异常", "Production"]),
    equipment: findColumn(header, ["设备异常", "Equipment"]),
    maintenance: findColumn(header, ["规划维保", "计划维保", "Maintenance"])
  };

  let lastDay = 0;
  for (const row of values.slice(headerRowIndex + 1)) {
    const explicitDay = parseDay(row[columns.date]);
    if (explicitDay) lastDay = explicitDay;
    if (!lastDay || !parseShift(row[columns.shift])) continue;

    const date = `${month}-${String(lastDay).padStart(2, "0")}`;
    const record = ensureRecord(records, date);
    record.downtime.changeover += hoursToMinutes(row[columns.changeover]);
    record.downtime.production += hoursToMinutes(row[columns.production]);
    record.downtime.equipment += hoursToMinutes(row[columns.equipment]);
    record.downtime.maintenance += hoursToMinutes(row[columns.maintenance]);
  }
}

function parseDailyWorksheets(workbook, fallbackMonth) {
  const records = new Map();
  for (const [sheetName, rows] of workbook.sheets.entries()) {
    if (!/^\d{1,2}$/.test(String(sheetName).trim())) continue;
    const fallbackDay = Number(sheetName);
    const dateRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.some((cell) => includes(cell, "Date")) && row.some((cell) => includes(cell, "Shift")));

    for (const { index } of dateRows) {
      const parsed = parseDailyBlock(rows, index, fallbackMonth, fallbackDay);
      if (!parsed) continue;
      const record = ensureRecord(records, parsed.date);
      const existingBreakdown = record.productionBreakdown;
      Object.assign(record, parsed.record);
      if (parsed.shift === "day") record.dayRollsKg = parsed.rolls;
      if (parsed.shift === "night") record.nightRollsKg = parsed.rolls;
      record.downtime.changeover += parsed.downtime.changeover;
      record.downtime.production += parsed.downtime.production;
      record.downtime.equipment += parsed.downtime.equipment;
      record.downtime.maintenance += parsed.downtime.maintenance;
      record.productionBreakdown = addBreakdown(existingBreakdown, parsed.record.productionBreakdown);
    }
  }
  for (const record of records.values()) {
    record.progress = clamp(numberFrom(record.productionBreakdown?.goodKg) / (record.targetOutput * 1000) * 100, 0, 100);
    applyProductionFormula(record, record.productionBreakdown);
  }
  return records;
}

function parseDailyBlock(rows, dateRowIndex, fallbackMonth, fallbackDay) {
  const dateRow = rows[dateRowIndex] || [];
  const poRow = rows[dateRowIndex - 1] || [];
  const customerRow = rows[dateRowIndex + 1] || [];
  const shift = parseShift(valueAfterLabel(dateRow, "Shift"));
  if (!shift) return null;

  const date = dateFromCell(valueAfterLabel(dateRow, "Date"), fallbackMonth, fallbackDay);
  const outputRows = rows.slice(dateRowIndex + 3, dateRowIndex + 13);
  const statsRows = rows.slice(dateRowIndex + 17, dateRowIndex + 24);
  const goodsKg = numberAfterLabelInRows(outputRows, "Goods", 8, 13);
  const rejectKg = numberAfterLabelInRows(outputRows, "Reject", 8, 13);
  const flakesKg = numberAfterLabelInRows(outputRows, "Flakes", 8, 13);
  const purgingKg = numberAfterLabelInRows(outputRows, "Purging", 8, 13);
  const lossKg = numberAfterLabelInRows(outputRows, "Loss", 8, 13);
  const goodsRolls = numberAfterLabel(customerRow, "Goods Roll");
  const rejectRolls = numberAfterLabel(customerRow, "Rej Roll");
  const rollCount = Math.max(1, Math.round(goodsRolls + rejectRolls));
  const outputKg = goodsKg + rejectKg + flakesKg + purgingKg + lossKg;
  const rolls = outputKg > 0 ? distributeRolls(outputKg, rollCount) : [];
  const lineSpeed = numberAfterLabelInRows(outputRows, "Line Speed", 14, 19) || config.lineSpeed;

  const spec = valueAfterLabel(poRow, "Type") || defaults.spec;
  const specSize = sizeFromSpec(spec);

  return {
    date,
    shift,
    rolls,
    downtime: {
      changeover: hoursToMinutes(numberAfterLabelInRows(statsRows, "Change Spec")),
      production: hoursToMinutes(numberAfterLabelInRows(statsRows, "Production Abnormal")),
      equipment: hoursToMinutes(numberAfterLabelInRows(statsRows, "Machinary abnormal") || numberAfterLabelInRows(statsRows, "Machinery abnormal")),
      maintenance: 0
    },
    record: {
      lineSpeed,
      speedSet: config.speedSet,
      goodRate: outputKg ? round(goodsKg / outputKg * 100, 1) : config.goodTarget,
      scrapRate: outputKg ? round((outputKg - goodsKg) / outputKg * 100, 1) : 100 - config.goodTarget,
      progress: clamp(goodsKg / (config.dailyTarget * 1000) * 100, 0, 100),
      orderNo: valueAfterLabel(poRow, "PO No") || "",
      spec,
      thickness: specSize.thickness || defaults.thickness,
      width: specSize.width || defaults.width,
      customer: valueAfterLabel(customerRow, "Customer") || defaults.customer,
      material: defaults.material,
      traction: defaults.traction,
      productionBreakdown: {
        goodKg: goodsKg,
        rejectKg,
        flakesKg,
        purgingKg,
        lossKg,
        totalKg: outputKg
      }
    }
  };
}

function parseXlsx(buffer) {
  const zip = readZip(buffer);
  const sharedStrings = parseSharedStrings(textEntry(zip, "xl/sharedStrings.xml"));
  const workbookXml = textEntry(zip, "xl/workbook.xml");
  const relsXml = textEntry(zip, "xl/_rels/workbook.xml.rels");
  const rels = parseRelationships(relsXml);
  const sheets = new Map();

  for (const sheet of parseWorkbookSheets(workbookXml)) {
    const target = rels.get(sheet.rId);
    if (!target) continue;
    const sheetPath = `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`;
    const rows = parseWorksheet(textEntry(zip, sheetPath), sharedStrings);
    sheets.set(sheet.name, rows);
  }

  return { sheets };
}

function readZip(buffer) {
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("Invalid XLSX file: ZIP central directory not found.");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) throw new Error("Invalid XLSX file: bad ZIP central directory entry.");

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.slice(dataStart, dataEnd);
    let data;

    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);

    if (uncompressedSize && data.length !== uncompressedSize) {
      data = Buffer.from(data);
    }
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function textEntry(zip, name) {
  const entry = zip.get(name);
  return entry ? entry.toString("utf8") : "";
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    return [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("");
  });
}

function parseRelationships(xml) {
  const rels = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = attrsOf(match[1]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }
  return rels;
}

function parseWorkbookSheets(xml) {
  return [...xml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => {
    const attrs = attrsOf(match[1]);
    return { name: attrs.name, rId: attrs["r:id"] };
  }).filter((sheet) => sheet.name && sheet.rId);
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = attrsOf(rowMatch[1]);
    const rowIndex = numberFrom(rowAttrs.r, rows.length + 1) - 1;
    rows[rowIndex] ||= [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = attrsOf(cellMatch[1]);
      const colIndex = colIndexFromRef(attrs.r);
      rows[rowIndex][colIndex] = cellValue(cellMatch[2], attrs.t, sharedStrings);
    }
  }
  return rows.map((row) => row || []);
}

function cellValue(xml, type, sharedStrings) {
  if (type === "inlineStr") {
    const text = [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
    return text;
  }
  const valueMatch = xml.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";
  const value = decodeXml(valueMatch[1]);
  if (type === "s") return sharedStrings[Number(value)] || "";
  return value;
}

function parseCsv(textValue) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    const next = textValue[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

function attrsOf(textValue) {
  const attrs = {};
  for (const match of textValue.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstNonEmptySheet(workbook) {
  for (const rows of workbook.sheets.values()) {
    if (rows.some((row) => row.some((cell) => String(cell).trim()))) return rows;
  }
  return [];
}

function inferMonth(sourceFile, values) {
  if (config.month) return config.month;
  const fromName = basename(sourceFile).match(/(20\d{2})[-_ ]?(\d{1,2})|([A-Za-z]+)\s+(20\d{2})/);
  if (fromName?.[1]) return `${fromName[1]}-${String(fromName[2]).padStart(2, "0")}`;
  if (fromName?.[3]) return `${fromName[4]}-${String(monthNameToNumber(fromName[3])).padStart(2, "0")}`;
  const year = new Date().getFullYear();
  return `${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
}

function monthNameToNumber(name) {
  const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = names.findIndex((item) => name.toLowerCase().startsWith(item));
  return index >= 0 ? index + 1 : new Date().getMonth() + 1;
}

function ensureRecord(records, date) {
  if (!records.has(date)) {
    records.set(date, {
      date,
      dayRollsKg: [],
      nightRollsKg: [],
      targetOutput: config.dailyTarget,
      lineSpeed: config.lineSpeed,
      speedSet: config.speedSet,
      goodRate: config.goodTarget,
      goodTarget: config.goodTarget,
      scrapRate: 100 - config.goodTarget,
      scrapLimit: config.scrapLimit,
      progress: 0,
      dayTarget: config.dayTarget,
      nightTarget: config.nightTarget,
      lineName: defaults.lineName,
      runState: defaults.runState,
      batchStatus: defaults.batchStatus,
      spec: defaults.spec,
      thickness: defaults.thickness,
      width: defaults.width,
      orderNo: `PO-${date.replaceAll("-", "").slice(2)}-001`,
      customer: defaults.customer,
      material: defaults.material,
      traction: defaults.traction,
      downtime: {
        changeover: 0,
        production: 0,
        equipment: 0,
        maintenance: 0
      },
      productionBreakdown: {
        goodKg: 0,
        rejectKg: 0,
        flakesKg: 0,
        purgingKg: 0,
        lossKg: 0,
        totalKg: 0
      }
    });
  }
  return records.get(date);
}

function findColumn(header, candidates) {
  for (const candidate of candidates) {
    const index = header.findIndex((name) => String(name).toLowerCase().includes(String(candidate).toLowerCase()));
    if (index >= 0) return index;
  }
  return -1;
}

function colIndexFromRef(ref) {
  const letters = String(ref || "A").match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  let number = 0;
  for (const char of letters) number = number * 26 + char.charCodeAt(0) - 64;
  return number - 1;
}

function parseDay(value) {
  const match = String(value ?? "").match(/\d{1,2}/);
  if (!match) return 0;
  const day = Number(match[0]);
  return day >= 1 && day <= 31 ? day : 0;
}

function parseShift(value) {
  const raw = String(value ?? "").toLowerCase();
  if (/morning|白班|早班|\bd\b|day/.test(raw)) return "day";
  if (/night|晚班|\bn\b/.test(raw)) return "night";
  return "";
}

function includes(value, expected) {
  return String(value || "").toLowerCase().includes(String(expected).toLowerCase());
}

function sizeFromSpec(spec) {
  const matches = [...String(spec || "").matchAll(/(\d+(?:\.\d+)?)\s*mm\s*[*x×]\s*(\d+(?:\.\d+)?)\s*mm/gi)];
  const widths = [];
  const thicknesses = [];
  for (const match of matches) {
    const width = normalizeDimension(match[1], "width");
    const thickness = normalizeDimension(match[2], "thickness");
    if (width && !widths.includes(width)) widths.push(width);
    if (thickness && !thicknesses.includes(thickness)) thicknesses.push(thickness);
  }
  return {
    width: widths.length ? `${widths.join(" / ")} mm` : "",
    thickness: thicknesses.length ? `${thicknesses.join(" / ")} mm` : ""
  };
}

function normalizeDimension(value, type) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (type === "thickness" && !raw.includes(".") && raw.length >= 3) {
    return trimZeros(Number(raw) / 1000);
  }
  return trimZeros(Number(raw));
}

function trimZeros(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(3)));
}

function valueAfterLabel(row, label) {
  const index = row.findIndex((cell) => includes(cell, label));
  if (index < 0) return "";
  for (let cursor = index + 1; cursor < row.length; cursor += 1) {
    const value = text(row[cursor]);
    if (value) return value;
  }
  return "";
}

function numberAfterLabel(row, label, startIndex = 0, endIndex = Infinity) {
  const withinRange = (_cell, cellIndex) => cellIndex >= startIndex && cellIndex <= endIndex;
  const exactIndex = row.findIndex((cell, cellIndex) => withinRange(cell, cellIndex) && same(cell, label));
  const index = exactIndex >= 0
    ? exactIndex
    : row.findIndex((cell, cellIndex) => withinRange(cell, cellIndex) && includes(cell, label));
  if (index < 0) return 0;
  for (let cursor = index + 1; cursor < row.length; cursor += 1) {
    const value = numberFrom(row[cursor], NaN);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function numberAfterLabelInRows(rows, label, startIndex = 0, endIndex = Infinity) {
  for (const row of rows) {
    const value = numberAfterLabel(row || [], label, startIndex, endIndex);
    if (value) return value;
  }
  return 0;
}

function dateFromCell(value, fallbackMonth, fallbackDay) {
  if (fallbackMonth && fallbackDay) return `${fallbackMonth}-${String(fallbackDay).padStart(2, "0")}`;
  const numeric = numberFrom(value, NaN);
  if (Number.isFinite(numeric) && numeric > 30000) return excelSerialToDate(numeric);
  const textValue = text(value);
  const fullDate = textValue.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (fullDate) return `${fullDate[1]}-${String(fullDate[2]).padStart(2, "0")}-${String(fullDate[3]).padStart(2, "0")}`;
  const day = parseDay(value) || fallbackDay;
  return `${fallbackMonth}-${String(day).padStart(2, "0")}`;
}

function excelSerialToDate(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function same(value, expected) {
  return String(value || "").trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function numberFrom(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return fallback;
  const number = Number(cleaned[0]);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeKg(value) {
  if (!value) return 0;
  return value < 200 ? value * 1000 : value;
}

function distributeRolls(totalKg, count) {
  if (!totalKg || !count) return [];
  const base = Math.floor(totalKg / count);
  const rolls = Array.from({ length: count }, (_, index) => base + ((index % 5) - 2));
  let diff = Math.round(totalKg - rolls.reduce((sum, value) => sum + value, 0));
  let index = 0;
  while (diff !== 0 && rolls.length) {
    const step = diff > 0 ? 1 : -1;
    rolls[index % rolls.length] += step;
    diff -= step;
    index += 1;
  }
  return rolls.map((value) => Math.max(1, value));
}

function rollStats(record) {
  const dayKg = (record.dayRollsKg || []).reduce((sum, value) => sum + numberFrom(value), 0);
  const nightKg = (record.nightRollsKg || []).reduce((sum, value) => sum + numberFrom(value), 0);
  return { totalKg: dayKg + nightKg };
}

function hoursToMinutes(value) {
  const number = numberFrom(value, 0);
  if (!number) return 0;
  return Math.round(number * 60);
}

function text(value) {
  return String(value ?? "").trim();
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
