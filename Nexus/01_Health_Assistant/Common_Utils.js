// ════════════════════════════════════════════════════════════
//  utils.gs  —  通用工具函数，不含任何业务逻辑
// ════════════════════════════════════════════════════════════

// ── 日志 / 追踪 ──────────────────────────────────────────────

const DEBUG_LOG = true;

function newTraceId_() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyyMMdd_HHmmss_SSS");
}

function log_(traceId, msg, obj) {
  if (!DEBUG_LOG) return;
  let line = `[TRACE ${traceId}] ${msg}`;
  if (obj !== undefined) {
    try { line += ` | ${JSON.stringify(obj)}`; }
    catch (e) { line += ` | ${String(obj)}`; }
  }
  Logger.log(line);
}

function shortText_(v, maxLen) {
  const s = String(v == null ? "" : v);
  return s.length > maxLen ? s.slice(0, maxLen) + "...(truncated)" : s;
}

// ── 日期 ────────────────────────────────────────────────────

function ymd(d) {
  return Utilities.formatDate(d, CONFIG.TZ, "yyyy-MM-dd");
}

function getYesterdayInTz() {
  const now = new Date();
  const ymdText = Utilities.formatDate(now, CONFIG.TZ, "yyyy-MM-dd");
  const [y, m, d] = ymdText.split("-").map(Number);
  return new Date(y, m - 1, d - 1);
}

function getTodayInTz() {
  const now = new Date();
  const ymdText = Utilities.formatDate(now, CONFIG.TZ, "yyyy-MM-dd");
  const [y, m, d] = ymdText.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dateKeyToDate(key) {
  const k = normalizeDateCellToKey_(key, CONFIG.TZ);
  const m = String(k || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`非法 dateKey: ${key}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseDatetimeWithAt(cell) {
  if (!cell) return null;
  if (cell instanceof Date) return cell;
  const s = String(cell).trim();
  if (!s) return null;
  const dt = new Date(s.replace(/\s+at\s+/i, " "));
  return isNaN(dt.getTime()) ? null : dt;
}

function parseDateSafe(s, fallbackDate) {
  const str = String(s).trim();
  if (/\d{4}/.test(str) || str.indexOf("T") >= 0) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }
  let m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0);
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Number(m[3]), Number(m[1])-1, Number(m[2]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0);
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(fallbackDate.getFullYear(), Number(m[1])-1, Number(m[2]), Number(m[3]), Number(m[4]), m[5] ? Number(m[5]) : 0);
  return null;
}

// ── 型変換 ──────────────────────────────────────────────────

function toKey(v) {
  if (v instanceof Date) return ymd(v);
  if (typeof v === "string") {
    const s = v.trim();
    const m = s.match(/令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
    if (m) {
      const year = 2018 + Number(m[1]);
      return `${year}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[3])).padStart(2,"0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return "";
}

function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function toNullableInt_(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : null;
}

function toIntOrDefault_(v, def) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : def;
}

function normalizeNumber(raw, digits) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const m = s.match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length === 0) return "";
  const n = Number(m[m.length - 1]);
  return isFinite(n) ? n.toFixed(digits) : "";
}

function normalizeSleepType(type) {
  const s = String(type).toLowerCase();
  if (s.indexOf("core") >= 0) return "CORE";
  if (s.indexOf("deep") >= 0) return "DEEP";
  if (s.indexOf("rem")  >= 0) return "REM";
  if (s.indexOf("in bed") >= 0 || s.indexOf("inbed") >= 0) return "INBED";
  return "OTHER";
}

function toDurationDayFraction(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) {
    return (v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds()) / 86400;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return (parseInt(m[1],10)*3600 + parseInt(m[2],10)*60 + (m[3] ? parseInt(m[3],10) : 0)) / 86400;
  }
  return v;
}

