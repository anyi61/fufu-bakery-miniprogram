# 订单并发与结算协议（T0 冻结稿）

> 状态：T0 草案 v0.6，随 `wechat-trial-run-dev-plan.md` v0.6 一并评审；第五轮意见已定向修订
> 配套文档：`docs/inventory-ledger-model.md`、`docs/t0-sdk-security-audit.md`、`docs/t0-spike-evidence.md`
> 本协议只规定设计，不替代 T0 SDK/事务最小验证与安全审计。

## 1. 目标与非目标

目标：

- 消除“支付终态已落库但订单未结算”的崩溃窗口；
- 让取消、超时、支付回调/查单通过同一结算入口收敛，且可重跑；
- 让超时批处理不被未决支付订单无限重复命中；
- 让取货码只生成一次、可恢复、不可重放；
- 让事务内异常与事务外告警分离，审计只记真实成功转换。

非目标：

- 真实微信支付 provider 的接入（仍在 P3）；
- 多门店/跨店库存（账本模型已预留 `storeId`，P1 只启用单店）；
- demo 模式证明跨设备并发原子性。

## 2. 状态字段

### 2.1 订单文档新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | number | 业务版本；正式事务路径使用公开 `tx.doc(id).get()` 读取并校验版本，再以 `tx.doc(id).update()` 递增；并发写冲突由事务提交检测与有界重试收敛 |
| `activePaymentAttemptId` | string/null | 当前允许复用的支付尝试槽位；与支付尝试创建/失效在同一订单版本事务内变更 |
| `settlementState` | string | `unsettled / paid_settled / released_cancelled / released_timeout / paid_refund_pending` |
| `orderSettledAt` | string/null | 结算事务提交时间 |
| `paymentCheckDueAt` | string/null | 下一次允许服务端查单的时间 |
| `lastPaymentCheckAt` | string/null | 最近一次服务端查单时间 |
| `paymentCheckRetryCount` | number | 未决支付查单次数 |
| `timeoutSweepState` | string | `none / checking / awaiting_payment_check / manual_review` |
| `pickupCodeEnvelope` | object/null | 支付结算事务中生成一次，版本化 AES-GCM envelope（§3.1） |
| `pickupCodeHash` | string/null | 规范化取货码 SHA-256，仅用于核销比对 |
| `pickupCodeGeneratedAt` | string/null | 生成时间 |
| `refundTaskIds` | array | 该订单全部退款/异常任务引用；同一订单可能因多笔成功扣款产生多个任务 |

不变量：

- `settlementState = unsettled` 当且仅当对应 `order_reservations.state = reserved`；
- `settlementState = paid_settled` 当且仅当预占已结算为已售；
- `settlementState = released_*` 当且仅当预占已释放；
- `settlementState = paid_refund_pending` 表示已扣款但订单关闭，库存已释放，等待退款；
- `activePaymentAttemptId` 只控制 `payment.create` 的创建与复用，**不是回调授权条件**；
- `activePaymentAttemptId` 非空时必须指向存在的尝试；若该尝试进入终态，写终态事务必须同事务条件清空或替换槽位，禁止留下“槽位指向 terminal=true”的中间态；
- 置空、替换或指向新尝试由 `payment.create` 或支付终态事务在持有订单 `version` 的情况下原子完成；
- 任何状态字段更新都必须在结算事务内与预占记录、支付尝试状态一起完成。

### 2.2 `payment_attempts` 新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `paymentAttemptId` | string | 唯一 |
| `merchantOrderNo` | string | 唯一约束 |
| `channelStatus` | string | `created / user_paying / success / closed / pay_error / unknown` |
| `terminal` | boolean | 终态标记；终态后渠道状态不可改 |
| `settlementState` | string | `pending / settled / refund_pending / not_required` |
| `orderSettledAt` | string/null | 结算时间 |
| `amountCents` | number | 渠道金额快照 |
| `active` | boolean | 该尝试是否在 `activePaymentAttemptId` 槽位内；槽位由订单版本事务原子变更 |
| `settlementRetryCount` | number | 结算补偿失败次数，持久化 |
| `settlementNextRetryAt` | string/null | 下一次允许 `paymentSettlementReconciler` 处理的时间 |
| `settlementLastError` | string/null | 最近一次结算失败的结构化错误摘要 |
| `settlementReviewState` | string | `auto_retry / manual_review / resolved` |
| `version` | number | 乐观锁 |
| `createdAt / callbackAt / queriedAt / updatedAt` | string | 时间 |

