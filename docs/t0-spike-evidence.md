# T0 Spike 证据与执行记录

> 状态：本地静态证据已采集；`t0-probe` 已按第七轮定向意见修订，**待复审**；CloudBase 动态证据仍待执行，且必须在探针复审通过并取得测试环境登录态后进行
> 基线：`wx-server-sdk 4.0.2`，`@cloudbase/node-sdk 3.17.2`
> 执行入口：`docs/t0-probe-runbook.md`

## 1. 已完成：本地静态证据

执行目录：`wechat-miniprogram/cloudfunctions/bakery`

### 1.1 依赖树

```text
xiaoyu-bakery-cloud-function@1.0.0
└─┬ wx-server-sdk@4.0.2
  └─┬ @cloudbase/node-sdk@3.17.2
    ├─┬ @cloudbase/database@1.4.3
    │ ├── lodash.set@4.3.2
    │ └── lodash.unset@4.5.2
    └── axios@0.27.2
```

### 1.2 SDK require 冒烟

`node -e "require('wx-server-sdk')"` 通过：

- 版本：4.0.2
- `database`：function
- `getWXContext`：function

### 1.3 axios/lodash 可达性静态定位

- `@cloudbase/node-sdk/dist/utils/metadata.js`：`axios.get(http://metadata.tencentyun.com/...)`，用于云环境元数据查询；
- `@cloudbase/node-sdk/dist/cloudbase.js`：将 axios 实例注入 SDK HTTP 请求器；
- `@cloudbase/database/dist/commonjs/realtime/virtual-websocket-client.js`：使用 `lodash.set/lodash.unset` 处理实时数据库变更事件；
- 本仓库云函数源码无直接 `require("axios")`、`lodash.set`、`lodash.unset`。


### 1.4 静态前置发现：事务内 `where().update()` 路径存疑

`wx-server-sdk@4.0.2` 内部 `@cloudbase/database@1.4.3` 的 `Query.update()` 发送 `database.modifyDocument` 时**未携带 `transactionId`**；同一文件内 `DocumentReference.update()` 和 `Query.get()` 会携带。该问题已写入 `t0-probe` 的 `preflight` 动作：

- `official-doc`：全程使用公开 `tx.collection().doc().get/update()`，作为 T0 正式通过与生产协议可行性的基础；
- `official-where`：验证 `transaction.collection().where().update()` 的回滚与兼容行为，只作诊断；
- `raw-diagnostic`：SDK 私有事务请求，只作问题定位；不得成为生产协议实现候选；
- T0-D01/D02/D04/D09 的正式动态结论只接受 `official-doc` 路径，在形成处置结论前不得冻结 T0。
结论：业务代码未直接调用受影响 API；漏洞是否在 `cloud.init/cloud.database` 实际路径触发，仍需 CloudBase 测试环境动态验证。

## 2. 待执行：独立 T0 probe（不实现正式 `payment.create`）

动态验证使用**独立、临时的 `t0-probe` 云函数**，不接页面、不写正式业务入口、不部署到生产环境。正式 `payment.create` 仍属于 P1；T0 只验证其依赖的底层原语。

### 2.1 probe 位置与生命周期

- 临时位置：`wechat-miniprogram/cloudfunctions/t0-probe/`；
- 部署环境：微信云开发测试环境（环境 ID 在证据中脱敏记录）；
- 生命周期：T0 spike 完成、证据归档后删除 `t0-probe`，不在正式云函数列表保留；
- 执行前保存：`t0-probe` 源码快照或提交哈希、云函数配置、触发器定义、索引定义；测试数据统一使用 `t0probe_` 前缀，并维护删除清单。

### 2.2 验证对象

验证对象写成 **`activePaymentAttemptId + version` 槽位原语**，不是正式 `payment.create`。每条证据标注对应 `evidenceId`。

- [ ] `T0-D01` 两个并发 probe 请求抢占同一订单槽位：只有一个事务把 `activePaymentAttemptId` 指向新记录，另一个请求重试后读到同一槽位标识；
  - [ ] `T0-D01-BARRIER`：独立 action 在 arm 屏障前完成订单种子创建，`participants >= 2`，按不同 caller 原子计数，无请求内补种/初始化/重置窗口；
  - [ ] `T0-D01-VERIFY`：汇总校验只有一个 active attempt、一个 `merchantOrderNo`，且与订单槽位一致；