function toDateTimeSerialInTz(v, tz, fallbackYmd) {
  if (v == null || v === "") return null;
  let ymdText, hmsText;
  if (v instanceof Date) {
    ymdText = Utilities.formatDate(v, tz, "yyyy-MM-dd");
    hmsText = Utilities.formatDate(v, tz, "HH:mm:ss");
  } else {
    const s = String(v).trim();
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m1) {
      const yy = fallbackYmd ? fallbackYmd.slice(0,4) : String(new Date().getFullYear());
      ymdText = `${yy}-${String(parseInt(m1[1],10)).padStart(2,"0")}-${String(parseInt(m1[2],10)).padStart(2,"0")}`;
      hmsText = `${String(parseInt(m1[3],10)).padStart(2,"0")}:${String(parseInt(m1[4],10)).padStart(2,"0")}:${String(m1[5] ? parseInt(m1[5],10) : 0).padStart(2,"0")}`;
    } else {
      const dt = new Date(s.replace(/\s+at\s+/i, " "));
      if (isNaN(dt.getTime())) return null;
      ymdText = Utilities.formatDate(dt, tz, "yyyy-MM-dd");
      hmsText = Utilities.formatDate(dt, tz, "HH:mm:ss");
    }
  }
  const ym = ymdText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const hm = hmsText.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!ym || !hm) return null;
  const base = Date.UTC(1899, 11, 30);
  const day0 = Date.UTC(parseInt(ym[1],10), parseInt(ym[2],10)-1, parseInt(ym[3],10));
  const days = (day0 - base) / 86400000;
  const frac = (parseInt(hm[1],10)*3600 + parseInt(hm[2],10)*60 + parseInt(hm[3],10)) / 86400;
  return days + frac;
}

// ── 日付文字列正規化 ─────────────────────────────────────────

// 唯一の日付キー正規化関数（全ファイルから参照）
function normalizeDateCellToKey_(v, tz) {
  const timezone = tz || CONFIG.TZ;
  if (v == null || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, timezone, "yyyy-MM-dd");
  }
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, timezone, "yyyy-MM-dd");
}

function normalizeDateKey(raw) {
  return normalizeDateCellToKey_(raw, CONFIG.TZ);
}

function normalizeDateTextToKey_(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[3])).padStart(2,"0")}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[3])).padStart(2,"0")}`;
  return "";
}

// ── 文字列ヘルパー ───────────────────────────────────────────

function nzText_(v)          { return (v == null) ? "" : String(v); }
function nzIntText_(v, def)  {
  if (v === "" || v == null) return String(def);
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n)) : String(def);
}

function normalizeHmText_(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${("0"+Number(m[1])).slice(-2)}:${m[2]}` : s;
}

function formatHm_(dt, tz) {
  if (!dt) return "";
  const d = (dt instanceof Date) ? dt : new Date(dt);
  return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, tz, "HH:mm");
}

// ── Sheet ───────────────────────────────────────────────────

// headerは全てlowercaseに正規化して格納 → 呼び出し側もlowercaseで参照
function getColMapFromHeader(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").trim().toLowerCase();
    if (h) map[h] = i + 1;
  }
  return map;
}

function colOf_(colMap, key) {
  return colMap[key.toLowerCase()];
}

function findRowByDate(sheet, targetStr, tz) {
  const maxRows = Math.min(sheet.getLastRow(), 600);
  if (maxRows <= 1) return null;
  const values = sheet.getRange(1, 1, maxRows, 3).getValues();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = values[r][c];
      if (!cell) continue;
      if (cell instanceof Date) {
        if (Utilities.formatDate(cell, tz, "yyyy-MM-dd") === targetStr) return r + 1;
      } else {
        const s = String(cell).trim();
        if (s === targetStr) return r + 1;
        const dt = new Date(s);
        if (!isNaN(dt.getTime()) && Utilities.formatDate(dt, tz, "yyyy-MM-dd") === targetStr) return r + 1;
      }
    }
  }
  return null;
}

function getSheetOrFirst(ss, name, tag) {
  let sheet = name ? ss.getSheetByName(name) : null;
  if (!sheet) sheet = ss.getSheets()[0];
  Logger.log(`ℹ️ [${tag}] 使用工作表: ${sheet.getName()}`);
  return sheet;
}

function getSheetStrict(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (sheet) return sheet;
  const names = ss.getSheets().map(s => s.getName()).join(", ");
  throw new Error(`目标工作表 "${sheetName}" 不存在。当前工作表: ${names}`);
}

