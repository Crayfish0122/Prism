// ============================================================
// 工具函数
// ============================================================
function normalizeSheetDate(value, targetYear) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !isNaN(value)) {
    var y = value.getFullYear();
    var m = zeroPad(value.getMonth() + 1);
    var d = zeroPad(value.getDate());
    return y + "/" + m + "/" + d;
  }
  var s = String(value).trim();
  var full = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (full) return full[1] + "/" + zeroPad(full[2]) + "/" + zeroPad(full[3]);
  var short = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) {
    var yr = targetYear;
    return yr + "/" + zeroPad(short[1]) + "/" + zeroPad(short[2]);
  }
  return s;
}

function emptyIntakeSummary(date) {
  return { ok: true, date: date, row_count: 0, today_kcal_total: 0, today_carb_total: 0, today_protein_total: 0, today_fat_total: 0 };
}

function round1(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n * 10) / 10;
}

function toFloat(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function toInt(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function zeroPad(n) {
  return String(parseInt(n, 10)).padStart(2, "0");
}

function safeTrim(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function truncateText(s, maxLen) {
  var text = safeTrim(s);
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function formatNowTokyo() {
  return Utilities.formatDate(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}
