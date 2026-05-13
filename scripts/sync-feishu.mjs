import { writeFile } from "node:fs/promises";

const config = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  spreadsheetToken: process.env.FEISHU_SPREADSHEET_TOKEN || "JkdYsFb6KhX1MXtwSlAcYbMOnfd",
  totalSheetId: process.env.FEISHU_TOTAL_SHEET_ID || "31FeWT",
  totalSheetTitle: process.env.FEISHU_TOTAL_SHEET_TITLE || "总产量",
  totalRange: process.env.FEISHU_TOTAL_RANGE,
  downtimeSheetId: process.env.FEISHU_DOWNTIME_SHEET_ID || "",
  downtimeSheetTitle: process.env.FEISHU_DOWNTIME_SHEET_TITLE || "每小时产量",
  downtimeRange: process.env.FEISHU_DOWNTIME_RANGE,
  month: process.env.DASHBOARD_MONTH || currentMonth(),
  outputFile: process.env.DASHBOARD_DATA_FILE || "dashboard-data.json",
  dailyTarget: numberFrom(process.env.DAILY_TARGET_T, 46),
  dayTarget: numberFrom(process.env.DAY_SHIFT_TARGET_T, 23),
  nightTarget: numberFrom(process.env.NIGHT_SHIFT_TARGET_T, 23),
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
  material: "",
  traction: "张力稳定 / Stable Tension"
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!config.appId || !config.appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET.");
  }

  const token = await getTenantAccessToken();
  const sheets = await querySheets(token).catch(() => []);
  const totalSheetId = config.totalSheetId || findSheetId(sheets, config.totalSheetTitle);
  if (!totalSheetId) throw new Error("Missing total sheet id. Set FEISHU_TOTAL_SHEET_ID.");

  const totalRange = config.totalRange || `${totalSheetId}!A1:AB130`;
  const totalValues = await readSheetValues(token, totalRange);
  const records = parseTotalProduction(totalValues);

  const downtimeSheetId = config.downtimeSheetId || findSheetId(sheets, config.downtimeSheetTitle);
  if (downtimeSheetId || config.downtimeRange) {
    const downtimeRange = config.downtimeRange || `${downtimeSheetId}!A1:I90`;
    const downtimeValues = await readSheetValues(token, downtimeRange);
    mergeDowntime(records, downtimeValues);
  }

  const dailyRecords = [...records.values()]
    .filter((record) => rollStats(record).totalKg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const payload = {
    source: "飞书同步 / Feishu Sync",
    syncedAt: new Date().toISOString(),
    selectedDate: process.env.DASHBOARD_SELECTED_DATE || dailyRecords.at(-1)?.date || `${config.month}-01`,
    dailyRecords
  };

  await writeFile(config.outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Synced ${dailyRecords.length} daily records to ${config.outputFile}`);
}

async function querySheets(token) {
  const url = `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${config.spreadsheetToken}/sheets/query`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Feishu sheet query failed: ${JSON.stringify(json)}`);
  }
  return json.data?.sheets || [];
}

async function getTenantAccessToken() {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Feishu token request failed: ${JSON.stringify(json)}`);
  }
  return json.tenant_access_token;
}

async function readSheetValues(token, range) {
  const encodedRange = encodeURIComponent(range);
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${config.spreadsheetToken}/values/${encodedRange}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Feishu sheet read failed for ${range}: ${JSON.stringify(json)}`);
  }
  return json.data?.valueRange?.values || [];
}