不变量：

- `channelStatus = success AND terminal = true` 是资金事实；
- **每笔**成功扣款都必须逐笔核算：`settlementState` 最终只能是 `settled` 或 `refund_pending`，不允许停留在 `pending`；
- 同一订单只允许第一笔成功尝试将订单从 `unsettled` 结算为 `paid_settled`；后续成功尝试必须进入 `refund_pending` 并生成独立退款任务；
- 重复回调/重复查单不得改变已终态渠道状态；
- `create` 必须通过订单 `activePaymentAttemptId + version` 事务原子获取槽位；普通查询后创建不被允许。

### 2.3 支付与退款状态（去掉重复表达）

- `paymentStatus ∈ { pending, paying, paid }`，只表达“钱是否已从顾客渠道收到”。
- `refundStatus ∈ { none, pending, processing, refunded, partial_refunded, failed }`，只表达**主订单销售退款**工作流；重复扣款退款不改变该字段。
- 合法组合白名单：

| `paymentStatus` | 允许的 `refundStatus` |
|---|---|
| `pending / paying` | 仅 `none` |
| `paid` | `none / pending / processing / refunded / partial_refunded / failed` |

- 顾客未支付取消：`paymentStatus = pending`，`refundStatus = none`；
- 已扣款但订单已关闭：`paymentStatus = paid`，`refundStatus = pending`（`refundReason=late_payment_after_close`）；
- `refundReason=duplicate_charge` 退款只更新 `payment_attempt/refund_task`，订单 `refundStatus` 保持主交易状态；
- 主订单退款完成后 `paymentStatus` 保持 `paid`，由 `refundStatus = refunded/partial_refunded` 表达退款结果。

## 3. 事务与 SDK 约束

1. 所有多文档状态变更必须使用 `db.runTransaction`。
2. 正式事务更新路径固定为公开 API `tx.collection(name).doc(id).get()` → 校验业务 `version` 与状态前置条件 → `tx.collection(name).doc(id).update({version: _.inc(1), ...})`；事务提交冲突时整体回滚并进行有界重试。禁止以事务外预读代替事务内复核。

> 静态前置发现（待动态证实）：`wx-server-sdk@4.0.2` 依赖的 `@cloudbase/database@1.4.3` 中 `Query.update()` 发送 `database.modifyDocument` 时未携带 `transactionId`。T0 将三条路径严格分开：`official-doc` 是使用公开 `tx.doc().get/update()` 的正式证据路径；`official-where` 只验证公开 `tx.where().update()` 的兼容行为；`raw-diagnostic` 只定位 SDK 内部问题。后两条路径均不得成为生产协议实现候选，T0 正式通过以 `official-doc` 动态验证成功为基础。
3. T0 最小验证（详见 §12）必须实际验证：
   - 云数据库公开 `official-doc` 事务内读、版本复核、写冲突与有界重试行为；
   - 唯一索引在事务内冲突时是否使事务失败；
   - 事务最大读写文档数；
   - 候选 `wx-server-sdk` 版本的 `runTransaction` 行为。
4. 事务写预算：单事务最多 40 个文档写；P1 业务约束保证最大事务写远低于该值（见 `inventory-ledger-model.md` §3）。
5. SDK 版本：当前三个云函数原使用 `"wx-server-sdk": "latest"`，已先行锁定候选 `"wx-server-sdk": "4.0.2"` 并生成 lockfile。T0 最小验证若发现 4.0.2 不兼容，必须变更到已验证版本并重新锁定；任何情况下禁止回到 `latest`。

### 3.1 版本化加密 envelope（手机号与取货码）

不单独保存裸 `Ciphertext + KeyVersion`，统一保存一个 envelope 对象：

```jsonc
{
  "enc": "aes-256-gcm-v1",          // 算法与编码版本
  "alg": "AES-256-GCM",
  "kv": "phone_key_v1",             // 或 pickup_code_key_v1
  "iv": "<base64url, 12 字节>",     // 每次加密随机生成
  "tag": "<base64url, 16 字节>",    // GCM authentication tag
  "ct": "<base64url, ciphertext>",
  "aad": "orderId=<orderId>|field=<fieldName>|kv=<kv>|enc=aes-256-gcm-v1"
}
```

