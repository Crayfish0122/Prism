### [v0.1.1] - 2026-04-16

修改

在 Nutrition_Sync.js 新增 findNutritionEvent_ 函数，合并 writebackNutritionEvent_ 和 createNutritionShellEvent_ 内部的事件查找逻辑。两个函数原本各自内联实现了"按 eventId 取事件、失败后按日期兜底"的查找流程，现统一走 findNutritionEvent_ 封装，与 Workout_Sync.js 的 findWorkoutEvent_ 职责对齐。

