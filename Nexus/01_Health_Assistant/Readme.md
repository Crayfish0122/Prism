# Health Assistant

## 项目概述

Health Assistant 是整套个人管理系统中负责健康数据处理的 GAS 中间层。前端通过 GPTs 和 Claude 输入数据，暂存在 Google Calendar 和 Google Sheet，由本层完成解析、聚合与同步，最终写入后端 xlsx 数据库供 Python 处理和 Telegram 输出。

它从 Apple Health、Google Calendar、饮食记录表三个来源收集数据，统一写入一个 xlsx 文件和对应的 Google Sheet，同时在三个专用日历上维护可视化事件，形成一套覆盖睡眠、体重、健身、营养四个维度的每日健康追踪体系。

## 数据源与目标

数据源：
- Apple Health：通过 Webhook 推送睡眠阶段数据（Core、Deep、REM、InBed）和体重数据
- 健身日历：用户在日历事件中手写的训练 feedback
- 饮食记录表：由 Portal/01_Hygge 系统维护的 meal_daily_raw 表（Google Sheet ID: 1kz479GV6gJZ3T1BiAMDSfn13phqAr4m3Q-9JEjwZU6c）

目标存储：
- 主文件：xlsx（Drive File ID: 1m6h6nefuuBYb7Cb_fZ3_LZ7li6gQTS8Y）
- 镜像：Google Sheet（ID: 1GHDKRvSl9p8iLCxYxK1bLmPwPt-3HRWkTpelxgBSJwY）
- 三个 Google Calendar：睡眠日历、健身日历、营养日历

xlsx 和 Google Sheet 始终保持一致，由统一写入管道保证。

## 统一写入管道

所有写入操作都经过同一个三步流程：

1. 把目标 xlsx 复制为临时 Google Sheet
2. 在临时表上执行所有读写操作
3. 将临时表导出为 xlsx 覆盖回原文件，同时将临时表内容同步到镜像 Google Sheet，最后删除临时表

这个管道确保 xlsx 和 Google Sheet 数据始终一致，且写入过程中出错不会污染原文件。三条同步线各自独立调用这个管道。

## 目标文件的表结构

Summarize —— 主汇总表，每日一行，汇聚所有维度的数据。列包括日期、睡眠时间段、睡眠阶段明细、睡眠结果、体重、训练类型、训练计划、训练 feedback、营养总量、营养差值、营养 feedback 等。列名通过 getColMapFromHeader 读取表头，统一转小写后通过 colOf_ 引用，不硬编码列号。

sleep_daily_raw —— 睡眠原始数据表，每日一行。16 列，包含 row_key、日期、就寝时间、起床时间、在床时长、Core/Deep/REM 各阶段分钟数、实际睡眠总分钟数、有效标记、睡眠债务增量、睡眠债务累计、状态判定、日历事件 ID、日历同步标记、更新日期。

sleep_config —— 睡眠配置表，键值对格式。包含目标睡眠时长、债务地板值、轻度不足和达标的阈值、默认时区、睡眠日历 ID。

workout_daily_raw —— 健身事件追踪表，每日一行。5 列：row_key、日期、日历事件 ID、同步标记、更新日期。

nutrition_daily_raw —— 营养事件追踪表，结构与 workout_daily_raw 相同。

nutrition_target_config —— 营养目标配置表（位于饮食记录源表中），按日期和类型（training/rest）记录 kcal、carb、protein、fat 的目标值。

## 三条同步线

### 睡眠与体重同步（Health_SleepWeight_Sync.js）

入口：doGet / doPost，由 Apple Health 通过 Webhook 触发。

睡眠处理流程：接收文本行格式的睡眠阶段数据（每行包含类型、开始时间、结束时间），按起床日期聚合为每日记录。写入 sleep_daily_raw 时，先按 row_key 查找或插入行，然后填入所有阶段数据。写入后触发 recalc，从当前行开始向下重算睡眠债务链（debt_delta 和 debt_total 是累计值，任何一行的修改都需要级联更新后续行）。最后同步到 Summarize 表的三个睡眠列（时间段、阶段明细、结果），并在睡眠日历上创建或更新事件。