- nonce/IV 使用 CSPRNG 生成 96-bit（12 字节）随机值；不设置逐 IV 登记集合，避免额外事务写预算。若未来合规要求强制登记，再引入 `crypto_nonce_ledger`（`_id = keyVersion + iv` 唯一索引）并计入事务预算。
- AAD 必须绑定 `orderId + fieldName + keyVersion + enc`，防止密文跨订单/跨字段替换。
- 解密失败：写结构化日志与独立 `ops_alerts`，接口只返回 masked 或提示联系门店；禁止自动生成新取货码；人工核查密钥版本、IV/tag 与数据完整性。
- 手机号字段为 `customerPhoneEnvelope`，取货码字段为 `pickupCodeEnvelope`；密钥版本从 envelope 内部读取，不再使用单独的 `*KeyVersion` 订单字段。

## 4. 支付终态与订单结算的崩溃恢复

### 4.1 两段式支付成功处理与多扣款核算

处理顺序固定为：

1. **验签与金额校验**（事务外）。
2. **写支付终态**：独立事务按 `paymentAttemptId + merchantOrderNo` 定位并幂等写入 `channelStatus=success, terminal=true`；首次成功时初始化 `settlementState=pending`、`settlementNextRetryAt=now`、`settlementRetryCount=0`、`settlementReviewState=auto_retry`。
   - 任何能通过 `merchantOrderNo/attemptId` 定位、验签与金额校验的已知尝试，**无论 `active` 与否**，都必须允许写入成功终态；
   - 同一终态事务内：若 `order.activePaymentAttemptId === 本尝试`，条件清空该槽位；若槽位已指向其他新尝试，则只记录本尝试终态，不修改新槽位；
   - 已终态：本事务只读确认，不修改。
3. **逐笔调用结算**：无论第 2 步是新写入还是早已终态，都调用 `settleReservationOnce(orderId, "pay", paymentAttemptId)`。**每笔成功扣款都必须得到 `settled` 或 `refund_pending` 终局**。
4. **结算成功后才确认回调处理完成**。若结算事务提交前进程退出，重复回调、查单任务或对账扫描会再次进入第 3 步。

`payment.create` 的尝试槽位（原子保证）：

- 必须使用订单 `activePaymentAttemptId` 作为唯一槽位，不允许“先查询再创建”的非原子流程。
- 事务内：
  1. 读订单及其 `version`，读 `activePaymentAttemptId` 指向的尝试；
  2. 若槽位内尝试存在、`terminal=false` 且支付参数未过期：复用原 `paymentAttemptId/merchantOrderNo`，直接返回；
  3. 若槽位为空、原尝试已终态或参数过期：使用 `official-doc` 在同一事务内复核订单版本与槽位，将 `activePaymentAttemptId` 指向新尝试；将旧尝试置 `active=false`；创建新尝试 `active=true`；
  4. 事务提交发生并发写冲突时整体回滚并有界重试；并发两个 `create` 只有一个能抢到槽位，另一个重试后复用同一 `merchantOrderNo`。
- `activePaymentAttemptId` 只约束 `payment.create`，不作为回调授权条件；已失效尝试的迟到有效成功回调必须记录并按 §4.2 逐笔结算/退款。
- 任何尝试的终态写入事务都必须条件处理槽位：本尝试仍在槽位则清空；不在槽位则不动其他尝试的槽位。
- 即使渠道/商户平台仍产生第二笔成功扣款（异常、旧单号重试等），也必须按 §4.2 逐笔退款核算。

重复回调规则：

- 重复回调不会因为“支付记录已是终态”而直接返回；
- 重复回调必须再次幂等调用 `settleReservationOnce`，根据该笔 `paymentAttempts.settlementState` 返回结果；
- 只有该笔 `settlementState ∈ {settled, refund_pending}` 且订单字段一致时才无需再写业务状态。

### 4.2 `settleReservationOnce(orderId, intent, paymentAttemptId?)`

所有取消、超时、支付回调/查单调用该入口。事务内步骤：

1. 读取 `order`、`order_reservations`、相关 `payment_attempts`、`inventory_plans/slot_plans`；
2. 校验权限与订单版本；
3. 读取本次 `paymentAttemptId` 对应的成功尝试与订单当前 `settlementState`；
4. 按“本笔成功尝试 × 订单结算状态”裁决：