function openSpreadsheetWithRetry(spreadsheetId, retryTimes, sleepMs) {
  let lastErr;
  for (let i = 0; i < retryTimes; i++) {
    try { return SpreadsheetApp.openById(spreadsheetId); }
    catch (e) { lastErr = e; Utilities.sleep(sleepMs); }
  }
  throw lastErr;
}

function findOrInsertRowByKey_(sheet, rowKey, keyCol, dataStartRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow < dataStartRow) {
    sheet.insertRowsAfter(dataStartRow - 1, 1);
    return { row: dataStartRow, inserted: true };
  }
  const numRows = lastRow - dataStartRow + 1;
  const keys = sheet.getRange(dataStartRow, keyCol, numRows, 1).getDisplayValues()
    .map(r => String(r[0] || "").trim());
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === rowKey) return { row: dataStartRow + i, inserted: false };
  }
  let insertRow = lastRow + 1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] && keys[i] > rowKey) { insertRow = dataStartRow + i; break; }
  }
  if (insertRow <= lastRow) sheet.insertRowBefore(insertRow);
  else { sheet.insertRowAfter(lastRow); insertRow = lastRow + 1; }
  return { row: insertRow, inserted: true };
}

function findSummaryRowByDate_(summarySheet, dateKey, colMap, tz) {
  const target       = normalizeDateCellToKey_(dateKey, tz);
  if (!target) return 0;
  const dataStartRow = 3;
  const lastRow      = summarySheet.getLastRow();
  if (lastRow < dataStartRow) return 0;
  const dateCol = colOf_(colMap, CONFIG.SUMMARY_COLS.date) || 2;
  const vals    = summarySheet.getRange(dataStartRow, dateCol, lastRow - dataStartRow + 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (normalizeDateCellToKey_(vals[i][0], tz) === target) return dataStartRow + i;
  }
  return 0;
}

// ── Drive ───────────────────────────────────────────────────

function driveCopyAsGoogleSheet(fileId, newName) {
  const copied = Drive.Files.copy(
    { title: newName, mimeType: MimeType.GOOGLE_SHEETS },
    fileId,
    { supportsAllDrives: true }
  );
  if (!copied || !copied.id) throw new Error("Drive.Files.copy 返回无 id");
  return copied.id;
}

function exportSpreadsheetAsXlsx(spreadsheetId, fileName) {
  const safeName = /\.xlsx$/i.test(fileName) ? fileName : `${fileName}.xlsx`;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300)
    throw new Error(`导出 xlsx 失败: HTTP ${code}, body=${resp.getContentText()}`);
  return resp.getBlob().setName(safeName);
}

function driveUpdateBinary(fileId, blob) {
  const origName = getXlsxFileName(fileId);
  Drive.Files.update(
    { title: origName },
    fileId,
    blob.setName(origName),
    { supportsAllDrives: true }
  );
}

function getXlsxFileName(fileId) {
  const name = DriveApp.getFileById(fileId).getName();
  return /\.xlsx$/i.test(name) ? name : `${name}.xlsx`;
}

// ── HTTP ────────────────────────────────────────────────────

function textResponse(s) {
  return ContentService.createTextOutput(String(s))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── 调试 ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
//  utils_sync.gs  —  临时表覆盖目标 Google Sheet
// ════════════════════════════════════════════════════════════

function syncTempSSToGoogleSheet(tempSSId) {
  const targetSSId = CONFIG.TARGET.googleSheetId;
  const tempSS     = SpreadsheetApp.openById(tempSSId);
  const targetSS   = SpreadsheetApp.openById(targetSSId);

  // ── 目标 SS 的现有 sheet 全部删除（至少保留一个）────────────
  const targetSheets = targetSS.getSheets();
  const tempSheets   = tempSS.getSheets();

  // 先把临时表所有 sheet copy 到目标 SS
  const copiedSheets = tempSheets.map(sh => sh.copyTo(targetSS));

  // 删掉目标 SS 原有的 sheet
  targetSheets.forEach(sh => targetSS.deleteSheet(sh));

  // 把 copy 过来的 sheet 重命名成原来的名字
  copiedSheets.forEach((sh, i) => sh.setName(tempSheets[i].getName()));

  SpreadsheetApp.flush();
  Logger.log(`✅ Google Sheet 同步完成 → ${targetSSId}`);
}