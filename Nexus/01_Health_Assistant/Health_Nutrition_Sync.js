// ════════════════════════════════════════════════════════════
//  Health_Nutrition_Sync.gs  —  营养数据同步
//  純粋なツール関数は全て utils.gs に移譲済み
// ════════════════════════════════════════════════════════════

const NUTRITION_RAW_COL = {
  ROW_KEY:           1,
  DATE:              2,
  CALENDAR_EVENT_ID: 3,
  CALENDAR_SYNCED:   4,
  UPDATED_AT:        5,
};

// ── 主入口 ───────────────────────────────────────────────────

function HealthNutritionSync() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const tz        = CONFIG.TZ;
    const target    = getYesterdayInTz();
    const targetStr = ymd(target);

    Logger.log("===== 开始营养同步 =====");
    Logger.log(`执行时间(东京): ${Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss")}`);
    Logger.log(`目标日期(前一天): ${targetStr}`);

    const tempName = `_TEMP_NUTRITION_${targetStr}`;
    const tempSSId = driveCopyAsGoogleSheet(CONFIG.TARGET.xlsxFileId, tempName);

    try {
      const tempSS            = openSpreadsheetWithRetry(tempSSId, CONFIG.TARGET.openRetryTimes, CONFIG.TARGET.openRetrySleepMs);
      const srcSS             = openSpreadsheetWithRetry(CONFIG.NUTRITION_SRC.googleSheetId, CONFIG.TARGET.openRetryTimes, CONFIG.TARGET.openRetrySleepMs);
      const mealSheet         = getSheetStrict(srcSS, CONFIG.NUTRITION_SRC.mealSheetName);
      const targetSheet       = getSheetStrict(srcSS, CONFIG.NUTRITION_SRC.nutritionTargetSheetName);
      const summarySheet      = getSheetStrict(tempSS, CONFIG.TARGET.summarySheetName);
      const nutritionRawSheet = getSheetStrict(tempSS, CONFIG.TARGET.nutritionRawSheetName);

      const actual = getNutritionActual(mealSheet, targetStr);
      if (!actual) {
        Logger.log("目标日期营养没有数据，跳过");
        return;
      }
      Logger.log(`实际营养: kcal=${actual.kcal} carb=${actual.carb} protein=${actual.protein} fat=${actual.fat}`);

      const colMap     = getColMapFromHeader(summarySheet, 1);
      const isTraining = getIsTrainingDay(summarySheet, targetStr, colMap, tz);
      Logger.log(`训练日判断: ${isTraining ? "训练日" : "非训练日"}`);

      const targetNutrition = getNutritionTarget(targetSheet, targetStr, isTraining);
      Logger.log(`目标营养: kcal=${targetNutrition.kcal} carb=${targetNutrition.carb} protein=${targetNutrition.protein} fat=${targetNutrition.fat}`);

      const totalStr = formatNutritionTotal(actual);
      const deltaStr = formatNutritionDelta(actual, targetNutrition);
      Logger.log(`nutrition_total: ${totalStr}`);
      Logger.log(`nutrition_delta: ${deltaStr}`);

      writeNutritionToSummary(summarySheet, targetStr, totalStr, deltaStr, colMap, tz);

      const todayStr = ymd(getTodayInTz());
      writebackNutritionEvent_(nutritionRawSheet, summarySheet, targetStr, totalStr, deltaStr, colMap, tz);
      createNutritionShellEvent_(nutritionRawSheet, todayStr, tz);

      SpreadsheetApp.flush();

      const blob = exportSpreadsheetAsXlsx(tempSSId, getXlsxFileName(CONFIG.TARGET.xlsxFileId));
      driveUpdateBinary(CONFIG.TARGET.xlsxFileId, blob);
      syncTempSSToGoogleSheet(tempSSId);
      Logger.log("✅ 已覆盖写回原xlsx文件");
      Logger.log("===== 营养同步完成 =====");
    } finally {
      DriveApp.getFileById(tempSSId).setTrashed(true);
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── 触发器 ───────────────────────────────────────────────────

function createDailyTriggerAt3() {
  const exists = ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === "HealthNutritionSync"
  );
  if (exists) {
    Logger.log("ℹ️ 已存在 HealthNutritionSync 的触发器，不重复创建");
    return;
  }
  ScriptApp.newTrigger("HealthNutritionSync")
    .timeBased()
    .atHour(3)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CONFIG.TZ)
    .create();
  Logger.log("✅ 已创建每日触发器（JST 03:00 附近执行）");
}