| 本笔尝试 | 订单/预占状态 | 裁决 |
|---|---|---|
| `terminal=true, success` | `settlementState=unsettled` 且预占 `reserved` | 本笔为第一笔有效成功：订单结算为 `paid_settled`，本笔 `settlementState=settled`，生成取货码 |
| `terminal=true, success` | `settlementState=released_cancelled/released_timeout` | 本笔为迟到支付：订单 `paid_refund_pending`，本笔 `settlementState=refund_pending`，同事务创建本笔 `refund_task` |
| `terminal=true, success` | `settlementState=paid_settled` 或 `paid_refund_pending` | 先读本笔 `settlementState`：已 `settled/refund_pending` 则幂等返回，不创建任务；仍 `pending` 则本笔为重复/第二次真实扣款，置 `refund_pending` 并创建独立 `refund_task`；**不允许无退款终局地幂等跳过** |
| 无成功终态 | 任意 | 按 `intent=cancel/timeout` 执行释放或幂等返回；`intent=pay` 返回 `PAYMENT_CALLBACK_REQUIRED` |
| 其他非法组合 | — | 抛 `ANOMALY_SETTLEMENT_STATE`，外层告警，不写成功审计 |

5. 用 `_id + version` 条件更新以下文档，全部成功才提交：
   - `order_reservations` 状态与 `version`；
   - `order` 的状态字段、`settlementState/orderSettledAt`、`version`；
   - 涉及的 `inventory_plans`、`slot_plans` 计数与 `version`；
   - 对应 `payment_attempts.settlementState/orderSettledAt/settlementReviewState/settlementRetryCount/version`；
   - 若本笔需要退款：更新订单 `refundTaskIds` 并同事务创建本笔 `refund_tasks`；
   - `order_events` 追加事件；
   - `audit_logs` 追加审计。
6. 外部集成（打印、订阅消息、银豹）不得在事务内调用；同事务写 `integration_events` outbox，提交后由 dispatcher 执行。

### 4.3 支付成功对账任务

定时任务 `paymentSettlementReconciler`，每分钟：

1. 先获取任务租约（§10.1）；未取得租约则本轮退出，避免多实例重复扫描。
2. 查询 `payment_attempts`：
   `where({ terminal: true, channelStatus: "success", settlementState: "pending", settlementReviewState: "auto_retry", settlementNextRetryAt: <= now })`
   排序 `settlementNextRetryAt ASC, paymentAttemptId ASC`，`limit = 50`，keyset 严格大于上一批末项 `(settlementNextRetryAt, paymentAttemptId)`。
3. 每条本轮最多处理一次；再次调用 `settleReservationOnce(orderId, "pay", paymentAttemptId)`，无论支付记录多旧。
4. 结算成功：该笔进入 `settled` 或 `refund_pending`，`settlementReviewState=resolved`。
5. 结算失败：持久化更新
   - `settlementRetryCount += 1`
   - `settlementNextRetryAt = now + backoff(count)`，`backoff = 1/5/15 分钟`
   - `settlementLastError = 结构化错误摘要`
   - 第 1–2 次保持 `settlementReviewState=auto_retry`
   - 第 3 次起 `settlementReviewState=manual_review`、`settlementNextRetryAt=null`，写独立 `ops_alerts`；自动任务不再扫描该笔。只有人工操作显式将 `settlementReviewState` 恢复为 `auto_retry` 并设置 `settlementNextRetryAt=now` 后才重新进入扫描；**人工或补偿任务仍可随时再次幂等调用结算**，成功后置 `resolved`。
6. 若发现 `channelStatus=success` 但订单已物理不存在，写人工异常队列，不静默忽略。
7. 查询必须使用 `settlementNextRetryAt` 作为退避条件，禁止无条件下反复取同一批失败记录。

### 4.4 退款/异常任务 outbox

- `refund_tasks` 在“本笔成功扣款需要退款”的结算事务内创建，事务提交后 dispatcher 才可执行；同一订单可能有多条 `refund_tasks`，每笔成功扣款至多一条。
- 幂等键：`merchantRefundNo = merchantOrderNo + "-R1"`，且以 `paymentAttemptId + merchantOrderNo` 唯一关联；同一 `refundTaskId` 永远复用同一 `merchantRefundNo`，微信退款超时重试不得换单号。
- 任务字段：

