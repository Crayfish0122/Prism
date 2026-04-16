// ════════════════════════════════════════════════════════════
//  Health_SleepWeight_Sync.gs  —  睡眠・体重 Webhook 処理
//  純粋なツール関数は全て utils.gs に移譲済み
// ════════════════════════════════════════════════════════════

const RAW_COL = {
  ROW_KEY:           1,
  DATE:              2,
  SLEEP_START:       3,
  WAKE_TIME:         4,
  INBED_MIN:         5,
  CORE_MIN:          6,
  DEEP_MIN:          7,
  REM_MIN:           8,
  ACTUAL_SLEEP_MIN:  9,
  VALID:            10,
  DEBT_DELTA_MIN:   11,
  DEBT_TOTAL_MIN:   12,
  STATUS:           13,
  CALENDAR_EVENT_ID:14,
  CALENDAR_SYNCED:  15,
  UPDATED_AT:       16
};

// ── エントリポイント ─────────────────────────────────────────

function doGet(e)  { return handleCombinedWebhook(e, "GET");  }
function doPost(e) { return handleCombinedWebhook(e, "POST"); }

function handleCombinedWebhook(e, method) {
  const lock = LockService.getScriptLock();
  const traceId = newTraceId_();
  log_(traceId, "START handleCombinedWebhook", { method });
  lock.waitLock(20000);
  log_(traceId, "LOCK acquired");

  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const postType = e && e.postData && e.postData.type ? String(e.postData.type) : "";
    const rawPost  = e && e.postData && e.postData.contents ? String(e.postData.contents) : "";
    log_(traceId, "PARAM keys", Object.keys(p || {}));
    log_(traceId, "POST meta", { postType, rawPostPreview: shortText_(rawPost, 500) });

    let sleepRaw      = p.data   != null ? String(p.data)         : "";
    let rawWeight     = p.weight != null ? p.weight                : "";
    let rawWeightDate = p.date   != null ? String(p.date).trim()   : "";

    if (!sleepRaw && rawWeight === "" && rawWeightDate === "" &&
        rawPost && postType.indexOf("application/json") >= 0) {
      try {
        const body = JSON.parse(rawPost) || {};
        if (body.data   != null) sleepRaw      = String(body.data);
        if (body.weight != null) rawWeight     = body.weight;
        if (body.date   != null) rawWeightDate = String(body.date).trim();
        log_(traceId, "JSON fallback parsed ok", { hasSleepRaw: !!sleepRaw, rawWeight, rawWeightDate });
      } catch (err) {
        log_(traceId, "JSON fallback parse failed", { error: String(err) });
      }
    }

    log_(traceId, "INPUT parsed", {
      hasSleepRaw: !!sleepRaw,
      sleepRawPreview: shortText_(sleepRaw, 300),
      rawWeight: String(rawWeight),
      rawWeightDate
    });

    if (!sleepRaw && rawWeight === "" && rawWeightDate === "") {
      log_(traceId, "NO_DATA", { method });
      return textResponse(`NO_DATA_${method} TRACE=${traceId}`);
    }

    // ── 睡眠データ解析 ────────────────────────────────────────
    let sleepResult = null;
    if (sleepRaw) {
      const tz    = CONFIG.TZ;
      const now   = new Date();
      const lines = String(sleepRaw).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const agg   = {};
      log_(traceId, "SLEEP lines parsed", { lineCount: lines.length, first3: lines.slice(0, 3) });

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(/[,\t，]/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 3) { log_(traceId, "SLEEP skip: parts<3", { i, line: lines[i] }); continue; }

        const type    = parts[0];
        const startDt = parseDateSafe(parts[1], now);
        const end0    = parseDateSafe(parts[2], now);
        if (!startDt || !end0) { log_(traceId, "SLEEP skip: invalid dt", { i, line: lines[i] }); continue; }

        let endDt = end0;
        if (endDt.getTime() < startDt.getTime()) endDt = new Date(endDt.getTime() + 86400000);
        const durMin   = Math.max(0, Math.round((endDt - startDt) / 60000));
        const bucketKey = Utilities.formatDate(endDt, tz, "yyyy-MM-dd");

        if (!agg[bucketKey]) {
          agg[bucketKey] = { coreMin: 0, deepMin: 0, remMin: 0, inStart: null, inEnd: null, anyStart: startDt, anyEnd: endDt };
        }
        if (startDt < agg[bucketKey].anyStart) agg[bucketKey].anyStart = startDt;
        if (endDt   > agg[bucketKey].anyEnd)   agg[bucketKey].anyEnd   = endDt;

        const t = normalizeSleepType(type);
        if      (t === "CORE")  agg[bucketKey].coreMin += durMin;
        else if (t === "DEEP")  agg[bucketKey].deepMin += durMin;
        else if (t === "REM")   agg[bucketKey].remMin  += durMin;

        if (t === "INBED") {
          if (!agg[bucketKey].inStart || startDt < agg[bucketKey].inStart) agg[bucketKey].inStart = startDt;
          if (!agg[bucketKey].inEnd   || endDt   > agg[bucketKey].inEnd)   agg[bucketKey].inEnd   = endDt;
        }
        log_(traceId, "SLEEP line agg", { i, typeRaw: type, typeNorm: t, bucketKey, durMin });
      }

      const keys = Object.keys(agg);
      log_(traceId, "SLEEP bucket summary", { keys });

      if (keys.length > 0) {
        keys.sort();
        const latestKey = keys[keys.length - 1];
        const v         = agg[latestKey];
        const inStart   = v.inStart || v.anyStart;
        const inEnd     = v.inEnd   || v.anyEnd;
        const inbedMin  = Math.max(0, Math.round((inEnd - inStart) / 60000));

        sleepResult = {
          dateKey: latestKey,
          sleepTime: inStart, wakeTime: inEnd,
          coreMin: v.coreMin, deepMin: v.deepMin, remMin: v.remMin, inBedMin: inbedMin,
          core: v.coreMin / 1440, deep: v.deepMin / 1440, rem: v.remMin / 1440, inBed: inbedMin / 1440
        };
        log_(traceId, "SLEEP result built", {
          dateKey: sleepResult.dateKey, coreMin: sleepResult.coreMin,
          deepMin: sleepResult.deepMin, remMin: sleepResult.remMin, inBedMin: sleepResult.inBedMin
        });
      }
    }

    // ── 体重データ解析 ────────────────────────────────────────
    let weightResult = null;
    const weightStr  = normalizeNumber(rawWeight, 1);
    log_(traceId, "WEIGHT normalized", { rawWeight: String(rawWeight), weightStr, rawWeightDate });

    if (weightStr !== "") {
      const weightDateKey = normalizeDateCellToKey_(rawWeightDate, CONFIG.TZ);
      if (!weightDateKey) {
        log_(traceId, "NO_WEIGHT_DATE", { rawWeightDate });
        return textResponse(`NO_WEIGHT_DATE_${method} TRACE=${traceId}`);
      }
      weightResult = { dateKey: weightDateKey, weight: Number(weightStr) };
      log_(traceId, "WEIGHT result built", weightResult);
    }

    if (!sleepResult && !weightResult) {
      log_(traceId, "PARSE_ZERO");
      return textResponse(`PARSE_ZERO_${method} TRACE=${traceId}`);
    }

    return writeCombinedToTargetXlsx(sleepResult, weightResult, method, traceId);

  } catch (err) {
    log_(traceId, "ERR handleCombinedWebhook", { error: String(err), stack: err && err.stack ? String(err.stack) : "" });
    return textResponse(`ERR_${method} ${String(err)} TRACE=${traceId}`);
  } finally {
    try { lock.releaseLock(); log_(traceId, "LOCK released"); }
    catch (e2) { log_(traceId, "LOCK release failed", { error: String(e2) }); }
  }
}

