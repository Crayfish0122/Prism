// ============================================================
// action: get_day_type
// ============================================================
function getDayType(body) {
  var dateStr = body.date;
  var timezone = body.timezone || DEFAULT_TIMEZONE;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("date 格式错误，必须是 YYYY-MM-DD");
  }
  var parts = dateStr.split("-");
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1;
  var day = parseInt(parts[2], 10);
  var startDate = new Date(year, month, day, 0, 0, 0);
  var endDate = new Date(year, month, day + 1, 0, 0, 0);
  var calendar = CalendarApp.getCalendarById(getTrainingCalendarId());
  if (!calendar) throw new Error("找不到日历，请确认 TRAINING_CALENDAR_ID 是否正确，且该日历已共享给此 GAS 账号");
  var events = calendar.getEvents(startDate, endDate);
  var hasEvent = events.length > 0;
  var trainingEvent = null;
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle().indexOf("训练日") === 0) {
      trainingEvent = events[i];
      break;
    }
  }
  var isTraining = trainingEvent !== null;
  var workoutDetail = isTraining ? (trainingEvent.getDescription() || null) : null;
  return {
    ok: true,
    date: dateStr,
    timezone: timezone,
    has_event: hasEvent,
    day_type: isTraining ? "training" : "rest",
    workout_detail: workoutDetail
  };
}