| 字段 | 说明 |
|---|---|
| `refundTaskId` | 唯一 |
| `orderId / paymentAttemptId / merchantOrderNo` | 关联 |
| `merchantRefundNo` | 唯一；微信退款接口幂等单号 |
| `refundReason` | `order_refund / late_payment_after_close / duplicate_charge` |
| `refundScope` | `order`：影响订单主退款状态；`payment_attempt`：仅影响该笔支付异常状态 |
| `amountCents` | 退款金额 |
| `state` | `pending / processing / succeeded / failed / manual_hold` |
| `attemptCount / nextRetryAt / lastError` | 重试状态 |
| `createdAt / updatedAt / version` | 时间与版本 |

- `refundReason/refundScope` 映射：
  - `order_refund`：主订单销售退款，`refundScope=order`，按规则决定是否回补库存；
  - `late_payment_after_close`：订单关闭后的迟到支付，`refundScope=order`，订单 `refundStatus` 可更新为 `pending/processing/refunded`，但库存已释放，**不得再次回补**；
  - `duplicate_charge`：第二笔及以后的成功扣款，`refundScope=payment_attempt`，只更新对应 `payment_attempt/refund_task`，**不改变订单主 `refundStatus`**；API 可派生 `paymentAnomalyStatus` 展示异常退款状态。
- 订单 `refundStatus` 只聚合 `refundScope=order` 的任务；`duplicate_charge` 任务即使全部成功，主订单仍保持正常销售状态，不得显示“已退款”。
- 重试策略：1/5/15/30 分钟退避，最多 5 次；达到上限转 `manual_hold`。
- 人工接管条件：达到 5 次、渠道返回永久错误、退款金额不一致、退款查单与回调不一致、`refundScope=order` 且 `refundStatus=pending` 超过 30 分钟未推进。
- 人工处置 SLA：告警后 30 分钟内确认，4 个工作小时内完成原路退款或登记人工转账补偿。
- 订单以 `refundTaskIds` 数组指向全部任务；订单主 `refundStatus` 由 `refundScope=order` 任务聚合（全部 `refunded` 才为 `refunded`）。

## 5. 取消、超时、支付竞态决策表

`资金事实=有` 指金额一致且验签通过的 `payment_attempts(channelStatus=success, terminal=true)`。

| # | 场景 | 事务判定 | 订单 | 库存/时段 | 支付/退款 | 事件/审计 |
|---|---|---|---|---|---|---|
| 1 | 顾客取消，无资金事实，预占 `reserved` | 释放成功 | `cancelled`，`settlementState=released_cancelled` | 一次性回补 | `paymentStatus=pending`，`refundStatus=none` | `order.cancelled.customer` + 审计 |
| 2 | 重复取消，已取消 | 幂等成功 | 不变 | 不变 | 不变 | 不写；返回 `alreadyCancelled: true` |
| 3 | 超时，无未决支付尝试 | 释放成功 | `cancelled`，`settlementState=released_timeout` | 同 #1 | 不变 | `order.expired` + 审计 |
| 4 | 超时，存在未决支付尝试且查单未知 | 不释放，安排重查 | 仍 `pending_payment` | 不释放 | `paymentStatus=paying` | 写结构化日志；到期重查 |
| 5 | 成功回调，预占 `reserved` | 支付成功优先 | `pending_acceptance`，`settlementState=paid_settled` | 预占转已售 | `paid`，`refundStatus=none` | `payment.confirmed` + 审计 |
| 6 | 成功回调，预占已释放 | 资金事实优先 | 保持关闭，`settlementState=paid_refund_pending` | 不重复释放，也不回补 | `paid`，`refundStatus=pending`；`refundReason=late_payment_after_close, refundScope=order` | `payment.after_close` + 审计 + `refund_tasks` |
| 7 | 取消 × 成功回调并发 | 回调先赢 => #5，取消返回 `ORDER_STATE_CHANGED`；取消先赢 => #6 | 按赢者 | 只结算一次 | 按赢者 | 只记实际转换 |
| 8 | 超时 × 成功回调并发 | 同 #7 | 按赢者 | 只结算一次 | 按赢者 | 只记实际转换 |
| 9 | 取消 × 超时并发 | 谁先释放谁赢，另一方幂等返回 | `cancelled` | 只释放一次 | 不变 | 只记一次 |
| 10 | 顾客取消，已有资金事实 | 拒绝取消 | 按当前 | 不变 | 不变 | 不写取消；返回 `ORDER_STATE_CHANGED` |
| 11 | 金额/商户单号不一致回调 | 不结算 | 不变 | 不变 | 不变 | 写 `payment_attempts` 异常 + 独立 `ops_alerts` |
| 12 | 重复成功回调，结算已完成 | 必须再次调用结算入口，幂等返回 | 不变 | 不变 | 不变 | 不写审计 |
| 13 | 支付终态落库后、结算前进程崩溃 | 对账/重复回调再次结算 | 由结算结果决定 | 由结算结果决定 | 由结算结果决定 | 只记一次 |
| 14 | 结算事务提交前失败 | 事务回滚 | 不变 | 不变 | 不变 | 不写成功事件；外层 `ops_alerts` |
| 15 | 两次支付尝试均成功 | 第一笔结算订单；后续每笔 `refund_pending`，`refundReason=duplicate_charge, refundScope=payment_attempt` | 保持 `paid_settled`，主 `refundStatus` 不变 | 只结算一次，不回补 | 第一笔 `settled`，第二笔 `refund_pending` | 每笔各记一次实际转换 |
| 16 | 第二笔重复扣款退款失败 | 独立退款任务按 1/5/15/30 重试，5 次后人工接管 | 主订单状态与 `refundStatus` 不变 | 不变 | 第二笔仍 `refund_pending` | 退款任务状态与告警 |
| 17 | A 参数过期失效 → 创建 B → B 成功 → A 迟到成功 | 终态事务按 `merchantOrderNo` 记录 A 成功，不因 `active=false` 拒绝；结算时 B 先成主支付，A 进入 `duplicate_charge` 退款 | 保持 `paid_settled` | 只结算一次，不回补 | B `settled`，A `refund_pending` | 每笔各记一次实际转换 |