// ── xlsx 書き込みパイプライン ─────────────────────────────────

// 统一走通用 xlsx 管道；这里只保留睡眠/体重业务写入与 webhook 返回结果
function writeCombinedToTargetXlsx(sleepResult, weightResult, method, traceId) {
  const tz = CONFIG.TZ;
  const tempName = `_TEMP_TARGET_COMBINED_${Utilities.formatDate(new Date(), tz, "yyyyMMdd_HHmmss")}`;

  try {
    const result = runTargetXlsxPipeline_(tempName, tempSS => {
      const rawSheet     = getSheetStrict(tempSS, CONFIG.TARGET.rawSheetName);
      const summarySheet = getSheetStrict(tempSS, CONFIG.TARGET.summarySheetName);
      const configSheet  = getSheetStrict(tempSS, CONFIG.TARGET.configSheetName);
      log_(traceId, "SHEETS loaded", {
        rawLastRow: rawSheet.getLastRow(),
        summaryLastRow: summarySheet.getLastRow()
      });

      const cfg    = loadSleepConfig_(configSheet, tz, traceId);
      const colMap = getColMapFromHeader(summarySheet, 1);

      const required = [
        CONFIG.SUMMARY_COLS.sleepTime,
        CONFIG.SUMMARY_COLS.sleepStages,
        CONFIG.SUMMARY_COLS.sleepResult,
        CONFIG.SUMMARY_COLS.weight
      ];
      const missing = required.filter(k => !colOf_(colMap, k));
      if (missing.length > 0) throw new Error(`总结页找不到列标题: ${missing.join(", ")}`);
      log_(traceId, "SUMMARY colMap ok", colMap);

      let sleepMsg = "sleep=none";
      let weightMsg = "weight=none";
      let summarySleepMsg = "summary_sleep=none";
      let summaryWeightMsg = "summary_weight=none";

      if (sleepResult) {
        log_(traceId, "UPSERT sleep start", sleepResult);
        const upsertInfo = upsertSleepDailyRaw_(rawSheet, sleepResult, cfg, tz, traceId);
        recalcSleepDailyRawFromRow_(rawSheet, upsertInfo.row, upsertInfo.isLatestRow, cfg, tz, traceId);
        sleepMsg = `sleep=${sleepResult.dateKey}`;

        try {
          syncSleepDailyRawToSummaryFromRow_(rawSheet, upsertInfo.row, summarySheet, cfg, tz, colMap, traceId);
          summarySleepMsg = `summary_sleep=${sleepResult.dateKey}`;
        } catch (err) {
          summarySleepMsg = "summary_sleep=skip";
          log_(traceId, "SUMMARY sleep sync skipped", { error: String(err) });
        }
      }

      if (weightResult) {
        weightMsg = `weight=${weightResult.dateKey}:${weightResult.weight}`;
        try {
          writeWeightToSummary_(summarySheet, weightResult, colMap, tz, traceId);
          summaryWeightMsg = `summary_weight=${weightResult.dateKey}`;
        } catch (err) {
          summaryWeightMsg = "summary_weight=skip";
          log_(traceId, "SUMMARY weight write skipped", { error: String(err) });
        }
      }

      const okText = `OK_${method} ${sleepMsg} ${weightMsg} ${summarySleepMsg} ${summaryWeightMsg} TRACE=${traceId}`;
      log_(traceId, "FINISH OK", { response: okText });

      return { response: textResponse(okText) };
    });

    return result.response;
  } catch (err) {
    log_(traceId, "ERR writeCombined", {
      error: String(err),
      stack: err && err.stack ? String(err.stack) : ""
    });
    return textResponse(`ERR_WRITE_${method} ${String(err)} TRACE=${traceId}`);
  }
}

