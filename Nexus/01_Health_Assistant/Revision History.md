## 变更履历

### [v0.1.2] - 2026-04-16

修改

在 Utils.js 重构 getYesterdayInTz，改为调用 getTodayInTz 和 addDays 组合实现，消除与 getTodayInTz 函数体重复的日期构造代码。

在 Workout_Sync.js 新增 getSummaryCellByDate_ 通用函数，合并 getWorkoutTypeFromSummary_ 和 getWorkoutDetailFromSummary_ 两个结构相同的读取函数。列名从函数内部提到调用方作为参数传入，readbackWorkoutFeedback_ 和 syncWorkoutCalendar_ 的三处调用同步更新。

在 Utils.js 新增 parseYmdToDate_ 工具函数，封装 yyyy-MM-dd 字符串到本地零点 Date 对象的解析。Workout_Sync.js 的 createWorkoutEvent_、findWorkoutEvent_、findWorkoutEventByExactTitle_ 以及 Nutrition_Sync.js 的 createNutritionShellEvent_、findNutritionEventByDate_ 共五处调用已替换，endOfDay 统一改用 addDays 计算。

### [v0.1.1] - 2026-04-16

修改

在 Nutrition_Sync.js 新增 findNutritionEvent_ 函数，合并 writebackNutritionEvent_ 和 createNutritionShellEvent_ 内部的事件查找逻辑。两个函数原本各自内联实现了"按 eventId 取事件、失败后按日期兜底"的查找流程，现统一走 findNutritionEvent_ 封装，与 Workout_Sync.js 的 findWorkoutEvent_ 职责对齐。

### [v0.1.0] - 2026-04-13

新增

基于现有代码重写项目文档，覆盖项目概述、数据源与目标、统一写入管道、表结构说明、三条同步线的完整业务流程、日历事件规范和代码组织说明。