// ── 营养实际值聚合 ────────────────────────────────────────────

function getNutritionActual(mealSheet, dateStr) {
  const lastRow = mealSheet.getLastRow();
  if (lastRow < 2) return null;

  const values = mealSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  let kcal = 0, carb = 0, protein = 0, fat = 0, hit = 0;

  for (const row of values) {
    const rowDate = normalizeDateKey(row[0]);
    if (rowDate !== dateStr) continue;
    kcal    += toNum(row[2]) || 0;
    carb    += toNum(row[3]) || 0;
    protein += toNum(row[4]) || 0;
    fat     += toNum(row[5]) || 0;
    hit++;
  }

  return hit ? { kcal, carb, protein, fat } : null;
}

// ── 训练日判断 ────────────────────────────────────────────────

function getIsTrainingDay(summarySheet, dateStr, colMap, tz) {
  const row = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!row) return false;
  const workoutFeedback = String(summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.workoutFeedback)).getValue() || "").trim();
  return workoutFeedback.startsWith("训练日");
}

// ── 营养目标值读取 ────────────────────────────────────────────

function getNutritionTarget(targetSheet, dateStr, isTraining) {
  const lastRow = targetSheet.getLastRow();
  if (lastRow < 2) throw new Error("nutrition_target_config 无数据");

  const values  = targetSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const type    = isTraining ? "training" : "rest";
  let best      = null;
  let bestDate  = "";

  for (const row of values) {
    const rowDate = normalizeDateKey(row[0]);
    const rowType = String(row[1] || "").trim();
    if (rowType !== type) continue;
    if (rowDate > dateStr) continue;
    if (rowDate > bestDate) {
      bestDate = rowDate;
      best     = { kcal: toNum(row[2]), carb: toNum(row[3]), protein: toNum(row[4]), fat: toNum(row[5]) };
    }
  }

  if (!best) throw new Error(`找不到 ${dateStr} 对应的营养目标 (type=${type})`);
  return best;
}

// ── フォーマット ─────────────────────────────────────────────

function formatNutritionTotal(actual) {
  return [actual.kcal, actual.carb, actual.protein, actual.fat]
    .map(v => v.toFixed(1))
    .join("|");
}

function formatNutritionDelta(actual, target) {
  return [
    actual.kcal    - target.kcal,
    actual.carb    - target.carb,
    actual.protein - target.protein,
    actual.fat     - target.fat
  ].map(v => {
    const fixed = Math.abs(v).toFixed(1);
    return v < 0 ? `(${fixed})` : fixed;
  }).join("|");
}

// ── 营养写入 ──────────────────────────────────────────────────

function writeNutritionToSummary(summarySheet, dateStr, totalStr, deltaStr, colMap, tz) {
  const row = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!row) throw new Error(`Summarize 未找到日期行: ${dateStr}`);

  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.nutritionTotal)).setValue(totalStr);
  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.nutritionDelta)).setValue(deltaStr);
  Logger.log(`✅ 营养写入 row:${row} total=${totalStr} delta=${deltaStr}`);
}

// ── 回写前一天 nutrition event ──────────────────────────────────

