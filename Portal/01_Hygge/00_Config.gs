// ===== 集中配置 =====

var DEFAULT_TIMEZONE = "Asia/Tokyo";
var APPEND_REQUEST_LOG_SHEET = "append_request_log";
var SCRIPT_LOCK_TIMEOUT_MS = 30000;

// ----- meal_daily_raw 列映射（1-based） -----
var MEAL_COL = {
  date: 1,
  type: 2,
  kcal: 3,
  carb: 4,
  protein: 5,
  fat: 6,
  unit: 7,
  food: 8,
  brand: 9,
  note: 10,
  source: 11,
  updated: 12,
  scene: 13,
  intake_time: 14,
  request_id: 15,
  row_id: 16,
  inserted_at: 17
};
var MEAL_COL_COUNT = 17;

// ----- append_request_log 列映射（1-based） -----
var LOG_COL = {
  request_id: 1,
  status: 2,
  row_count: 3,
  payload_hash: 4,
  created_at: 5,
  finished_at: 6,
  note: 7
};
var LOG_COL_COUNT = 7;

// ----- user_vocab 列映射（1-based） -----
var VOCAB_COL = {
  phrase: 1,
  food: 2,
  kcal: 3,
  carb: 4,
  protein: 5,
  fat: 6,
  unit: 7,
  note: 8
};
var VOCAB_COL_COUNT = 8;