// ── 設定読み込み ──────────────────────────────────────────────

function loadSleepConfig_(configSheet, tz, traceId) {
  const lastRow = configSheet.getLastRow();
  const values  = lastRow >= 2 ? configSheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  const map = {};
  values.forEach(row => {
    const k = String(row[0] || "").trim();
    if (k) map[k] = row[1];
  });
  const k = CONFIG.SLEEP_CONFIG_KEYS;
  const cfg = {
    target_sleep_min:           toIntOrDefault_(map[k.targetSleepMin], 420),
    debt_floor_min:             toIntOrDefault_(map[k.debtFloorMin], 0),
    status_threshold_light_min: toIntOrDefault_(map[k.statusThresholdLightMin], 360),
    status_threshold_good_min:  toIntOrDefault_(map[k.statusThresholdGoodMin], 420),
    default_timezone:           String(map[k.defaultTimezone] || tz || "Asia/Tokyo"),
    sleepCalendarId:            String(map[k.sleepCalendarId] || "").trim()
  };
  log_(traceId, "CONFIG loaded", cfg);
  return cfg;
}

// ── 睡眠ロジック ──────────────────────────────────────────────

function getSleepStatus_(actualSleepMin, cfg) {
  const actual = toIntOrDefault_(actualSleepMin, 0);
  if (actual >= cfg.status_threshold_good_min)  return "达标";
  if (actual >= cfg.status_threshold_light_min) return "轻度不足";
  return "明显不足";
}