## 6. 超时批处理协议

### 6.1 候选查询：keyset 游标，每单本轮最多一次

`runOrderTimeoutSweep()` 每分钟：

0. 先获取任务租约（§10.1）；未取得租约则本轮退出。
1. 候选条件：
   `status = pending_payment`
   `AND expiresAt <= now`
   `AND (paymentCheckDueAt == null OR paymentCheckDueAt <= now)`
2. 排序 `expiresAt ASC, _id ASC`，`limit = 50`；
3. keyset 游标严格大于上一批末项 `(expiresAt, _id)`；单轮循环处理直到候选空或达到最大批次数；
4. 处理过的订单要么被结算为 `cancelled/pending_acceptance`，要么被设置未来的 `paymentCheckDueAt`；因此下一批和下一轮不会立即重新命中同一单；
5. 新过期订单不会因旧候选未决而饿死：游标继续前进，下一轮从头再扫。

### 6.2 每单处理流程

对每个候选：

1. 无未决支付尝试（`created/user_paying/unknown`）：调用 `settleReservationOnce(orderId, "timeout")` 释放。
2. 有未决支付尝试：
   - 先服务端查单（事务外）并幂等写 `payment_attempts` 终态；
   - 查得成功：调用 `settleReservationOnce(orderId, "pay", attemptId)`；
   - 查得明确关闭/未支付：调用 `settleReservationOnce(orderId, "timeout")`；
   - 查单未知：条件更新订单：
     `lastPaymentCheckAt = now`
     `paymentCheckDueAt = now + backoff(n)`，`backoff = 1/2/4/8/16 分钟`
     `paymentCheckRetryCount += 1`
     `timeoutSweepState = "awaiting_payment_check"`
     本轮不再处理该单。
3. 其他瞬时处理失败（结算事务冲突、查单服务临时不可用）：也按 `paymentCheckRetryCount` 与退避设置 `paymentCheckDueAt`；达到 5 次转 `manual_review`。禁止在未设置 `paymentCheckDueAt` 的情况下让同一订单每轮都重新命中。
4. `paymentCheckRetryCount >= 5` 或 `now > expiresAt + 24h`：设置 `timeoutSweepState = "manual_review"`，写独立 `ops_alerts`；**在人工确认前不自动释放**，避免“已扣款、订单已取消”。
5. 只有实际完成 `reserved -> released_timeout` 或 `reserved -> settled_paid` 的事务写 `audit_logs/order_events`；冲突和未知路径不写。

### 6.3 积压与人工 SLA

- 单轮候选累计超过 50 或处理时长超过阈值：写 `ops_alerts`，下轮继续；
- `timeoutSweepState = manual_review`：30 分钟内人工确认，4 个工作小时内完成支付核实或库存处置；
- 查单连续失败但未到 5 次：告警日志保留，重试间隔封顶 16 分钟；
- 任务可任意重跑；幂等由 `order_reservations.state + settlementState` 保证。

## 7. 取货码协议

