// ════════════════════════════════════════════════════════════
//  Health_Workout_Sync.gs  —  健身日历同步
//  純粋なツール関数は全て utils.gs に移譲済み
// ════════════════════════════════════════════════════════════

const WORKOUT_RAW_COL = {
  ROW_KEY:           1,
  DATE:              2,
  CALENDAR_EVENT_ID: 3,
  CALENDAR_SYNCED:   4,
  UPDATED_AT:        5,
};

// ── 主入口 ───────────────────────────────────────────────────

function HealthWorkoutSync() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const tz           = CONFIG.TZ;
    const today        = getTodayInTz();
    const todayStr     = ymd(today);
    const yesterdayStr = ymd(addDays(today, -1));

    Logger.log("===== 开始健身同步 =====");
    Logger.log(`执行时间(东京): ${Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss")}`);
    Logger.log(`今日: ${todayStr} / 回写日: ${yesterdayStr}`);

    const tempName = `_TEMP_WORKOUT_${todayStr}`;
    const tempSSId = driveCopyAsGoogleSheet(CONFIG.TARGET.xlsxFileId, tempName);

    try {
      const tempSS          = openSpreadsheetWithRetry(tempSSId, CONFIG.TARGET.openRetryTimes, CONFIG.TARGET.openRetrySleepMs);
      const summarySheet    = getSheetStrict(tempSS, CONFIG.TARGET.summarySheetName);
      const workoutRawSheet = getSheetStrict(tempSS, CONFIG.TARGET.workoutRawSheetName);
      const colMap          = getColMapFromHeader(summarySheet, 1);

      // ── Step 1: 回写昨天的 feedback ──────────────────────
      readbackWorkoutFeedback_(summarySheet, workoutRawSheet, yesterdayStr, colMap, tz);

      // ── Step 2: 生成今天的 event ──────────────────────────
      syncWorkoutCalendar_(summarySheet, workoutRawSheet, todayStr, colMap, tz);

      SpreadsheetApp.flush();

      const blob = exportSpreadsheetAsXlsx(tempSSId, getXlsxFileName(CONFIG.TARGET.xlsxFileId));
      driveUpdateBinary(CONFIG.TARGET.xlsxFileId, blob);
      syncTempSSToGoogleSheet(tempSSId);

      Logger.log("✅ 已覆盖写回原xlsx文件");
      Logger.log("===== 健身同步完成 =====");
    } finally {
      DriveApp.getFileById(tempSSId).setTrashed(true);
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Step1: 回写昨天 feedback ──────────────────────────────────

function readbackWorkoutFeedback_(summarySheet, workoutRawSheet, dateStr, colMap, tz) {
  Logger.log(`readback: 开始回写 ${dateStr}`);

  const workoutType = getWorkoutTypeFromSummary_(summarySheet, dateStr, colMap, tz);
  if (!workoutType) {
    Logger.log(`readback: ${dateStr} WorkoutType 为空，跳过`);
    return;
  }

  const cal = CalendarApp.getCalendarById(CONFIG.WORKOUT.calendarId);
  if (!cal) {
    Logger.log(`readback: 找不到日历，跳过`);
    return;
  }

  const event = findCalendarEventByDate_(cal, dateStr, tz);
  if (!event) {
    Logger.log(`readback: ${dateStr} event 未找到，跳过`);
    return;
  }

  // eventId が変わっていれば workout_daily_raw を更新
  const newEventId = event.getId();
  const rowKey     = dateStr.replace(/-/g, "");
  const rawRow     = findOrInsertRowByKey_(workoutRawSheet, rowKey, WORKOUT_RAW_COL.ROW_KEY, 2);
  const oldEventId = rawRow.inserted ? "" : String(workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).getValue() || "").trim();
  if (newEventId !== oldEventId) {
    workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).setValue(newEventId);
    Logger.log(`readback: eventId 更新 ${oldEventId} → ${newEventId}`);
  }

  const desc      = event.getDescription() || "";
  Logger.log(`readback: desc raw = [${desc}]`);
  const parts     = desc.split(CONFIG.WORKOUT.descSeparator);
  const existPlan = parts[0].trim();
  const feedback  = parts.length >= 2 ? parts[1].trim() : "";

  // ── nutrition_total を plan 段の先頭に補記 ───────────────
  const nutritionTotal = getNutritionTotalFromSummary_(summarySheet, dateStr, colMap, tz);
  const newPlan        = [nutritionTotal, existPlan].filter(Boolean).join("\n");
  const newDesc        = newPlan + CONFIG.WORKOUT.descSeparator + feedback;
  if (newDesc !== desc) {
    event.setDescription(newDesc);
    Logger.log(`readback: ${dateStr} nutrition_total 写入 event description`);
  }

  if (!feedback) {
    Logger.log(`readback: ${dateStr} feedback 为空，跳过`);
    return;
  }

  const summaryRow = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!summaryRow) {
    Logger.log(`readback: ${dateStr} Summarize 中无此行，跳过`);
    return;
  }

  summarySheet.getRange(summaryRow, colOf_(colMap, CONFIG.SUMMARY_COLS.workoutFeedback)).setValue(feedback);
  Logger.log(`readback: ✅ ${dateStr} feedback 写入完成`);
}

