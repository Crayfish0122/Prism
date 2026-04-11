// ============================================================
// action: get_today_intake_summary
// ============================================================
function getTodayIntakeSummary(body) {
  var spreadsheetId = body.spreadsheet_id;
  var sheetName = body.sheet_name;
  var dateStr = body.date;
  if (!spreadsheetId || !sheetName || !dateStr) throw new Error("缺少必要参数: spreadsheet_id / sheet_name / date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error("date 格式错误，必须是 YYYY-MM-DD");
  var parts = dateStr.split("-");
  var targetDate = parts[0] + "/" + parts[1] + "/" + parts[2];
  var targetYear = parseInt(parts[0], 10);
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("找不到 sheet: " + sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return emptyIntakeSummary(dateStr);
  var data = sheet.getRange(2, 1, lastRow - 1, MEAL_COL.fat).getValues();
  var kcalTotal = 0, carbTotal = 0, proteinTotal = 0, fatTotal = 0, rowCount = 0;
  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowDate = normalizeSheetDate(row[0], targetYear);
    if (rowDate < targetDate) break;
    if (rowDate !== targetDate) continue;
    kcalTotal += toFloat(row[2]);
    carbTotal += toFloat(row[3]);
    proteinTotal += toFloat(row[4]);
    fatTotal += toFloat(row[5]);
    rowCount++;
  }
  return {
    ok: true,
    date: dateStr,
    row_count: rowCount,
    today_kcal_total: round1(kcalTotal),
    today_carb_total: round1(carbTotal),
    today_protein_total: round1(proteinTotal),
    today_fat_total: round1(fatTotal)
  };
}

// ============================================================
// action: get_user_vocab
// ============================================================
function getUserVocab(body) {
  var spreadsheetId = body.spreadsheet_id;
  var sheetName = body.sheet_name || "user_vocab";
  if (!spreadsheetId) throw new Error("缺少必要参数: spreadsheet_id");
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("找不到 sheet: " + sheetName);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { ok: true, count: 0, vocab: [] };
  var vocab = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0] || String(row[0]).trim() === "") continue;
    vocab.push({
      phrase: String(row[0]).trim(),
      food: String(row[1]).trim(),
      kcal: round1(row[2]),
      carb: round1(row[3]),
      protein: round1(row[4]),
      fat: round1(row[5]),
      unit: String(row[6]).trim(),
      note: String(row[7]).trim()
    });
  }
  return { ok: true, count: vocab.length, vocab: vocab };
}

// ============================================================
// action: upsert_user_vocab
// ============================================================
function upsertUserVocab(body) {
  var spreadsheetId = body.spreadsheet_id;
  var sheetName = body.sheet_name || "user_vocab";
  var entry = body.entry;
  if (!spreadsheetId || !entry || !entry.phrase) throw new Error("缺少必要参数: spreadsheet_id / entry.phrase");
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("找不到 sheet: " + sheetName);
  var phrase = String(entry.phrase).trim();
  var newRow = [phrase, entry.food || "", round1(entry.kcal), round1(entry.carb), round1(entry.protein), round1(entry.fat), entry.unit || "", entry.note || ""];
  var data = sheet.getDataRange().getValues();
  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === phrase) {
      targetRow = i + 1;
      break;
    }
  }
  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);
    return { ok: true, action: "updated", phrase: phrase, row: targetRow };
  } else {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
    return { ok: true, action: "inserted", phrase: phrase, row: lastRow + 1 };
  }
}