### 7.1 只生成一次，且可恢复

- 取货码在 `reserveOrder` 阶段**不生成**。
- 在支付结算事务内，当 `order_reservations` 从 `reserved -> settled_paid` 时生成一次；事务失败则本次候选码作废，重试重新生成。
- 订单保存：
  - `pickupCodeEnvelope`：规范化码的版本化 AES-GCM envelope（§3.1，`fieldName=pickupCode`）；
  - `pickupCodeHash`：SHA-256(规范化码)；
  - `pickupCodeGeneratedAt`。
- 顾客 `getOrder` 对已支付订单解密 `pickupCodeEnvelope` 展示，**禁止读取时临时生成新码**。
- 商户核销只比对 `pickupCodeHash`，商户接口不返回、不保存取货码明文。

### 7.2 码格式、熵与冲突

- 格式：8 位 Crockford Base32（字母表 32 个无歧义字符），展示 `XXXX XXXX`；规范化规则：去空格、全角转半角、统一大写。
- 熵：32^8 ≈ 1.1 × 10^12；叠加按订单限速后，试营业单量下枚举风险可接受。
- 冲突处理：`pickupCodeHash` 建唯一索引。结算事务写入时若唯一索引冲突，事务失败并带 `PICKUP_CODE_COLLISION`；外层捕获后重新生成候选码并重试结算事务。禁止静默覆盖或复用旧码。

### 7.3 核销尝试限制与重放

- 全局订单级 `pickup_code_guard`，`_id = orderId`，字段：`failedCount`、`windowStartAt`、`lockedUntil`、`version`。
- 人员/设备级 `pickup_code_actor_guard`，`_id = orderId|actorId`，字段：`actorId/deviceId`、`failedCount`、`windowStartAt`、`lockedUntil`、`version`。
- 每次失败核销在同一事务内对两级 guard 用 `_id + version` 条件更新：
  - 全局：5 分钟窗口内 `failedCount += 1`，达到 5 次 `lockedUntil = now + 15 分钟`；
  - 人员级：5 分钟窗口内 `failedCount += 1`，达到 3 次 `lockedUntil = now + 10 分钟`；
  - 任一 guard 已锁定则拒绝核销，返回剩余锁定时间；不区分输入是否正确。
- 成功核销：同一事务内校验 hash、将订单从 `ready` 转为 `completed`、清除两级 guard、写 `pickup_verifications` 事件（操作人、时间、门店）。
- 重复核销：订单已 `completed` 时不重复变更状态，返回原核销时间和操作人，写结构化日志（可审计但不写成功业务事件）。
- 顾客详情读取取货码不需要尝试计数，但必须校验 `customerOpenId` 和 `paymentStatus=paid`。

### 7.4 密钥轮换

- 取货码密钥按 `pickupCodeEnvelope.kv` 版本管理；新生成码使用新版本；
- 轮换时先给历史版本保留 decrypt-only，批量重加密 `pickupCodeEnvelope`，完成后旧版本停用；
- 核销只依赖 hash，不依赖解密，密钥轮换不影响核销。

## 8. 幂等摘要与隐私

- `order_idempotency.requestDigest` 使用 **HMAC-SHA256(服务端密钥, canonicalRequest)**，不得使用裸 SHA-256。
- 记录 `digestVersion = "hmac-sha256-v1"` 和 `keyVersion`。
- canonicalRequest 优先只覆盖交易语义字段：`storeId, businessDate, slotId, items[{skuId, quantity}]`；`customerName/phone/remark` 如参与一致性比较，也必须放入 HMAC 输入，不能裸散列。
- 服务端密钥存密钥系统；轮换时旧版本保留 verify-only。
- **幂等复核必须按记录中 `keyVersion` 选择密钥重新计算 HMAC**：轮换后旧幂等请求用旧密钥重算，新请求用新密钥；禁止只按当前密钥计算导致旧请求被误判为 `IDEMPOTENCY_KEY_CONFLICT`。
- 摘要不得返回给客户端、不得进入普通日志、埋点或错误消息。

## 9. 事件、审计与告警分离

- `order_events` 只记录**已提交的成功业务事件**。字段：
  `eventId, orderId, eventType, actorType, actorId, reasonCode, statusAfter, paymentStatusAfter, refundStatusAfter, metadata, requestId, createdAt`。