睡眠状态判定：实际睡眠分钟数 >= good 阈值（默认 420）为"达标"，>= light 阈值（默认 360）为"轻度不足"，其余为"明显不足"。

体重处理流程：接收体重数值和日期，直接写入 Summarize 表对应日期行的 weight 列。

睡眠和体重可以在同一次请求中同时提交，脚本会分别处理并合并写入。

### 健身同步（Health_Workout_Sync.js）

入口：HealthWorkoutSync()，由定时触发器调用。

分两步执行：

Step 1 回写昨天的 feedback：从健身日历找到昨天的事件，读取 description 中分隔符（\n===\n）之后的 feedback 部分，写入 Summarize 表的 WorkoutFeedback 列。同时将 Summarize 表中的 nutrition_total 补写到事件 description 的 plan 段开头。

Step 2 生成今天的事件：从 Summarize 表读取今天的 WorkoutType 和 WorkoutDetail，在健身日历上创建全天事件。事件标题格式为"WorkoutType 日期"，description 包含训练计划内容和分隔符。如果已有旧事件且内容一致则跳过，内容变更则删旧建新。

### 营养同步（Health_Nutrition_Sync.js）

入口：HealthNutritionSync()，由每日 03:00 JST 定时触发器调用。目标日期为前一天。

处理流程：从饮食记录源表的 meal_daily_raw 读取前一天所有行，聚合 kcal、carb、protein、fat 的实际摄入总量。从 Summarize 表通过 WorkoutFeedback 列判断是否训练日（feedback 以"训练日"开头则为训练日），据此从 nutrition_target_config 读取对应的目标值。计算 total（实际值）和 delta（实际值 - 目标值，负数用括号表示），写入 Summarize 表的 nutrition_total 和 nutrition_delta 列。

营养日历事件管理：回写前一天的营养事件，将 total 和 delta 写入事件 description 的 plan 段，并将用户手写的 feedback 回写到 Summarize 的 NutritionFeedback 列。然后为当天创建空壳营养事件（标题格式"营养 日期"，description 只包含分隔符），供用户后续填写 feedback。

## 日历事件规范

三个日历的事件 description 都遵循统一格式：plan 段 + 分隔符（\n===\n）+ feedback 段。plan 段由脚本自动填写，feedback 段由用户手动在日历里编辑。脚本在回写时只读取 feedback 段，不覆盖用户填写的内容。

事件的写入统一遵循以下流程：有旧 eventId 就先比较内容，一致则跳过，不一致则删旧建新；没有旧 eventId 就直接创建。eventId 始终记录在对应的 raw 表中。

## 代码组织

Global_Config.js —— 所有字符串常量集中管理，包括文件 ID、表名、列名、日历 ID、配置键名。

Common_Utils.js —— 纯工具函数，不含业务逻辑。涵盖日志追踪（traceId 体系）、日期解析与格式化、类型转换、Sheet 操作（列映射、行查找与插入、Summarize 行定位）、Drive 操作（复制、导出、覆盖、临时表同步）、HTTP 响应构建。

Health_SleepWeight_Sync.js —— 睡眠与体重的 Webhook 入口和全部业务逻辑。

Health_Workout_Sync.js —— 健身日历同步的全部业务逻辑。

Health_Nutrition_Sync.js —— 营养数据同步的全部业务逻辑。

## 变更履历

### [v0.1.0] - 2026-04-13

新增

基于现有代码重写项目文档，覆盖项目概述、数据源与目标、统一写入管道、表结构说明、三条同步线的完整业务流程、日历事件规范和代码组织说明。

建立变更履历章节，采用倒序排列，记录后续所有功能、逻辑、接口、文档层面的变更。