function sleepMinutesFromResult_(minField, dayFractionField) {
  if (minField !== undefined && minField !== null && minField !== "") return toIntOrDefault_(minField, 0);
  if (dayFractionField === undefined || dayFractionField === null || dayFractionField === "") return null;
  const n = Number(dayFractionField);
  return isFinite(n) ? Math.round(n * 1440) : null;
}

function upsertSleepDailyRaw_(rawSheet, sleepResult, cfg, tz, traceId) {
  const dateKey = normalizeDateCellToKey_(sleepResult.dateKey, tz);
  if (!dateKey) throw new Error(`sleepResult.dateKey 非法: ${sleepResult.dateKey}`);

  const rowKey    = dateKey.replace(/-/g, "");
  const locate    = findOrInsertRowByKey_(rawSheet, rowKey, RAW_COL.ROW_KEY, 2);
  log_(traceId, "RAW locate", { rowKey, row: locate.row, inserted: locate.inserted });

  let oldCalendarEventId = "", oldCalendarSynced = "";
  if (!locate.inserted) {
    const old = rawSheet.getRange(locate.row, RAW_COL.CALENDAR_EVENT_ID, 1, 2).getValues()[0];
    oldCalendarEventId = String(old[0] || "").trim();
    oldCalendarSynced  = old[1];
  }

  const coreMin     = sleepMinutesFromResult_(sleepResult.coreMin,   sleepResult.core);
  const deepMin     = sleepMinutesFromResult_(sleepResult.deepMin,   sleepResult.deep);
  const remMin      = sleepMinutesFromResult_(sleepResult.remMin,    sleepResult.rem);
  const inbedMinRaw = sleepMinutesFromResult_(sleepResult.inBedMin,  sleepResult.inBed);
  const hasStage    = [coreMin, deepMin, remMin].some(v => v != null);
  const actualSleepMin = hasStage ? (coreMin||0) + (deepMin||0) + (remMin||0) : "";
  const valid       = hasStage ? 1 : 0;

  const rowValues = [[
    rowKey, dateKey,
    valid ? formatHm_(sleepResult.sleepTime, tz) : "",
    valid ? formatHm_(sleepResult.wakeTime, tz)  : "",
    valid ? (inbedMinRaw != null ? inbedMinRaw : 0) : 0,
    valid ? (coreMin != null ? coreMin : "") : "",
    valid ? (deepMin != null ? deepMin : "") : "",
    valid ? (remMin  != null ? remMin  : "") : "",
    actualSleepMin, valid,
    "",   // ← [修改2] debt_delta 留空，由 recalc 统一计算
    "",
    valid ? getSleepStatus_(actualSleepMin, cfg) : "无效",
    oldCalendarEventId,
    oldCalendarSynced === "" || oldCalendarSynced == null ? "" : oldCalendarSynced,
    Utilities.formatDate(new Date(), tz, "yyyy-MM-dd")
  ]];
  log_(traceId, "RAW rowValues ready", rowValues[0]);
  rawSheet.getRange(locate.row, 1, 1, 16).setValues(rowValues);
  log_(traceId, "RAW write done", { row: locate.row });

  if (cfg.sleepCalendarId && valid) {
    upsertSleepCalendarEvent_(rawSheet, locate.row, sleepResult, oldCalendarEventId, cfg, tz, traceId);
  }

  return { row: locate.row, inserted: locate.inserted, isLatestRow: locate.row === rawSheet.getLastRow(), rowKey, dateKey };
}

