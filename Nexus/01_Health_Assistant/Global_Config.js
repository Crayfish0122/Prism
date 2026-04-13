const CONFIG = {
  TZ: "Asia/Tokyo",

  TARGET: {
    xlsxFileId:               "1m6h6nefuuBYb7Cb_fZ3_LZ7li6gQTS8Y",
    summarySheetName:         "Summarize",
    rawSheetName:             "sleep_daily_raw",
    configSheetName:          "sleep_config",
    openRetryTimes:           8,
    openRetrySleepMs:         1500,
    googleSheetId:            "1GHDKRvSl9p8iLCxYxK1bLmPwPt-3HRWkTpelxgBSJwY",
    workoutRawSheetName:      "workout_daily_raw",
  },

  SUMMARY_COLS: {
    sleepTime:       "sleep_start+wake_time",
    sleepStages:     "InBed|Core|Deep|Rem|",
    sleepResult:     "sleep_result",
    weight:          "weight",
    date:            "date",
    rowKey:          "row_key",
    workoutType:     "WorkoutType",
    workoutDetail:   "WorkoutDetail",
    nutritionTotal:  "nutrition_total",
    workoutFeedback: "WorkoutFeedback",
    nutritionDelta:  "nutrition_delta",
  },

  SLEEP_CONFIG_KEYS: {
    targetSleepMin:          "target_sleep_min",
    debtFloorMin:            "debt_floor_min",
    statusThresholdLightMin: "status_threshold_light_min",
    statusThresholdGoodMin:  "status_threshold_good_min",
    defaultTimezone:         "default_timezone",
    sleepCalendarId:         "sleep_calendar_id",
  },

  NUTRITION_SRC: {
    googleSheetId:            "1kz479GV6gJZ3T1BiAMDSfn13phqAr4m3Q-9JEjwZU6c",
    mealSheetName:            "meal_daily_raw",
    nutritionTargetSheetName: "nutrition_target_config",
  },

  WORKOUT: {
    calendarId:    "3cd7de319e1fb15788ec3e0dcd4ad483f8440550cd6fda1bd1f9adad67139a45@group.calendar.google.com",
    descSeparator: "\n===\n",
  },
};