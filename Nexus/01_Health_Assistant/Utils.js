// ════════════════════════════════════════════════════════════
//  utils.gs  —  通用工具函数，不含任何业务逻辑
// ════════════════════════════════════════════════════════════

// ── #1 日志 / 追踪 ──────────────────────────────────────────────
// 【开关】true 表示开启日志打印；如果项目上线了不想被日志拖慢运行速度，改成 false，所有的 log 就会瞬间安静。
const DEBUG_LOG = true;

function newTraceId_() {
  // 生成一个当前时间的字符串（比如 "20231024_153022_123"）作为追踪用的流水号
  return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyyMMdd_HHmmss_SSS");
}

function log_(traceId, msg, obj) {
  // 如果开关关了，直接退出，不打日志
  if (!DEBUG_LOG) return; 
  // 拼接日志前缀，带上流水号
  let line = `[TRACE ${traceId}] ${msg}`; 
  // 如果传了对象（比如数组或JSON），尝试把它转成字符串拼在后面
  if (obj !== undefined) {
    try { line += ` | ${JSON.stringify(obj)}`; }
    catch (e) { line += ` | ${String(obj)}`; }
  }
  Logger.log(line); // 真正执行打印
}

function shortText_(v, maxLen) {
  // 把内容转成字符串。如果太长了，就切断并在末尾加上 "...(truncated)"，防止日志爆炸
  const s = String(v == null ? "" : v);
  return s.length > maxLen ? s.slice(0, maxLen) + "...(truncated)" : s;
}

// ── #2 日期 ────────────────────────────────────────────────────

function ymd(d) {
  // 将 Date 对象格式化为 "年-月-日" 字符串（如 "2023-10-24"）
  return Utilities.formatDate(d, CONFIG.TZ, "yyyy-MM-dd");
}

function getYesterdayInTz() {
  // 获取配置时区下的"昨天"的 Date 对象
  return addDays(getTodayInTz(), -1);
}

function getTodayInTz() {
  // 获取配置时区下的“今天”的 Date 对象（剔除了时分秒）
  const now = new Date();
  const ymdText = ymd(now); // 直接调用已经封装好的 ymd() 函数，清爽多了！
  const [y, m, d] = ymdText.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  // 在给定日期的基础上，加上或减去 n 天
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function parseDateSafe(s, fallbackDate) {
  // 终极日期解析器：尝试用各种正则表达式去匹配常见的日期格式（带杠的、带斜杠的、带时分秒的等）
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

function parseYmdToDate_(dateStr) {
  // 把 "yyyy-MM-dd" 字符串解析为本地时区当日零点的 Date 对象
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`parseYmdToDate_ 非法日期字符串: ${dateStr}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// ── 型変換 ──────────────────────────────────────────────────

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

// 统一处理目标 xlsx 的临时表管道：复制 -> 打开 -> 执行业务写入 -> flush -> 导出回写 -> 清理临时表
function runTargetXlsxPipeline_(tempName, applyFn) {
  // 1. 复制目标 xlsx 为临时 Google Sheet，后续所有写入都在临时表上完成
  const tempSSId = driveCopyAsGoogleSheet(CONFIG.TARGET.xlsxFileId, tempName);

  try {
    // 2. 打开临时表，并把业务写入逻辑交给调用方
    const tempSS = openSpreadsheetWithRetry(
      tempSSId,
      CONFIG.TARGET.openRetryTimes,
      CONFIG.TARGET.openRetrySleepMs
    );

    const result = applyFn(tempSS, tempSSId);

    // 3. 默认提交改动；如果业务层明确返回 skipCommit，则只执行写入逻辑，不覆盖原文件
    if (!(result && result.skipCommit)) {
      SpreadsheetApp.flush();

      const blob = exportSpreadsheetAsXlsx(
        tempSSId,
        getXlsxFileName(CONFIG.TARGET.xlsxFileId)
      );
      driveUpdateBinary(CONFIG.TARGET.xlsxFileId, blob);
      syncTempSSToGoogleSheet(tempSSId);
    }

    return result;
  } finally {
    // 4. 无论成功失败都清理临时表，避免 Drive 堆积垃圾文件
    DriveApp.getFileById(tempSSId).setTrashed(true);
  }
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

// ── Summary 列头校验 ────────────────────────────────────────

function assertSummaryCols_(colMap, requiredKeys, moduleName) {
  const missing = requiredKeys.filter(k => !colOf_(colMap, k));
  if (missing.length > 0) {
    throw new Error(`${moduleName}: 总结页找不到列标题: ${missing.join(", ")}`);
  }
}