function upsertSleepCalendarEvent_(rawSheet, row, sleepResult, oldEventId, cfg, tz, traceId) {
  try {
    const cal = CalendarApp.getCalendarById(cfg.sleepCalendarId);
    if (!cal) throw new Error(`找不到日历: ${cfg.sleepCalendarId}`);

    const actual      = (sleepResult.coreMin || 0) + (sleepResult.deepMin || 0) + (sleepResult.remMin || 0);
    const debtDelta   = cfg.target_sleep_min - actual;
    const sleepStr    = formatHm_(sleepResult.sleepTime, tz);
    const wakeStr     = formatHm_(sleepResult.wakeTime, tz);
    const expectTitle = `睡眠 ${sleepResult.dateKey} ${sleepStr}-${wakeStr}`;
    const expectDesc  = [
      `inbed=${sleepResult.inBedMin || 0}`,
      `core=${sleepResult.coreMin || 0}`,
      `deep=${sleepResult.deepMin || 0}`,
      `rem=${sleepResult.remMin || 0}`,
      `actual=${actual}`,
      `debt_delta=${debtDelta}`,
      `status=${getSleepStatus_(actual, cfg)}`
    ].join("|");

    let event = null;

    if (oldEventId) {
      try {
        event = cal.getEventById(oldEventId);
      } catch (e) {
        log_(traceId, "CALENDAR old get failed, fallback to create", {
          oldEventId,
          error: String(e)
        });
      }
    }

    if (event) {
      const titleSame = event.getTitle() === expectTitle;
      const descSame  = event.getDescription() === expectDesc;
      const startSame = event.getStartTime().getTime() === sleepResult.sleepTime.getTime();
      const endSame   = event.getEndTime().getTime() === sleepResult.wakeTime.getTime();

      if (titleSame && descSame && startSame && endSame) {
        log_(traceId, "CALENDAR no change, skip", { oldEventId });
        return;
      }

      event.setTitle(expectTitle);
      event.setDescription(expectDesc);
      event.setTime(sleepResult.sleepTime, sleepResult.wakeTime);

      rawSheet.getRange(row, RAW_COL.CALENDAR_EVENT_ID).setValue(event.getId());
      rawSheet.getRange(row, RAW_COL.CALENDAR_SYNCED).setValue(1);
      log_(traceId, "CALENDAR event updated", {
        eventId: event.getId(),
        title: expectTitle
      });
      return;
    }

    const newEvent = cal.createEvent(expectTitle, sleepResult.sleepTime, sleepResult.wakeTime);
    newEvent.setDescription(expectDesc);
    Utilities.sleep(500);

    const newEventId = newEvent.getId();
    rawSheet.getRange(row, RAW_COL.CALENDAR_EVENT_ID).setValue(newEventId);
    rawSheet.getRange(row, RAW_COL.CALENDAR_SYNCED).setValue(1);
    log_(traceId, "CALENDAR event created", {
      newEventId,
      title: expectTitle
    });

  } catch (err) {
    log_(traceId, "CALENDAR upsert failed", { error: String(err) });
  }
}

