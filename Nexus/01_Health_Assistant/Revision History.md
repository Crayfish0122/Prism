## 变更履历

### [v0.1.1] - 2026-04-16

修改

在 Nutrition_Sync.js 新增 findNutritionEvent_ 函数，合并 writebackNutritionEvent_ 和 createNutritionShellEvent_ 内部的事件查找逻辑。两个函数原本各自内联实现了"按 eventId 取事件、失败后按日期兜底"的查找流程，现统一走 findNutritionEvent_ 封装，与 Workout_Sync.js 的 findWorkoutEvent_ 职责对齐。

### [v0.1.0] - 2026-04-13

新增

基于现有代码重写项目文档，覆盖项目概述、数据源与目标、统一写入管道、表结构说明、三条同步线的完整业务流程、日历事件规范和代码组织说明。
