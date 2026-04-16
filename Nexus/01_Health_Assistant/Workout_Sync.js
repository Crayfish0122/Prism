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
    runTargetXlsxPipeline_(tempName, tempSS => {
      const summarySheet    = getSheetStrict(tempSS, CONFIG.TARGET.summarySheetName);
      const workoutRawSheet = getSheetStrict(tempSS, CONFIG.TARGET.workoutRawSheetName);
      const colMap          = getColMapFromHeader(summarySheet, 1);

      assertSummaryCols_(colMap, [
        CONFIG.SUMMARY_COLS.date,
        CONFIG.SUMMARY_COLS.workoutType,
        CONFIG.SUMMARY_COLS.workoutDetail,
        CONFIG.SUMMARY_COLS.workoutFeedback,
        ], "HealthWorkoutSync");
      Logger.log("HealthWorkoutSync: summary 列头校验通过");

      readbackWorkoutFeedback_(summarySheet, workoutRawSheet, yesterdayStr, colMap, tz);
      syncWorkoutCalendar_(summarySheet, workoutRawSheet, todayStr, colMap, tz);
    });

    Logger.log("✅ 已覆盖写回原xlsx文件");
    Logger.log("===== 健身同步完成 =====");
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Step1: 回写昨天 feedback ──────────────────────────────────

function readbackWorkoutFeedback_(summarySheet, workoutRawSheet, dateStr, colMap, tz) {
  Logger.log(`readback: 开始回写 ${dateStr}`);

  const workoutType = getSummaryCellByDate_(summarySheet, dateStr, CONFIG.SUMMARY_COLS.workoutType, colMap, tz);
  if (!workoutType) {
    Logger.log(`readback: ${dateStr} WorkoutType 为空，跳过`);
    return;
  }

  const cal = CalendarApp.getCalendarById(CONFIG.WORKOUT.calendarId);
  if (!cal) {
    Logger.log(`readback: 找不到日历，跳过`);
    return;
  }

  const rowKey  = dateStr.replace(/-/g, "");
  const rawRow  = findOrInsertRowByKey_(workoutRawSheet, rowKey, WORKOUT_RAW_COL.ROW_KEY, 2);
  const eventId = rawRow.inserted ? "" : String(workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).getValue() || "").trim();
  const event   = findWorkoutEvent_(cal, dateStr, eventId, tz);

  if (!event) {
    Logger.log(`readback: ${dateStr} event 未找到，跳过`);
    return;
  }

  const newEventId = event.getId();
  if (newEventId !== eventId) {
    workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).setValue(newEventId);
    Logger.log(`readback: eventId 更新 ${eventId} → ${newEventId}`);
  }

  const desc     = event.getDescription() || "";
  Logger.log(`readback: desc raw = [${desc}]`);
  const parts    = desc.split(CONFIG.WORKOUT.descSeparator);
  const feedback = parts.length >= 2 ? parts[1].trim() : "";

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

  const workoutType   = getSummaryCellByDate_(summarySheet, dateStr, CONFIG.SUMMARY_COLS.workoutType, colMap, tz);
  const workoutDetail = getSummaryCellByDate_(summarySheet, dateStr, CONFIG.SUMMARY_COLS.workoutDetail, colMap, tz);

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
      const event = cal.getEventById(oldEventId);
      if (event) {
        updateWorkoutEventIfChanged_(event, expectTitle, expectPlan, dateStr, "oldId 命中");
        return;
      }

      Logger.log(`syncWorkout: oldEventId=${oldEventId} 未命中，改走精确标题补查`);
    } catch (e) {
      Logger.log(`syncWorkout: 旧事件获取失败，oldEventId=${oldEventId}，改走精确标题补查`);
    }
  }

  // oldEventId 为空或失效时，先按"当天 + 精确标题"补查，避免重复建 event
  const fallbackEvent = findWorkoutEventByExactTitle_(cal, dateStr, expectTitle);
  if (fallbackEvent) {
    const fallbackEventId = fallbackEvent.getId();
    if (fallbackEventId !== oldEventId) {
      workoutRawSheet.getRange(rawRow.row, WORKOUT_RAW_COL.CALENDAR_EVENT_ID).setValue(fallbackEventId);
      Logger.log(`syncWorkout: 补查命中已有事件，回填 eventId ${oldEventId} → ${fallbackEventId}`);
    }

    updateWorkoutEventIfChanged_(fallbackEvent, expectTitle, expectPlan, dateStr, "补查命中");
    return;
  }

  createWorkoutEvent_(workoutRawSheet, rawRow.row, dateStr, workoutType, expectPlan, "", tz);
}

