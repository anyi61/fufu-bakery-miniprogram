# t0-probe（T0 临时探针，证据归档后删除）

临时云函数，只服务于 `docs/t0-spike-evidence.md` 的动态证据采集。不接页面、不写正式业务入口、不进入正式云函数列表。

- 依赖锁定：`wx-server-sdk@4.0.2`
- 测试数据前缀：`t0probe_`
- 临时集合：`t0probe_orders`、`t0probe_attempts`、`t0probe_cond_update`、`t0probe_unique_conflict`、`t0probe_tx_limit`、`t0probe_server_date`、`t0probe_timer_log`、`t0probe_task_leases`、`t0probe_barriers`、`t0probe_pollution`、`t0probe_meta`

## 0. 安全门禁（默认拒绝）

云函数在**任何数据库写操作前**执行门禁：

- `T0_PROBE_ENABLED` 必须为 `"true"`；
- `T0_PROBE_ENV_ID` 必须配置且与事件 `envId` 一致；运行时可获取到当前环境 ID 时也必须一致；
- `T0_PROBE_OPERATOR_TOKEN` 至少 16 字符，且事件 `operatorToken` 必须常量时间比较一致；
- 每个 action 只接受白名单输入键；`runId/key/caller/participants/maxSearch/maxRetries/leadMs/marker/samples` 有长度、范围和字符集限制；
- `d11` 端点固定为白名单，禁止调用方传入 URL；
- 主 `t0-probe` 不提供 Timer 分支；`Type/TriggerName/Message/Time` 属于未知输入键，即使携带 operator token 也会被拒绝；
- 门禁失败直接返回 `status: "denied"`，不初始化数据库、不执行任何写操作。

`cloudbaserc.example.json` 中已给出三项环境变量模板；执行时建议：

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

生成一次性 operator token，执行结束后删除或轮换。

## 1. 部署前检查

1. 微信云开发**测试环境**已创建，微信开发者工具/CloudBase CLI 已登录；
2. 云函数根目录 `wechat-miniprogram/cloudfunctions/` 中能识别 `t0-probe`；
3. 云函数超时时间 ≥ 60 秒、内存 512 MB；
4. 部署前保存：`t0-probe` 源码快照/提交哈希、云函数配置、触发器定义、索引定义；
5. 固定顺序：部署主函数且不开 Timer → `status` → `setup` 创建集合/种子 → 创建索引并等待 ready → `preflight` → D01–D07/D09–D12 → 最后部署独立最小 `t0-probe-timer` 验证 D08 → cleanup。

## 2. 动作清单

| action | evidenceId | 说明 |
|---|---|---|
| `status` | T0-SDK | 门禁通过后打印 SDK 依赖版本、Node 版本、脱敏上下文 |
| `preflight` | T0-D00-前置 | 分别记录 `official-doc`（公开 doc API、正式路径）、`official-where`（兼容诊断）和 `raw-diagnostic`（私有接口诊断）；正式通过只依赖 `official-doc` |
| `setup` | T0-SETUP | 创建集合并写入 Date 类型基线文档；区分“已存在”和真实失败 |
| `barrier` | T0-D01-BARRIER | **提前**创建 D01 订单种子并准备并发屏障；`participants>=2` 且按不同 caller 去重 |
| `d01` | T0-D01 | 槽位抢占；应用级有上限重试；两请求最终需返回同一 active attempt |
| `d01_verify` | T0-D01-VERIFY | 汇总校验：只允许一个 active attempt、一个 merchantOrderNo，且与订单槽位一致 |
| `d02` | T0-D02 | 旧尝试失效 + 新槽位记录同事务；`rollback=true` 单独校验全部写入回滚 |
| `d03` | T0-D03 | inactive 尝试迟到终态写入可按主键命中，且不清除新槽位 |
| `d04` | T0-D04 | direct 模式要求更新计数 `[0,1]`；transaction 模式要求双请求均成功且最终 value=2/version=3 |
| `d05` | T0-D05 | 唯一索引冲突；错误必须包含 `merchantOrderNo` 且为 duplicate/unique 信号 |
| `d06` | T0-D06 | 分开输出项目预算 `budgetPass` 与平台上限 `limitCharacterized`；搜索封顶不能算上限确认 |
| `d07` | T0-D07 | `db.serverDate()` 四文档、字段完整、时间差 ≤ 2s 且落在客户端窗口 |
| `d08` | T0-D08 | 主函数手工调用仅为 `manual-smoke` 且不通过；真实 Timer 由最后部署的独立最小函数验证 |
| `d09` | T0-D09 | 租约获取/续租/旧 owner 不可覆盖/到期边界；断言读回字段为 Date |
| `d10` | T0-D10 | 每次创建独立稳定种子并执行三条复合索引查询；固定断言预期 ID、数量和顺序，结果不依赖 setup 后的耗时 |
| `d11` | T0-D11 | 固定端点出口探测 + 脱敏环境信息；控制台补 VPC/WAF/出口限制证据 |
| `d12` | T0-D12 | `__proto__/constructor` 回归；先写带请求 ID 的结构化安全日志，再以销毁实例与后续干净实例检查形成证据 |
| `cleanup` | T0-CLEANUP | 分页删除至集合为空；bulkError、删除失败、最终计数非零均不通过 |

## 3. D01 并发执行（必须先准备 barrier）

```json
{ "action": "barrier", "key": "race-001", "participants": 2, "leadMs": 5000 }
```

然后并发两个独立请求：

```json
{ "action": "d01", "key": "race-001", "caller": "A", "participants": 2, "method": "official-doc", "maxRetries": 5 }
{ "action": "d01", "key": "race-001", "caller": "B", "participants": 2, "method": "official-doc", "maxRetries": 5 }
```

最后汇总校验：

```json
{ "action": "d01_verify", "key": "race-001" }
```

三条事务路径的边界固定为：`official-doc` 是公开 API 正式证据路径；`official-where` 只做兼容性诊断；`raw-diagnostic` 只定位 SDK 问题。后两者都不能成为生产协议实现候选。

## 4. D08 独立 Timer 证据

CloudBase 原生 Timer 无法安全注入 secret `Message`，因此不在主函数中设置 Timer 路径。完成 D01–D07/D09–D12 后再部署独立最小 `t0-probe-timer`：它只接受精确的官方四字段 `{Message:"", Time, TriggerName:"t0probe-timer", Type:"Timer"}`、拒绝额外字段，并只写幂等 `t0probe_timer_log` marker。独立函数模板保持 `T0_PROBE_ENABLED="false"` 的 fail-closed 默认值，执行人只能在临时本地部署配置中改为 `"true"`。D08 以平台真实触发日志和触发器配置为主证据，数据库 marker 只作佐证；主函数中伪造 Timer 字段的调用即使携带 operator token 也必须被拒绝。

## 5. 结果记录规则

逐项记录 `docs/t0-spike-evidence.md` §3 要求的字段。失败项不删除、不跳过。