- [ ] `T0-D02` 槽位旧记录失效 + 创建新槽位记录，在同一订单版本事务内完成；
- [ ] `T0-D03` 失效槽位记录仍可被“迟到终态写入”命中并按记录主键更新（模拟 inactive 回调）；
- [ ] `T0-D04` `_id + version` 条件更新 + `_.inc(1)`：并发两个更新只有一个 `updated=1`；
- [ ] `T0-D05` 唯一索引冲突导致事务失败并可重试；
- [ ] `T0-D06` 事务读写预算与上限实测：`budgetPass` 单独证明项目预算 40 可执行；`limitCharacterized` 仅在观察到成功边界与首个失败边界后成立，搜索封顶不得记为上限确认；
- [ ] `T0-D07` `db.serverDate()` 在事务内一致性；
- [ ] `T0-D08` 最后部署独立最小 `t0-probe-timer`，只接受精确官方四字段事件并写幂等 marker；以平台真实触发日志与触发器配置为主证据、数据库 marker 为佐证；主函数伪造 Timer 字段即使带 operator token 也因未知输入键被拒绝；
- [ ] `T0-D09` `task_leases` 获取/续租条件更新：`updated=1` 校验、旧 `ownerId` 不能覆盖新租约；
- [ ] `T0-D10` 复合索引查询计划：
  - `orders(customerOpenId, status, createdAt, _id)`；
  - `orders(status, expiresAt, paymentCheckDueAt)`；
  - `payment_attempts(terminal, channelStatus, settlementState, settlementReviewState, settlementNextRetryAt)`；
  - 每次 action 使用独立稳定种子，时间样本远离执行窗口，断言不依赖 setup 后的经过时间；
- [ ] `T0-D11` VPC/出口限制/WAF 在微信云开发环境的可用性验证；
- [ ] `T0-D12` 事务/查询输入构造 `__proto__/constructor` 的回归样本；若观察到污染，先保存带请求 ID 的结构化安全日志，再销毁实例并验证后续请求运行于干净实例；
- [ ] 失败路径同样记录证据，并标注最终选择：替代方案或回写协议。


### 2.3 probe 就绪状态

- 代码：`wechat-miniprogram/cloudfunctions/t0-probe/`（`index.js`、`lib/gate.js`、`lib/runtime.js`、`lib/db.js`、`lib/probes.js`）
- 门禁：`T0_PROBE_ENABLED` + `T0_PROBE_ENV_ID` + `T0_PROBE_OPERATOR_TOKEN` 三因子，action 输入白名单，D11 固定端点；主函数不接受 Timer 字段，未通过门禁不发生任何数据库写操作
- lockfile：`package-lock.json` 已生成，`wx-server-sdk@4.0.2`，实际安装树 `@cloudbase/node-sdk@3.17.2`、`@cloudbase/database@1.4.3`
- 配置：`indexes.json`（4 条临时索引清单）、`cloudbaserc.example.json`（超时/内存/门禁环境变量模板）；独立 `t0-probe-timer` 模板保持 `T0_PROBE_ENABLED="false"` 的 fail-closed 默认值，只在临时部署配置中开启，并与每 5 分钟触发器一起于其他动态动作完成后部署；主云函数超时 60 秒
- 操作说明：`wechat-miniprogram/cloudfunctions/t0-probe/README.md`
- 执行 runbook：`docs/t0-probe-runbook.md`
- 本地验证：`node --check` 通过全部 probe 源文件；`npm test`/lint/diff 基线在动态执行前仍须复跑
- 执行顺序：部署主函数且不开 Timer → `status` → `setup` 创建集合/种子 → 建索引并等待 ready → `preflight` → D01–D07/D09–D12 → 最后部署独立 Timer 函数验证 D08 → cleanup
- 状态：等待第七轮定向修订复审；在复审通过并取得测试环境登录态前，T0-D01–T0-D12 均标记为“待执行”，不产生动态通过/失败结论。
P1 实施正式 `payment.create` 后，再补跑“两个并发 create 返回同一 `merchantOrderNo`”和“A 过期失效 → 创建 B → B 成功 → A 迟到成功”的正式行为测试。

## 3. 结果记录规则

每项动态证据必须记录：

- `evidenceId`：对应 §2.2 的 `T0-Dxx` 条目；
- `t0-probe` 源码快照或提交哈希；
- 云函数配置、触发器定义、索引定义；
- 环境 ID（可脱敏）；
- 执行时间与执行人；
- 实际 SDK 版本（`wx-server-sdk`、`@cloudbase/node-sdk`）；
- 请求 ID / 云函数日志检索 ID；
- 输入参数、原始返回值或关键日志；
- 通过/失败/部分通过；
- 测试数据前缀与删除清单；
- 清理结果：临时集合、`t0-probe` 云函数、索引是否删除；
- 失败项不删除、不跳过：明确采用替代方案还是修改协议。

全部通过且安全审计形成处置结论后，才允许冻结 T0 并提交专项文档与 lockfile。

## 4. 动态证据台账（执行后回填）

| evidenceId | 状态 | 源码快照/哈希 | 环境 ID（脱敏） | 执行时间/人 | SDK 版本 | 请求 ID/日志检索 ID | 输入参数 | 原始返回/关键日志归档 | 通过/失败/部分 | 数据前缀与删除清单 | 清理结果 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T0-D00-前置 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D01 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D01-BARRIER | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D01-VERIFY | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D02 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D03 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D04 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D05 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D06 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D07 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D08 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D09 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D10 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D11 | 待执行 |  |  |  |  |  |  |  |  |  |  |
| T0-D12 | 待执行 |  |  |  |  |  |  |  |  |  |  |

动态证据未执行前，本表只允许出现“待执行”；任何通过/失败结论必须附带原始返回归档路径。