// ── Step2: 今天的 event 生成 ──────────────────────────────────

function syncWorkoutCalendar_(summarySheet, workoutRawSheet, dateStr, colMap, tz) {
  Logger.log(`syncWorkout: 开始生成 ${dateStr} event`);

  const workoutType   = getWorkoutTypeFromSummary_(summarySheet, dateStr, colMap, tz);
  const workoutDetail = getWorkoutDetailFromSummary_(summarySheet, dateStr, colMap, tz);

  if (!workoutType) {
    Logger.log(`syncWorkout: ${dateStr} WorkoutType 为空，跳过`);
    return;
  }

  const cal = CalendarApp.getCalendarById(CONFIG.WORKOUT.calendarId);
  if (!cal) throw new Error(`找不到健身日历: ${CONFIG.WORKOUT.calendarId}`);

  const rowKey = dateStr.replace(/-/g, "");
  const rawRow = findOrInsertRowByKey_(workoutRawSheet, rowKey, WORKOUT_RAW_COL.ROW_KEY, 2);

  let oldEventId = "";
  if (!rawRow.inserted) {
    oldEventId = String(workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).getValue() || "").trim();
  }

  const expectTitle = buildWorkoutEventTitle(dateStr, workoutType);
  const expectPlan  = workoutDetail;

  if (oldEventId) {
    try {
      const event         = cal.getEventById(oldEventId);
      const existDesc     = event.getDescription() || "";
      const existPlan     = existDesc.split(CONFIG.WORKOUT.descSeparator)[0].trim();
      const existFeedback = existDesc.split(CONFIG.WORKOUT.descSeparator)[1] || "";

      if (event.getTitle() === expectTitle && existPlan === expectPlan) {
        Logger.log(`syncWorkout: ${dateStr} 内容一致，跳过`);
        return;
      }

      event.deleteEvent();
      Logger.log(`syncWorkout: ${dateStr} 计划变更，删旧事件 ${oldEventId}`);
      createWorkoutEvent_(workoutRawSheet, rawRow.row, dateStr, workoutType, expectPlan, existFeedback, tz);
      return;
    } catch (e) {
      Logger.log(`syncWorkout: 旧事件获取失败，重新创建 ${oldEventId}`);
    }
  }

  createWorkoutEvent_(workoutRawSheet, rawRow.row, dateStr, workoutType, expectPlan, "", tz);
}

// ── event 创建 ────────────────────────────────────────────────

function createWorkoutEvent_(workoutRawSheet, rawRowNo, dateStr, workoutType, plan, feedback, tz) {
  const cal = CalendarApp.getCalendarById(CONFIG.WORKOUT.calendarId);
  if (!cal) throw new Error(`找不到健身日历: ${CONFIG.WORKOUT.calendarId}`);

  const title       = buildWorkoutEventTitle(dateStr, workoutType);
  const description = plan + CONFIG.WORKOUT.descSeparator + feedback;
  const d           = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const eventDate   = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));

  const newEvent = cal.createAllDayEvent(title, eventDate);
  newEvent.setDescription(description);
  Utilities.sleep(500);

  const newEventId = newEvent.getId();
  const updatedAt  = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const rowKey     = dateStr.replace(/-/g, "");

  workoutRawSheet.getRange(rawRowNo, 1, 1, 5).setValues([[
    rowKey, dateStr, newEventId, 1, updatedAt
  ]]);

  Logger.log(`syncWorkout: ✅ ${dateStr} [${workoutType}] event 创建完成 → ${newEventId}`);
}

// ── 工具函数 ─────────────────────────────────────────────────

function buildWorkoutEventTitle(dateStr, workoutType) {
  return `${workoutType} ${dateStr}`;
}

function getWorkoutTypeFromSummary_(summarySheet, dateStr, colMap, tz) {
  const row = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!row) return "";
  return String(summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.workoutType)).getValue() || "").trim();
}

function getNutritionTotalFromSummary_(summarySheet, dateStr, colMap, tz) {
  const row = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!row) return "";
  return String(summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.nutritionTotal)).getValue() || "").trim();
}

function getWorkoutDetailFromSummary_(summarySheet, dateStr, colMap, tz) {
  const row = findSummaryRowByDate_(summarySheet, dateStr, colMap, tz);
  if (!row) return "";
  return String(summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.workoutDetail)).getValue() || "").trim();
}

// 标题包含日期字符串的 event 搜索（训练日・休息日问わず）
function findCalendarEventByDate_(cal, dateStr, tz) {
  const d          = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startOfDay = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const endOfDay   = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + 1);
  const events     = cal.getEvents(startOfDay, endOfDay);
  for (const ev of events) {
    if (ev.getTitle().indexOf(dateStr) >= 0) return ev;
  }
  return null;
}