function recalcSleepDailyRawFromRow_(rawSheet, startRow, isLatestRow, cfg, tz, traceId) {
  const dataStartRow = 2;
  const lastRow = rawSheet.getLastRow();
  if (lastRow < dataStartRow) { log_(traceId, "RECALC skip: no data"); return; }

  const fromRow = Math.max(startRow, dataStartRow);
  if (fromRow > lastRow) { log_(traceId, "RECALC skip: fromRow>lastRow", { fromRow, lastRow }); return; }

  const toRow  = isLatestRow ? fromRow : lastRow;
  let prevDebt = fromRow > dataStartRow
    ? toIntOrDefault_(rawSheet.getRange(fromRow - 1, RAW_COL.DEBT_TOTAL_MIN).getValue(), 0)
    : 0;

  log_(traceId, "RECALC begin", { fromRow, toRow, prevDebt });

  const range  = rawSheet.getRange(fromRow, 1, toRow - fromRow + 1, 16);
  const values = range.getValues();
  const updatedAt = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  for (let i = 0; i < values.length; i++) {
    const row      = values[i];
    const coreMin  = toNullableInt_(row[RAW_COL.CORE_MIN - 1]);
    const deepMin  = toNullableInt_(row[RAW_COL.DEEP_MIN - 1]);
    const remMin   = toNullableInt_(row[RAW_COL.REM_MIN  - 1]);
    const hasStage = [coreMin, deepMin, remMin].some(v => v != null);

    if (hasStage) {
      const actual    = (coreMin||0) + (deepMin||0) + (remMin||0);
      const debtDelta = cfg.target_sleep_min - actual;
      const debtTotal = Math.max(cfg.debt_floor_min, prevDebt + debtDelta);
      row[RAW_COL.ACTUAL_SLEEP_MIN - 1] = actual;
      row[RAW_COL.VALID            - 1] = 1;
      row[RAW_COL.DEBT_DELTA_MIN   - 1] = debtDelta;
      row[RAW_COL.DEBT_TOTAL_MIN   - 1] = debtTotal;
      row[RAW_COL.STATUS           - 1] = getSleepStatus_(actual, cfg);
      row[RAW_COL.UPDATED_AT       - 1] = updatedAt;
      log_(traceId, "RECALC row valid", { rowNo: fromRow+i, actual, debtDelta, debtTotal });
      prevDebt = debtTotal;
    } else {
      row[RAW_COL.SLEEP_START      - 1] = "";
      row[RAW_COL.WAKE_TIME        - 1] = "";
      row[RAW_COL.INBED_MIN        - 1] = 0;
      row[RAW_COL.CORE_MIN         - 1] = "";
      row[RAW_COL.DEEP_MIN         - 1] = "";
      row[RAW_COL.REM_MIN          - 1] = "";
      row[RAW_COL.ACTUAL_SLEEP_MIN - 1] = "";
      row[RAW_COL.VALID            - 1] = 0;
      row[RAW_COL.DEBT_DELTA_MIN   - 1] = "";
      row[RAW_COL.DEBT_TOTAL_MIN   - 1] = prevDebt;
      row[RAW_COL.STATUS           - 1] = "无效";
      row[RAW_COL.UPDATED_AT       - 1] = updatedAt;
    }
  }

  range.setValues(values);
  log_(traceId, "RECALC write back done", { fromRow, toRow, rows: values.length });
}

