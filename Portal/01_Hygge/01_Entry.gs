// ============================================================
// 统一入口：GAS Web App — Training Calendar + Food Log
// 部署方式：发布为 Web App，执行身份选"我"，访问权限选"任何人"
// 认证方式：URL 参数 ?secret=YOUR_SECRET_KEY
// ============================================================

// ===== 配置（全部从 Script Properties 读取） =====
function getSecretKey() {
  var key = PropertiesService.getScriptProperties().getProperty("SECRET_KEY");
  if (!key) throw new Error("SECRET_KEY not set in Script Properties");
  return key;
}

function getTrainingCalendarId() {
  var id = PropertiesService.getScriptProperties().getProperty("TRAINING_CALENDAR_ID");
  if (!id) throw new Error("TRAINING_CALENDAR_ID not set in Script Properties");
  return id;
}

// ===== 统一入口 =====
function doPost(e) {
  var body;
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Empty request body" });
    }
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" });
  }

  var secret = body._gateway_secret;
  delete body._gateway_secret;
  if (secret !== getSecretKey()) {
    return jsonResponse({ ok: false, error: "Unauthorized" });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: "Request body must be a JSON object" });
  }

  var action = body.action;
  try {
    if (action === "get_day_type") return jsonResponse(getDayType(body));
    else if (action === "append_food_rows") return jsonResponse(appendFoodRows(body));
    else if (action === "get_today_intake_summary") return jsonResponse(getTodayIntakeSummary(body));
    else if (action === "get_user_vocab") return jsonResponse(getUserVocab(body));
    else if (action === "upsert_user_vocab") return jsonResponse(upsertUserVocab(body));
    else return jsonResponse({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse(buildErrorPayload(err, action));
  }
}

function doGet(e) {
  return jsonResponse({
    ok: true,
    message: "GAS is alive. Business actions must go through Worker POST /read or /write."
  });
}

function buildErrorPayload(err, action) {
  return {
    ok: false,
    action: action || "",
    error: String(err && err.message ? err.message : err),
    error_name: String(err && err.name ? err.name : "Error"),
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