function writebackNutritionEvent_(nutritionRawSheet, summarySheet, dateStr, totalStr, deltaStr, colMap, tz) {
  Logger.log(`nutritionWriteback: 开始回写 ${dateStr}`);

  const cal = CalendarApp.getCalendarById(CONFIG.NUTRITION.calendarId);
  if (!cal) {
    Logger.log("nutritionWriteback: 找不到营养日历，跳过");
    return;
  }

  const rowKey = dateStr.replace(/-/g, "");
  const rawRow = findOrInsertRowByKey_(nutritionRawSheet, rowKey, NUTRITION_RAW_COL.ROW_KEY, 2);
  const oldEventId = rawRow.inserted ? "" : String(nutritionRawSheet.getRange(rawRow.row, NUTRITION_RAW_COL.CALENDAR_EVENT_ID).getValue() || "").trim();

  let event = null;
  if (oldEventId) {
    try { event = cal.getEventById(oldEventId); } catch (e) {}
  }
  if (!event) {
    event = findNutritionEventByDate_(cal, dateStr);
    if (event) {
      nutritionRawSheet.getRange(rawRow.row, NUTRITION_RAW_COL.CALENDAR_EVENT_ID).setValue(event.getId());
      Logger.log(`nutritionWriteback: ${dateStr} 从日历补回 eventId → ${event.getId()}`);
    }
  }
  if (!event) {
    Logger.log(`nutritionWriteback: ${dateStr} 无事件，跳过回写`);
    return;
  }

  const desc = event.getDescription() || "";
  const parts = desc.split(CONFIG.NUTRITION.descSeparator);
  const feedback = parts.length >= 2 ? parts[1].trim() : "";

  const newPlan = totalStr + "\n" + deltaStr;
  const newDesc = newPlan + CONFIG.NUTRITION.descSeparator + feedback;
  if (newDesc !== desc) {
    event.setDescription(newDesc);
    Logger.log(`nutritionWriteback: ${dateStr} total/delta 写入事件完成`);
  }

  if (feedback) {
    const summaryRow = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
    if (summaryRow) {
      summarySheet.getRange(summaryRow, colOf_(colMap, CONFIG.SUMMARY_COLS.nutritionFeedback)).setValue(feedback);
      Logger.log(`nutritionWriteback: ${dateStr} feedback 回写 Summarize 完成`);
    }
  }
}

// ── 生成当天空壳 nutrition event ────────────────────────────────

function createNutritionShellEvent_(nutritionRawSheet, dateStr, tz) {
  Logger.log(`nutritionShell: 开始生成 ${dateStr} 空壳事件`);

  const cal = CalendarApp.getCalendarById(CONFIG.NUTRITION.calendarId);
  if (!cal) {
    Logger.log("nutritionShell: 找不到营养日历，跳过");
    return;
  }

  const rowKey = dateStr.replace(/-/g, "");
  const rawRow = findOrInsertRowByKey_(nutritionRawSheet, rowKey, NUTRITION_RAW_COL.ROW_KEY, 2);
  const oldEventId = rawRow.inserted ? "" : String(nutritionRawSheet.getRange(rawRow.row, NUTRITION_RAW_COL.CALENDAR_EVENT_ID).getValue() || "").trim();

  if (oldEventId) {
    try {
      const event = cal.getEventById(oldEventId);
      if (event) {
        Logger.log(`nutritionShell: ${dateStr} 事件已存在，跳过`);
        return;
      }
    } catch (e) {
      Logger.log(`nutritionShell: 旧事件获取失败，尝试搜索日历`);
    }
  }

  const existing = findNutritionEventByDate_(cal, dateStr);
  if (existing) {
    nutritionRawSheet.getRange(rawRow.row, 1, 1, 5).setValues([[
      rowKey, dateStr, existing.getId(), 1, Utilities.formatDate(new Date(), tz, "yyyy-MM-dd")
    ]]);
    Logger.log(`nutritionShell: ${dateStr} 日历已有事件，补回 eventId → ${existing.getId()}`);
    return;
  }

  const title = `营养 ${dateStr}`;
  const d = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const eventDate = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));

  const newEvent = cal.createAllDayEvent(title, eventDate);
  newEvent.setDescription(CONFIG.NUTRITION.descSeparator);
  Utilities.sleep(500);

  const newEventId = newEvent.getId();
  const updatedAt = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  nutritionRawSheet.getRange(rawRow.row, 1, 1, 5).setValues([[
    rowKey, dateStr, newEventId, 1, updatedAt
  ]]);

  Logger.log(`nutritionShell: ✅ ${dateStr} 空壳事件创建完成 → ${newEventId}`);
}

// ── 按日期搜索营养日历事件 ──────────────────────────────────────

function findNutritionEventByDate_(cal, dateStr) {
  const d = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startOfDay = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const endOfDay = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + 1);
  const events = cal.getEvents(startOfDay, endOfDay);
  for (const ev of events) {
    if (ev.getTitle() === `营养 ${dateStr}`) return ev;
  }
  return null;
}