- 冲突、失败、未知路径**不写** `order_events`；改为：
  - 事务内抛结构化错误：`{ requestId, orderId, anomalyCode, actorType, intent, readState }`；
  - 事务外层捕获后写 `ops_alerts`；
  - 若 `ops_alerts` 写入也失败，写结构化 `console.error(JSON.stringify({...}))`，由日志监控报警；
  - 异常路径不写 `audit_logs`。
- `audit_logs` 只在结算事务提交成功时写入，记录真实转换前后状态。

## 10. 任务租约、对账与监控

### 10.1 任务级租约

`paymentSettlementReconciler`、`runOrderTimeoutSweep`、退款 dispatcher 均为可重复触发的定时任务，必须使用任务租约防止多个实例同时扫描：

- 集合 `task_leases`，`_id = taskName`，字段：`ownerId`、`leaseExpiresAt`、`version`、`lastHeartbeatAt`。
- 获取租约：
  - 文档不存在：创建 `{ownerId, leaseExpiresAt: now + 5 分钟, version: 1}`；
  - 已存在：使用 `official-doc` 在事务内重新读取并校验 `version` 与 `leaseExpiresAt <= now`，随后设置新 `ownerId`、`leaseExpiresAt=now + 5 分钟`、`version+1`；提交冲突或前置条件不成立表示被其他实例抢走，本轮退出。
- 续租：使用 `official-doc` 在事务内重新读取并同时校验 `version`、`ownerId === instanceId`，再设置 `leaseExpiresAt=now + 5 分钟`、`version+1`；事务冲突、owner 不匹配或前置条件失败时立即停止取新任务，禁止旧实例覆盖新持有者。
- 租约被他人持有且未过期时直接退出本轮；任务实现仍需幂等，租约只减少并发扫描，不是唯一正确性保障。

### 10.2 对账与监控

| 任务 | 频率 | 检查内容 | 异常处理 |
|---|---|---|---|
| `paymentSettlementReconciler` | 每分钟 | `payment_attempts(terminal=success, settlementState=pending, settlementReviewState=auto_retry, settlementNextRetryAt<=now)` | keyset 重放；失败持久化退避；3 次转人工并移出自动扫描 |
| `reservationReconciler` | 每日 + 变更后抽查 | `order_reservations` 与库存/时段物化计数 | 写 `ops_alerts`，冻结对应 SKU/时段 |
| `refundTaskMonitor` | 每 5 分钟 | `refund_tasks` 超时、重试次数、`manual_hold` | 告警升级 |
| `timeoutSweepMonitor` | 每分钟 | 积压、`manual_review` 数量、查单失败率 | 告警升级 |

## 11. 与库存账本的关系

- 本协议负责“谁、在哪个事务、按什么顺序结算”；
- `docs/inventory-ledger-model.md` 负责“结算时更新哪些计数、如何保证计数不为负、如何迁移和对账”；
- 两者共同约束订单最大行数、总件数和事务写预算。

## 12. T0 最小验证清单

验证参考：[CloudBase 事务文档](https://docs.cloudbase.net/database/transaction)、[CloudBase 索引管理文档](https://docs.cloudbase.net/api-reference/manager/node/database)。

T0 完成前必须在测试云环境（或可验证事务语义的 emulator）交付报告；动态验证使用独立 `t0-probe` 云函数，不实现正式 `payment.create`（执行细则见 `docs/t0-spike-evidence.md` §2）。

- [ ] `wx-server-sdk` 已锁定 4.0.2，三个 lockfile 已生成；**尚未提交，待 T0 冻结后随 T0 变更一并提交**。T0 spike 若不兼容，则变更并重新锁定；
- [ ] 事务内 `_id + version` 条件更新与 `_.inc(1)` 行为；
- [ ] 唯一索引冲突导致事务失败并可重试；
- [ ] 事务最大读写文档数实测值；
- [ ] `db.serverDate()` 在事务内的一致性；
- [ ] 定时触发器最小可运行样例与任务租约条件更新；
- [ ] 复合索引 `terminal+settlementState+settlementReviewState+settlementNextRetryAt` 与 `status+expiresAt+paymentCheckDueAt` 查询计划；
- [ ] SDK 安全审计结论落地（`docs/t0-sdk-security-audit.md`）：漏洞可达性、override 安全性、缓解/风险接受、生产硬门槛与上游跟踪；VPC/出口限制/WAF 等缓解必须在微信云开发环境验证可用后才可作为既定缓解；
- [ ] 若以上任何一项不支持，在本文记录替代方案后方可进入 T1。
