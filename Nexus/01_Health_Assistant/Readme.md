# GAS 健康数据同步项目背景

这个项目是一个运行在 Google Apps Script 上的个人健康数据同步系统，把来自 Apple Health 的睡眠、体重、健身数据整合到一个 Excel 文件（xlsx）和 Google Sheet 里统一管理。

## 数据流向

所有写入都经过同一个三步管道：先把目标 xlsx 复制成临时 Google Sheet，在临时表上做修改，然后导出覆盖回原始 xlsx 并同步到 Google Sheet，最后删除临时表。这个流程保证了 xlsx 和 Google Sheet 始终保持一致。

## 三条同步线

睡眠和体重走同一个 Webhook 入口（`doGet` / `doPost`）。Apple Health 把睡眠阶段数据（Core、Deep、REM、InBed）以文本行格式 POST 过来，脚本解析后写入 `sleep_daily_raw` 表，计算睡眠债务，更新 `Summarize` 表，并在睡眠日历上创建或更新事件。体重数据同样通过 Webhook 接收，直接写入 `Summarize` 表对应日期行。

营养同步每天 03:00 JST 由定时触发器自动执行，从另一个 Google Sheet 读取当天实际摄入，对比训练日/休息日的目标值，把 total 和 delta 写入 `Summarize` 表。

健身同步负责两件事：回写前一天日历事件里用户填写的 feedback 到 `Summarize` 表，以及为今天在健身日历上创建全天事件（包含训练计划内容）。

## 代码组织原则

- 所有纯工具函数集中在 `Common_Utils.js`，业务文件只包含业务逻辑
- 列名通过 `getColMapFromHeader` 读取并统一转为小写，通过 `colOf_` 引用，避免硬编码列号
- 所有字符串常量（表名、列名、日历 ID、配置键名）集中在 `Global_Config.js`
- 日历事件的写入遵循统一流程：有旧 eventId 就先比较内容，一致则跳过，不一致则删旧建新，没有旧 eventId 就直接创建

## 已知待处理事项

- `CONFIG.WEIGHT` block 已废弃（早期设计为从独立 Sheet 读取体重，后改为 Webhook 直接接收），文档中删除即可，`Global_Config.js` 无需补充
- `parseDateHm_` 函数是 `backfillSleepCalendarEvents`（已删除的一次性历史修复工具）的残留死代码，待从 `Health_SleepWeight_Sync.js` 中删除

## 相关资源

- HealthData Google Sheet: `1GHDKRvSl9p8iLCxYxK1bLmPwPt-3HRWkTpelxgBSJwY`