function syncSleepDailyRawToSummaryFromRow_(rawSheet, startRow, summarySheet, cfg, tz, colMap, traceId) {
  const lastRow = rawSheet.getLastRow();
  if (startRow > lastRow) { log_(traceId, "SYNC skip: startRow>lastRow"); return; }

  const values = rawSheet.getRange(startRow, 1, lastRow - startRow + 1, 13).getDisplayValues();
  log_(traceId, "SYNC begin", { startRow, rows: values.length });

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const record = {
      row_key:          String(row[RAW_COL.ROW_KEY          - 1] || "").trim(),
      date:             normalizeDateTextToKey_(row[RAW_COL.DATE - 1]),
      sleep_start:      normalizeHmText_(row[RAW_COL.SLEEP_START - 1]),
      wake_time:        normalizeHmText_(row[RAW_COL.WAKE_TIME   - 1]),
      inbed_min:        row[RAW_COL.INBED_MIN        - 1],
      core_min:         row[RAW_COL.CORE_MIN         - 1],
      deep_min:         row[RAW_COL.DEEP_MIN         - 1],
      rem_min:          row[RAW_COL.REM_MIN          - 1],
      actual_sleep_min: row[RAW_COL.ACTUAL_SLEEP_MIN - 1],
      valid:            row[RAW_COL.VALID            - 1],
      debt_delta_min:   row[RAW_COL.DEBT_DELTA_MIN   - 1],
      debt_total_min:   row[RAW_COL.DEBT_TOTAL_MIN   - 1],
      status:           row[RAW_COL.STATUS           - 1]
    };
    syncOneSleepRecordToSummary_(summarySheet, record, cfg, tz, colMap, traceId);
  }
  log_(traceId, "SYNC done");
}

function syncOneSleepRecordToSummary_(summarySheet, rec, cfg, tz, colMap, traceId) {
  if (!rec.date) { log_(traceId, "SYNC one skip: no date", rec); return; }

  const row   = ensureSummaryRow_(summarySheet, rec.row_key, rec.date, tz, colMap, traceId);
  const valid = Number(rec.valid) === 1;

  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.sleepTime)).setValue(
    valid ? `date=${rec.date}|sleep=${nzText_(rec.sleep_start)}|wake=${nzText_(rec.wake_time)}`
          : `date=${rec.date}|sleep=|wake=`
  );
  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.sleepStages)).setValue(
    valid ? `inbed=${nzIntText_(rec.inbed_min,0)}|core=${nzText_(rec.core_min)}|deep=${nzText_(rec.deep_min)}|rem=${nzText_(rec.rem_min)}`
          : `inbed=0|core=|deep=|rem=`
  );
  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.sleepResult)).setValue(
    valid ? `actual=${nzText_(rec.actual_sleep_min)}|debt_delta=${nzText_(rec.debt_delta_min)}|debt_total=${nzIntText_(rec.debt_total_min,0)}|status=${nzText_(rec.status)}`
          : `actual=|debt_delta=|debt_total=${nzIntText_(rec.debt_total_min,0)}|status=无效`
  );
  log_(traceId, "SUMMARY row updated", { row, date: rec.date });
}

function writeWeightToSummary_(summarySheet, weightResult, colMap, tz, traceId) {
  const dateKey = normalizeDateCellToKey_(weightResult.dateKey, tz);
  if (!dateKey) throw new Error(`weightResult.dateKey 非法: ${weightResult.dateKey}`);

  const row = findSummaryRowByDate_(summarySheet, dateKey, colMap, tz);
  if (!row) throw new Error(`总结页未找到体重日期行: ${dateKey}`);

  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.weight))
    .setValue(Number(weightResult.weight))
    .setNumberFormat("0.0");
  log_(traceId, "SUMMARY weight updated", { row, dateKey, weight: weightResult.weight });
}

function ensureSummaryRow_(summarySheet, rowKey, dateKey, tz, colMap, traceId) {
  const key = normalizeDateCellToKey_(dateKey, tz);
  if (!key) throw new Error(`非法 dateKey: ${dateKey}`);
  const row = findSummaryRowByDate_(summarySheet, key, colMap, tz);
  if (!row) throw new Error(`总结页未找到日期行: ${key}`);
  summarySheet.getRange(row, colOf_(colMap, CONFIG.SUMMARY_COLS.rowKey) || 1).setValue(rowKey);
  log_(traceId, "SUMMARY row found", { row, rowKey, dateKey: key });
  return row;
}