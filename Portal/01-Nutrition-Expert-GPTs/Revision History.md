## 变更履历

### [v1.1.0] - 2026-04-12

新增
新增 Cloudflare Worker 网关入口，对外提供 /read 与 /write 两个 POST 路径，用于承接 GPT Action 请求并转发至同一个 GAS Web App。
新增只读 action：get_day_type、get_today_intake_summary、get_user_vocab，用于训练日判断、当日摄入汇总和用户词典读取。
新增写入 action：append_food_rows、upsert_user_vocab，用于饮食记录落表和用户词典写入。
新增 Google Calendar + Google Sheets 统一业务入口，由 GAS doPost 基于 action 进行分发处理。

修改
修改 GPT Action 接口定义，按读写场景拆分 ReadRequest 与 WriteRequest，并通过 bearerAuth 统一进行外部鉴权。
修改配置管理方式，集中维护 Asia/Tokyo 时区、append_request_log 表名，以及 meal_daily_raw、append_request_log、user_vocab 的列映射。
修改饮食记录系统规则，明确 GS 基线 + Chat 增量口径、初始化读取顺序、写入授权边界、输出表头格式和训练联动规则。

修复

修复 append_food_rows 的重复写入风险，增加 request_id 幂等控制，限制同一 request_id 只允许真实写入一次。
修复重试场景下一致性问题，为 append_food_rows 增加 payload_hash 校验，阻止同一 request_id 对应不同 payload。
修复并发写入风险，为 append_food_rows 增加 Script Lock，避免并发重复落表。
修复 GAS 302 跳转回包处理，为 Worker 增加 redirect 手动跟随和可信 host 白名单校验，拒绝非 https 与非 google.com / googleusercontent.com 的跳转地址。