function parseTotalProduction(values) {
  const records = new Map();
  if (!values.length) return records;

  const header = values[0].map((cell) => String(cell || "").trim());
  const columns = {
    date: findColumn(header, ["Date", "日期"]),
    shift: findColumn(header, ["Shift", "班次"]),
    goodKg: findColumn(header, ["成品"]),
    badKg: findColumn(header, ["不良品"]),
    badProductKg: findColumn(header, ["不合格品Kg"]),
    goodRolls: findColumn(header, ["合格品卷材"]),
    badRolls: findColumn(header, ["不合格品卷材"]),
    outputKg: findColumn(header, ["产量"]),
    poNo: findColumn(header, ["PO No.", "PO"]),
    customer: findColumn(header, ["Customer", "客户"]),
    material: findColumn(header, ["Metal", "材料", "Material"]),
    team: findColumn(header, ["Team", "班组"])
  };

  for (const row of values.slice(1)) {
    const day = parseDay(row[columns.date]);
    const shift = parseShift(row[columns.shift]);
    if (!day || !shift) continue;

    const date = `${config.month}-${String(day).padStart(2, "0")}`;
    const record = ensureRecord(records, date);
    const goodKg = numberFrom(row[columns.goodKg], 0);
    const badKg = numberFrom(row[columns.badKg], 0) + numberFrom(row[columns.badProductKg], 0);
    const outputKg = normalizeKg(numberFrom(row[columns.outputKg], 0) || goodKg + badKg);
    const rollCount = Math.max(1, Math.round(numberFrom(row[columns.goodRolls], 0) + numberFrom(row[columns.badRolls], 0)));
    const rolls = outputKg > 0 ? distributeRolls(outputKg, rollCount) : [];

    if (shift === "day") record.dayRollsKg = rolls;
    if (shift === "night") record.nightRollsKg = rolls;

    const totalKg = rollStats(record).totalKg;
    const qualityBase = goodKg + badKg;
    if (qualityBase > 0) {
      record.goodRate = round(goodKg / qualityBase * 100, 1);
      record.scrapRate = round(badKg / qualityBase * 100, 1);
    } else if (totalKg > 0) {
      record.goodRate = config.goodTarget;
      record.scrapRate = 100 - config.goodTarget;
    }

    record.progress = clamp(totalKg / (record.targetOutput * 1000) * 100, 0, 100);
    record.orderNo = text(row[columns.poNo]) || record.orderNo;
    record.customer = text(row[columns.customer]) || record.customer;
    record.material = text(row[columns.material]) || record.material;
  }

  return records;
}

function mergeDowntime(records, values) {
  if (!values.length) return;
  const header = values[0].map((cell) => String(cell || "").trim());
  const columns = {
    date: findColumn(header, ["号", "Date", "日期"]),
    shift: findColumn(header, ["班组", "Shift"]),
    changeover: findColumn(header, ["停机换款", "Changeover"]),
    production: findColumn(header, ["生产异常", "Production"]),
    equipment: findColumn(header, ["设备异常", "Equipment"]),
    maintenance: findColumn(header, ["规划维保", "计划维保", "Maintenance"])
  };

  let lastDay = 0;
  for (const row of values.slice(1)) {
    const explicitDay = parseDay(row[columns.date]);
    if (explicitDay) lastDay = explicitDay;
    if (!lastDay || !parseShift(row[columns.shift])) continue;

    const date = `${config.month}-${String(lastDay).padStart(2, "0")}`;
    const record = ensureRecord(records, date);
    record.downtime.changeover += hoursToMinutes(row[columns.changeover]);
    record.downtime.production += hoursToMinutes(row[columns.production]);
    record.downtime.equipment += hoursToMinutes(row[columns.equipment]);
    record.downtime.maintenance += hoursToMinutes(row[columns.maintenance]);
  }
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
      }
    });
  }
  return records.get(date);
}

function findColumn(header, candidates) {
  for (const candidate of candidates) {
    const index = header.findIndex((name) => name.toLowerCase().includes(String(candidate).toLowerCase()));
    if (index >= 0) return index;
  }
  return -1;
}

function findSheetId(sheets, title) {
  if (!title) return "";
  const sheet = sheets.find((item) => String(item.title || "").trim() === title);
  return sheet?.sheet_id || "";
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

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
