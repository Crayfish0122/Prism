// ============================================================
// action: append_food_rows
// 正式幂等：同一个 request_id 只允许真实写入一次
// meal_daily_raw 预期列：
// 列顺序见 config.gs MEAL_COL
// append_request_log 预期列：
// A request_id, B status, C row_count, D payload_hash,
// E created_at, F finished_at, G note
// ============================================================
function appendFoodRows(body) {
  var spreadsheetId = body.spreadsheet_id;
  var sheetName = body.sheet_name;
  var requestId = safeTrim(body.request_id);
  var rows = body.rows;

  if (!spreadsheetId || !sheetName || !Array.isArray(rows)) {
    throw new Error("缺少必要参数: spreadsheet_id / sheet_name / rows");
  }

  if (!requestId) {
    throw new Error("缺少必要参数: request_id");
  }

  if (!/^\d{8}-\d{6}-[0-9a-f]{4}$/i.test(requestId)) {
    throw new Error("request_id 格式错误，必须是 yyyyMMdd-HHmmss-4hex，如 20250409-143022-a3f1");
  }

  if (rows.length === 0) {
    return {
      ok: true,
      request_id: requestId,
      idempotent_hit: false,
      written_count: 0,
      original_written_count: 0
    };
  }

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("找不到 sheet: " + sheetName);

  var logSheet = ss.getSheetByName(APPEND_REQUEST_LOG_SHEET);
  if (!logSheet) throw new Error("找不到 sheet: " + APPEND_REQUEST_LOG_SHEET);

  var nowStr = formatNowTokyo();
  var payloadHash = computePayloadHash(rows);

  var lock = LockService.getScriptLock();
  lock.waitLock(SCRIPT_LOCK_TIMEOUT_MS);

  try {
    var existing = findAppendRequestLog(logSheet, requestId);

    if (existing) {
      assertRequestPayloadCompatible(existing.payload_hash, payloadHash, requestId);

      if (existing.status === "done") {
        return {
          ok: true,
          request_id: requestId,
          idempotent_hit: true,
          written_count: 0,
          original_written_count: toInt(existing.row_count)
        };
      }

      if (existing.status === "processing") {
        return {
          ok: true,
          request_id: requestId,
          status: "processing",
          idempotent_hit: false,
          written_count: 0,
          original_written_count: 0,
          message: "request_id is already processing"
        };
      }

      if (existing.status === "failed") {
        var repairedCount = countRowsByRequestId(sheet, requestId);
        if (repairedCount > 0) {
          updateAppendRequestLog(logSheet, existing.row_number, {
            status: "done",
            row_count: repairedCount,
            finished_at: nowStr,
            note: "Recovered from existing rows in meal_daily_raw"
          });
          return {
            ok: true,
            request_id: requestId,
            idempotent_hit: true,
            written_count: 0,
            original_written_count: repairedCount
          };
        }
        updateAppendRequestLog(logSheet, existing.row_number, {
          status: "processing",
          note: "Retry after previous failure"
        });
      } else {
        throw new Error("append_request_log 中存在未知 status: " + existing.status);
      }
    } else {
      appendRequestLog(logSheet, {
        request_id: requestId,
        status: "processing",
        row_count: 0,
        payload_hash: payloadHash,
        created_at: nowStr,
        finished_at: "",
        note: ""
      });
      existing = findAppendRequestLog(logSheet, requestId);
      if (!existing) throw new Error("写入 append_request_log 失败");
    }

    try {
      var values = rows.map(function(r, idx) {
        return buildMealDailyRawRow(r, requestId, idx + 1, nowStr);
      });

      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, values.length, values[0].length).setValues(values);
      sheet.getRange(startRow, 1, values.length, 1).setNumberFormat("yyyy-MM-dd");

      updateAppendRequestLog(logSheet, existing.row_number, {
        status: "done",
        row_count: rows.length,
        finished_at: nowStr,
        note: ""
      });

      return {
        ok: true,
        request_id: requestId,
        idempotent_hit: false,
        written_count: rows.length,
        original_written_count: rows.length
      };
    } catch (writeErr) {
      updateAppendRequestLog(logSheet, existing.row_number, {
        status: "failed",
        finished_at: formatNowTokyo(),
        note: truncateText(writeErr.message, 500)
      });
      throw writeErr;
    }
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 幂等辅助函数
// ============================================================
function buildMealDailyRawRow(r, requestId, rowIndex, insertedAt) {
  return [
    r.date || "",
    r.type || "",
    round1(r.kcal),
    round1(r.carb),
    round1(r.protein),
    round1(r.fat),
    r.unit || "",
    r.food || "",
    r.brand || "",
    r.note || "",
    r.source || "",
    r.updated || insertedAt,
    r.scene || "",
    r.intake_time || "",
    requestId,
    requestId + "_" + rowIndex,
    insertedAt
  ];
}

function appendRequestLog(logSheet, entry) {
  var row = [
    entry.request_id || "",
    entry.status || "",
    toInt(entry.row_count),
    entry.payload_hash || "",
    entry.created_at || "",
    entry.finished_at || "",
    entry.note || ""
  ];
  logSheet.getRange(logSheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function findAppendRequestLog(logSheet, requestId) {
  var data = logSheet.getDataRange().getValues();
  if (data.length <= 1) return null;
  for (var i = data.length - 1; i >= 1; i--) {
    if (safeTrim(data[i][0]) === requestId) {
      return {
        row_number: i + 1,
        request_id: safeTrim(data[i][0]),
        status: safeTrim(data[i][1]),
        row_count: data[i][2],
        payload_hash: safeTrim(data[i][3]),
        created_at: safeTrim(data[i][4]),
        finished_at: safeTrim(data[i][5]),
        note: safeTrim(data[i][6])
      };
    }
  }
  return null;
}

function updateAppendRequestLog(logSheet, rowNumber, patch) {
  if (!rowNumber || rowNumber < 2) throw new Error("append_request_log rowNumber 无效");
  var current = logSheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
  var nextRow = [
    patch.request_id !== undefined ? patch.request_id : current[0],
    patch.status !== undefined ? patch.status : current[1],
    patch.row_count !== undefined ? toInt(patch.row_count) : current[2],
    patch.payload_hash !== undefined ? patch.payload_hash : current[3],
    patch.created_at !== undefined ? patch.created_at : current[4],
    patch.finished_at !== undefined ? patch.finished_at : current[5],
    patch.note !== undefined ? patch.note : current[6]
  ];
  logSheet.getRange(rowNumber, 1, 1, nextRow.length).setValues([nextRow]);
}

function countRowsByRequestId(sheet, requestId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var values = sheet.getRange(2, MEAL_COL.request_id, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (safeTrim(values[i][0]) === requestId) count++;
  }
  return count;
}

function computePayloadHash(rows) {
  var canonicalRows = rows.map(function(r) {
    return [
      r.date || "",
      r.type || "",
      round1(r.kcal),
      round1(r.carb),
      round1(r.protein),
      round1(r.fat),
      r.unit || "",
      r.food || "",
      r.brand || "",
      r.note || "",
      r.source || "",
      r.updated || ""
    ];
  });
  var canonical = JSON.stringify(canonicalRows);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function assertRequestPayloadCompatible(existingPayloadHash, currentPayloadHash, requestId) {
  if (existingPayloadHash && currentPayloadHash && existingPayloadHash !== currentPayloadHash) {
    throw new Error("同一个 request_id 对应的 payload 不一致: " + requestId);
  }
}