// ── event 原地更新（内容变更时）──────────────────────────────

// 比较 title 和 plan，完全一致则跳过；任一不同则原地更新 title 和 description，feedback 段保持不变
function updateWorkoutEventIfChanged_(event, expectTitle, expectPlan, dateStr, logTag) {
  const existDesc     = event.getDescription() || "";
  const existParts    = existDesc.split(CONFIG.WORKOUT.descSeparator);
  const existPlan     = (existParts[0] || "").trim();
  const existFeedback = existParts.length >= 2 ? existParts.slice(1).join(CONFIG.WORKOUT.descSeparator) : "";

  if (event.getTitle() === expectTitle && existPlan === expectPlan) {
    Logger.log(`syncWorkout: ${dateStr} ${logTag} 内容一致，跳过`);
    return;
  }

  event.setTitle(expectTitle);
  event.setDescription(expectPlan + CONFIG.WORKOUT.descSeparator + existFeedback);
  Logger.log(`syncWorkout: ${dateStr} ${logTag} 计划变更，原地更新事件 ${event.getId()}`);
}

// ── event 创建 ────────────────────────────────────────────────

function createWorkoutEvent_(workoutRawSheet, rawRowNo, dateStr, workoutType, plan, feedback, tz) {
  const cal = CalendarApp.getCalendarById(CONFIG.WORKOUT.calendarId);
  if (!cal) throw new Error(`找不到健身日历: ${CONFIG.WORKOUT.calendarId}`);

  const title       = buildWorkoutEventTitle(dateStr, workoutType);
  const description = plan + CONFIG.WORKOUT.descSeparator + feedback;
  const eventDate   = parseYmdToDate_(dateStr);

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

function getSummaryCellByDate_(sheet, dateStr, colKey, colMap, tz) {
  const row = findSummaryRowByDate_(sheet, dateStr, colMap, tz);
  if (!row) return "";
  return String(sheet.getRange(row, colOf_(colMap, colKey)).getValue() || "").trim();
}

// 优先用 raw 里的 eventId 精确查找；没有时再按日期兜底
function findWorkoutEvent_(cal, dateStr, eventId, tz) {
  if (eventId) {
    try {
      const event = cal.getEventById(eventId);
      if (event) return event;
      Logger.log(`findWorkoutEvent: eventId 未命中 ${eventId}，改走日期兜底`);
    } catch (e) {
      Logger.log(`findWorkoutEvent: eventId 获取失败 ${eventId}，改走日期兜底`);
    }
  }

  const startOfDay = parseYmdToDate_(dateStr);
  const endOfDay   = addDays(startOfDay, 1);
  const events     = cal.getEvents(startOfDay, endOfDay);

  for (const ev of events) {
    if (ev.getTitle().indexOf(dateStr) >= 0) return ev;
  }
  return null;
}

// oldEventId 为空或失效时，按“当天 + 精确标题”补查，防止重复创建
function findWorkoutEventByExactTitle_(cal, dateStr, expectTitle) {
  const startOfDay = parseYmdToDate_(dateStr);
  const endOfDay   = addDays(startOfDay, 1);
  const events     = cal.getEvents(startOfDay, endOfDay);

  for (const ev of events) {
    if (ev.getTitle() === expectTitle) return ev;
  }
  return null;
}
