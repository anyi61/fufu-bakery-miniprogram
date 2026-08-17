# 小雨面包微信小程序试营业前开发方案（资质冻结期）

> 状态：草案 v0.6，第五轮评审结论为“v0.5 已具备执行动态 T0 spike 条件，冻结前再修正两个协议矛盾”，已定向修订
> 基线：`ef53f8e`
> T0 专项文档：`docs/order-concurrency-protocol.md`、`docs/inventory-ledger-model.md`、`docs/t0-sdk-security-audit.md`、`docs/t0-spike-evidence.md`（均待 T0 动态 spike + 安全审计完成后冻结）。
> 本文和四份专项文档通过评审前，不进入 T1 代码实施。

---

## 0. 评审意见处置索引

### 第一轮

| 编号 | 评审意见 | 本文处置位置 |
|---|---|---|
| P0-1 | 取消、超时、支付回调缺少统一并发协议 | §3.1 状态字段、§4.2 支付尝试、§5 统一结算协议 |
| P0-2 | 自动超时并不自动，审计可能误记 | §5.5 超时任务、§3.4 事件与审计、§8.2 P1 范围 |
| P0-3 | `listOrders` 不足以支持筛选与稳定分页 | §6.1 `listOrders`、§4.1 索引清单 |
| P0-4 | 手机号明文与 PRD 冲突，接口权限矛盾 | §4.4 手机号与隐私、§6.2 `getOrder`、§6.6 商户接口 |
| P0-5 | 全局库存模型不能支撑真实试营业 | §4.1 库存预占账本、§8.7 P5 迁移、§2 原则 4 |
| P0-6 | 测试策略无法证明事务与竞态正确 | §10 测试策略、§11 T2/T11 |
| P1-1 | 重复取消语义与“幂等”矛盾 | §5.4 取消语义 |
| P1-2 | 错误契约不适合云函数调用 | §3.3 错误契约 |
| P1-3 | 列表 DTO 与详情 DTO 需要拆开 | §3.2 DTO 契约 |
| P1-4 | `reserveOrder` 输入约束与幂等键补强 | §6.5 `reserveOrder`、§4.3 幂等键 |
| P1-5 | `payOrder` 与确认调用链重复 | §7.1 支付编排 |
| P1-6 | “再次购买”缺少可验收规则 | §7.3 再次购买 |
| P1-7 | 状态时间线不能继续作为开放问题 | §3.4 `order_events`、§12 风险 |
| P1-8 | P2–P5 缺少资质冻结期工程准备 | §8.6 冻结期工程准备 |
| P2-1 | 固定 5 秒轮询 | §7.2 详情页轮询 |
| P2-2 | `statusLabel` 持久化 | §3.1 状态字段 |
| P2-3 | 手机号校验 | §7.4 取货人表单 |
| P2-4 | lint 基线表述 | §1 现状 |
| P2-5 | 生产看板聚合口径 | §8.3 P2 商户履约 |

### 第二轮

| 编号 | 第二轮意见 | 处置位置 |
|---|---|---|
| R2-P0-1 | 支付终态落库与订单结算之间的崩溃窗口 | `order-concurrency-protocol.md` §4；本文 §4.2/§5.1 |
| R2-P0-2 | 超时批处理可能无限重复同一批订单 | `order-concurrency-protocol.md` §6；本文 §5.5 |
| R2-P0-3 | 取货码没有可恢复的存储方案 | `order-concurrency-protocol.md` §7；本文 §4.5/§6.2 |
| R2-P0-4 | “整体回滚并写 ops_alerts”无法成立 | `order-concurrency-protocol.md` §9；`inventory-ledger-model.md` §6.3；本文 §4.1/§5.5 |
| R2-P0-5 | 幂等摘要裸 SHA-256 可枚举个人信息 | `order-concurrency-protocol.md` §8；`inventory-ledger-model.md` §4；本文 §4.3 |
| R2-P0-6 | T0/P1/P2/P3 依赖矛盾 | 本文 §8.1/§8.2/§11/§13 |
| R2-P1-1 | 事务写入上限与大订单限制 | `inventory-ledger-model.md` §3 |
| R2-P1-2 | `order_events` 的 conflict/failed 字段 | 本文 §3.4；`order-concurrency-protocol.md` §9 |
| R2-P1-3 | 自动退款任务幂等与人工接管 | `order-concurrency-protocol.md` §4.4 |
| R2-P1-4 | `paymentStatus` 与 `refundStatus` 重复 | 本文 §3.1；`order-concurrency-protocol.md` §2.3 |
| R2-P1-5 | `wx-server-sdk` 使用 `latest` | `order-concurrency-protocol.md` §3/§12；本文 §11 T0 |
| R2-P1-6 | CloudBase 事务/唯一索引最小验证 | `order-concurrency-protocol.md` §12；本文 §11 T0/T11 |

### 第三轮

| 编号 | 第三轮意见 | 处置位置 |
|---|---|---|
| R3-P0-1 | 同一订单两次真实扣款没有结算规则 | `order-concurrency-protocol.md` §4.1/§4.2/§5；本文 §4.2/§5.1/§5.3 |
| R3-P0-2 | 对账失败次数无法持久化 | `order-concurrency-protocol.md` §2.2/§4.3；本文 §4.2 |
| R3-P0-3 | AES-GCM 存储格式未冻结 | `order-concurrency-protocol.md` §3.1/§7；本文 §4.4/§4.5/§9 |
| R3-P0-4 | SDK 安全审计未形成处置结论 | `docs/t0-sdk-security-audit.md`；`order-concurrency-protocol.md` §12；本文 §11 T0/§13 |
| R3-P1-1 | 事务写上限表述 | `inventory-ledger-model.md` §3（已改为项目预算上限） |
| R3-P1-2 | HMAC 密钥轮换后旧幂等复核 | `order-concurrency-protocol.md` §8；`inventory-ledger-model.md` §4 |
| R3-P1-3 | 取货码限速跨设备原子存储 | `order-concurrency-protocol.md` §7.3 |
| R3-P1-4 | 退款后库存调整账本 | `inventory-ledger-model.md` §6.4 |
| R3-P1-5 | 定时任务租约 | `order-concurrency-protocol.md` §10.1 |

### 第四轮

| 编号 | 第四轮意见 | 处置位置 |
|---|---|---|
| R4-P0-1 | `active` 支付尝试缺少原子保证 | `order-concurrency-protocol.md` §2.1/§4.1；本文 §4.2/§5.1 |
| R4-P0-2 | 重复扣款退款污染主 `refundStatus` | `order-concurrency-protocol.md` §4.4/§5；`inventory-ledger-model.md` §6.4；本文 §4.2/§5.3 |
| R4-P0-3 | `manual_review` 后仍被自动扫描 | `order-concurrency-protocol.md` §4.3；本文 §4.2/§10 |
| R4-P1-1 | 任务租约续租需 `ownerId + version` | `order-concurrency-protocol.md` §10.1 |
| R4-P1-2 | AES-GCM IV 逐笔登记成本 | `order-concurrency-protocol.md` §3.1（改 CSPRNG 96-bit，不逐笔登记） |
| R4-P1-3 | 取货码全局锁与人员级限速 | `order-concurrency-protocol.md` §7.3 |
| R4-P1-4 | 安全审计“6 个节点”表述 | `docs/t0-sdk-security-audit.md` §2 |
| R4-P1-5 | VPC/WAF 等缓解需先验证 | `docs/t0-sdk-security-audit.md` §4；`order-concurrency-protocol.md` §12 |

### 第五轮

| 编号 | 第五轮意见 | 处置位置 |
|---|---|---|
| R5-P0-1 | 失效支付尝试的有效回调会被错误拒绝 | `order-concurrency-protocol.md` §2.1/§4.1/§5；本文 §4.2/§5.1/§5.3/§10 |
| R5-P0-2 | 动态 spike 依赖尚未实现的 `payment.create` | `docs/t0-spike-evidence.md` §2；本文 §11 T0/§13 |
| R5-P1-1 | 回调终态同事务处理 `activePaymentAttemptId` | `order-concurrency-protocol.md` §4.1；本文 §5.1 |
| R5-P1-2 | 动态证据元数据（环境/时间/请求 ID/原始返回/清理） | `docs/t0-spike-evidence.md` §3 |
| R5-P1-3 | 安全 override 实验使用独立分支/临时 lockfile | `docs/t0-sdk-security-audit.md` §4 |
| R5-P1-4 | 动态 spike 失败也要保留证据 | `docs/t0-spike-evidence.md` §2/§3 |

---

## 1. 背景与目标

当前基线 `ef53f8e` 的现状描述准确：测试 13/13 通过，lint 0 error、6 个 `<img>` 性能 warning；订单、支付、页面现状与 v0.1 方案一致。v0.2–v0.5 评审结论均为“继续完成 T0、暂不进入 T1”；本版已把第五轮两项 P0 与四项 P1 建议落进专项文档。

**v0.1 的“P1–P4 完成后可直接试营业”结论不成立。** 本版明确：

- P1–P4 产出的是“通过真实环境验收前的工程候选”，不是试营业版本；
- 真实试营业必须经过 P5 的云环境迁移、库存账本初始化、真实支付/回调、定时触发器与集成测试；
- 外部资质到齐不等于“只替换配置”。

---

## 2. 设计原则

1. **双模式对等，但明确 demo 边界**：demo 模式复现相同 DTO、状态和最终语义；demo 只能模拟“最终一致”，不承诺跨 WebView/设备/云函数的真实并发原子性。
2. **服务端权威**：库存、时段、金额、订单状态、支付结果、取消与超时都以云函数事务为准。
3. **P0 优先**：先冻结数据模型与并发协议，再写顾客侧页面；配送、储值、积分、复杂优惠、多门店继续搁置。
4. **不承诺“只换配置”**：当前全局库存是 demo 结构。P1 引入门店 + 履约日期 + SKU 的库存预占账本；P5 必须执行真实环境迁移和集成验收。真实商户号、打印机、银豹凭据到齐后按 runbook 接入并回归，而不是简单替换配置。
5. **行为测试优先**：内存 mock 只是第一层；事务冲突、复合索引、服务端时间、定时触发器和真实并发必须由云环境集成测试或可验证事务语义的 emulator 证明。
6. **顾客身份**：云模式使用 `openid` 隔离订单；不把客户端传入身份作为授权依据。取货人姓名和手机号只是履约联系方式。
7. **支付结果优先**：经验签和金额校验的有效支付成功是资金事实；订单已关闭时进入自动退款/人工异常队列，禁止简单拒绝回调。
8. **隐私默认保护**：云端手机号只存密文和 `masked/last4`；生产角色永远不可见完整手机号；查看完整联系方式必须审计。
9. **一次结算**：所有库存、时段、取消、超时、支付操作都通过同一订单版本和同一预占记录结算协议；同一预占记录只允许从 `reserved` 结算一次。
10. **审计真实**：只有实际完成状态转换的事务才写 `audit_logs` 和 `order_events`；失败、冲突和无变化路径不得生成虚假审计。

---

## 3. 状态、DTO、错误与审计契约

### 3.1 订单状态字段分离

按 PRD 11.1，订单状态、支付状态、退款状态、生产状态分字段保存：

| 字段 | 枚举 | 说明 |
|---|---|---|
| `status` | `pending_payment / pending_acceptance / accepted / making / ready / completed / cancelled` | 顾客主状态 |
| `paymentStatus` | `pending / paying / paid` | 只表达顾客渠道资金是否已收到；退款状态不在此重复表达 |
| `refundStatus` | `none / pending / processing / refunded / partial_refunded / failed` | 退款工作流状态 |
| `productionStatus` | `none / pending_acceptance / accepted / making / ready / completed` | 生产状态，与商户动作同步更新 |
| `settlementState` | `unsettled / paid_settled / released_cancelled / released_timeout / paid_refund_pending` | 结算状态，与 `order_reservations.state` 同步 |
| `orderSettledAt` | string/null | 结算事务提交时间 |
| `activePaymentAttemptId` | string/null | 当前支付尝试槽位，与尝试创建/失效同一订单版本事务变更 |

硬性规则：

- 合法组合白名单：`paymentStatus ∈ {pending, paying}` 时 `refundStatus` 只能为 `none`；`paymentStatus = paid` 时 `refundStatus` 才允许进入退款状态。
- **订单 `refundStatus` 只表达主订单销售退款**，仅聚合 `refundScope=order` 的任务；`duplicate_charge` 退款只更新对应 `payment_attempt/refund_task`，不得把主订单显示为“已退款”。
- 顾客主动取消或系统超时关闭**未支付**订单时，只更新 `status = cancelled`、`settlementState = released_*`、`cancelledAt/cancelReason` 和对应时间线；`paymentStatus` 保持 `pending`，不写成 `failed`。
- 迟到的有效支付回调命中已关闭订单时，订单可保持 `cancelled`，但 `paymentStatus = paid`、`refundStatus = pending`、`settlementState = paid_refund_pending`，同事务写 `refundScope=order` 的退款 outbox。
- `statusLabel` 是响应派生字段或由客户端基于稳定状态码生成，**不持久化**。
- 每个可变文档带 `version`，更新必须条件匹配读到的 `version` 并 `inc(1)`；`version` 不匹配视为冲突。

主状态转换：

| 当前状态 | 触发 | 目标状态 |
|---|---|---|
| `pending_payment` | 支付终态成功 | `pending_acceptance`，`paymentStatus = paid`，`productionStatus = pending_acceptance` |
| `pending_payment` | 顾客取消 | `cancelled`，`paymentStatus` 不变（未支付为 `pending`） |
| `pending_payment` | 超时关闭 | `cancelled`，`paymentStatus` 不变（未支付为 `pending`） |
| `pending_acceptance` → `accepted` → `making` → `ready` → `completed` | 商户操作 | `productionStatus` 同步，`paymentStatus` 不变 |

### 3.2 DTO 契约

列表与详情 DTO 拆开：

`OrderSummary`（`listOrders.orders[]` 最小字段）：

- `id`、`displayNumber`、`status`、`paymentStatus`、`refundStatus`、`productionStatus`
- `totalCents`、`itemCount`、`firstItemImageUrl`
- `slot`：`businessDate / startsAt / endsAt / displayTime`
- `createdAt`、`updatedAt`、`expiresAt`
- `customerName`、`customerPhoneMasked`
- 可操作动作标志：`canPay / canCancel / canBuyAgain`，由服务端按状态计算

`OrderDetail`（`getOrder` 响应）：

- 包含 `OrderSummary` 全部字段；
- `itemsSnapshot`：商品/SKU、单价、数量、行小计；
- `feeSnapshot`：商品小计、包装费、优惠、实付；
- `fulfillmentSnapshot`：`storeId`、门店名、地址、`businessDate`、时段、取货指引；
- `ruleSnapshot`：下单时的取消规则、协议版本、隐私提示版本；
- `storeSnapshot`：门店联系方式；
- `pickupCode`：**仅在 `paymentStatus = paid` 且调用者有权时返回**。取货码在支付结算事务中只生成一次，保存版本化 AES-GCM envelope 与 hash（`pickupCodeEnvelope + pickupCodeHash + pickupCodeGeneratedAt`，envelope 含 iv/tag/kv/enc/AAD）；`getOrder` 只解密既有密文返回，禁止读取时生成新码。待支付预占阶段不生成、不返回取货码（PRD C-062，详见 `order-concurrency-protocol.md` §3.1/§7）；
- 状态时间线通过 `order_events` 查询返回，不内嵌在订单文档中。

### 3.3 错误契约

云函数统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message, details, retryable } }`。页面只依赖稳定 `code`，不匹配中文错误文本。首期至少定义：

| code | 场景 |
|---|---|
| `ORDER_NOT_FOUND` | 订单不存在；顾客越权读取/取消统一返回该码，避免枚举订单 |
| `FORBIDDEN` | 角色无权执行该操作 |
| `ORDER_STATE_CHANGED` | 订单已进入不可执行当前操作的状态 |
| `ORDER_EXPIRED` | 订单已过期且不能继续支付/取消 |
| `INVALID_CURSOR` | 游标损坏、版本不符、筛选条件不匹配 |
| `INVALID_ARGUMENT` | 参数结构、类型、范围错误 |
| `IDEMPOTENCY_KEY_CONFLICT` | 同一幂等键携带了不同请求摘要 |
| `PAYMENT_RESULT_PENDING` | 存在未决支付尝试，禁止取消/释放，需等待查单或回调 |
| `PAYMENT_CALLBACK_REQUIRED` | 微信模式客户端无权确认支付 |
| `PAYMENT_AMOUNT_MISMATCH` | 回调金额/币种/商户单号与订单不一致 |
| `REFUND_PENDING` | 已扣款但订单已关闭，退款已进入队列 |
| `INTERNAL_ERROR` | 未预期异常；返回 `requestId` 供排查 |

`services/api.js` 的 `cloud()` 包装改为 `throw new ApiError(code, message)`，保留 `error.message` 兼容旧页面，新增 `error.code`。

### 3.4 状态时间线与审计

- 新增独立集合 `order_events`，追加写，**不把无限增长数组放进订单文档**。
- 字段：`eventId`、`orderId`、`eventType`、`actorType`（`customer/system/payment/staff`）、`actorId`、`reasonCode`、`statusAfter`、`paymentStatusAfter`、`refundStatusAfter`、`metadata`、`requestId`、`createdAt`。
- `order_events` 只记录已提交的成功业务事件；**删除** `result: conflict/failed`。冲突、失败和未知路径不写事件，只写结构化运行日志与 `ops_alerts`。
- 详情页时间线读取 `order_events`；单个订单事件过多时分页，首期每页 100 条。
- `audit_logs` 与 `order_events` 在**同一个事务内**与状态变更一起写入：
  - 事务内审计写入失败 => 业务变更整体回滚；告警在事务外层单独写；
  - 事务发现订单已被其他请求处理 => 直接返回结果，**不写** `order.expired` 或任何审计；
  - 异常事务**不写** `ops_alerts`，否则回滚会让告警一起消失；外层捕获后独立写告警，见 §4.1；
  - 外部集成（打印、订阅消息、银豹）先写 `integration_events` 事务 outbox，事务提交后由统一 dispatcher 执行，失败进入重试队列。

---

## 4. 数据模型与前置决策

### 4.1 库存预占账本（P1 前冻结）

放弃 `products.plannedStock/soldStock/reservedStock` 全局计数作为交易依据。新增：

| 集合/字段 | 说明 |
|---|---|
| `stores` | `storeId`、名称、地址、电话、营业状态、时区。首发单店也必须带 `storeId` |
| `inventory_plans` | 唯一键 `storeId + businessDate + skuId`；`plannedStock`、`reservedUnits`、`soldUnits`、`version` |
| `slot_plans` | 唯一键 `storeId + businessDate + slotId`；`capacity`、`reservedOrders`、`paidOrders`、`isClosed`、`version` |
| `order_reservations` | 每订单一条；`reservationId`、`orderId`、`customerOpenId`、`storeId`、`businessDate`、`slotId`、`items[{skuId, productId, quantity}]`、`state: reserved / settled_paid / released_cancelled / released_timeout`、`releasedBy`、`releasedReason`、`settledAt`、`version` |

规则：

- `inventory_plans.reservedUnits/soldUnits` 与 `slot_plans.reservedOrders/paidOrders` 只是账本的物化计数，**只能**由 `order_reservations` 状态迁移事务更新，不允许业务代码直接 `inc` 全局商品计数。
- 可用量展示由 `plannedStock - soldUnits - reservedUnits` 计算；交易校验必须事务内读计划与预占记录。
- `reserveOrder` 事务：校验商品/SKU、日期库存、时段容量、营业状态、最晚下单时间、商品提前量；创建 `order_reservations(state=reserved)`；按行更新日库存预占；按单更新时段预占；创建订单；写 `order_events(order.reserved)`。
- 取消、超时、支付成功都调用 `settleReservationOnce`（§5），先把预占记录从 `reserved` 一次性迁移到终态，再按记录内容更新日库存和时段计数。
- 事务内校验计数：任何预计值小于 0、预占记录缺失、数量不一致或重复结算时**整体回滚**，禁止 `Math.max(0, …)` 掩盖重复释放。
- 告警不得写在失败事务内：事务内抛结构化错误 `{ requestId, orderId, anomalyCode, expected, actual, version }`；外层捕获后独立写 `ops_alerts`；独立告警也失败时写结构化 `console.error`，由日志监控报警。异常路径不写成功 `audit_logs/order_events`。
- 订单上限：不同 SKU 行数 ≤ 20，单行数量 ≤ 10，整单总件数 ≤ 30；单事务写文档数**项目预算上限 40**，数据库真实上限待 T0 spike 实测后校准，详见 `inventory-ledger-model.md` §3。
- 每日对账任务比对 `order_reservations` 与 `inventory_plans/slot_plans` 的物化计数，不一致即告警。
- 订单保存完整履约与费用快照：`storeId`、`businessDate`、`slotId`、商品/SKU 快照、单价、包装费、实付、门店快照、取消规则版本；历史订单不随配置变化。
- 服务端校验项进入 P1 前置配置：营业状态、营业日历、最晚下单时间、商品/SKU 最短提前量、时段关闭、单品/整单限购。配置缺失时拒绝下单并告警，不降级放行。

索引清单（真实云环境必须建并验证）：

- `inventory_plans(storeId, businessDate, skuId)` 唯一
- `slot_plans(storeId, businessDate, slotId)` 唯一
- `order_reservations(orderId)` 唯一；`order_reservations(state, updatedAt)`
- `orders(customerOpenId, createdAt, _id)`
- `orders(customerOpenId, status, createdAt, _id)`
- `orders(status, expiresAt, paymentCheckDueAt)`
- `payment_attempts(merchantOrderNo)` 唯一；`payment_attempts(orderId, createdAt)`；`payment_attempts(terminal, channelStatus, settlementState, settlementReviewState, settlementNextRetryAt)`
- `order_events(orderId, createdAt)`

### 4.2 支付尝试/支付记录

新增独立集合 `payment_attempts`，不把支付结果只挂在订单一个字段上：

| 字段 | 说明 |
|---|---|
| `paymentAttemptId` | 每次创建支付参数生成一个，确定性/唯一 |
| `orderId` | 关联订单 |
| `customerOpenId` | 归属校验 |
| `merchantOrderNo` | 商户单号，唯一约束 |
| `channel` | `mock / wechat` |
| `channelOrderNo` | 渠道支付单号，回调时写入 |
| `channelStatus` | `created / user_paying / success / closed / pay_error / unknown` |
| `amountCents` | 渠道金额快照，必须与订单实付一致 |
| `terminal` | 终态标记；终态后渠道状态不可改 |
| `active` | boolean | 该尝试是否在 `activePaymentAttemptId` 槽位内；槽位由订单版本事务原子变更 |
| `settlementState` | `pending / settled / refund_pending / not_required`，每笔成功扣款的核算进度 |
| `orderSettledAt` | 订单结算时间 |
| `settlementRetryCount` | 结算补偿失败次数（持久化） |
| `settlementNextRetryAt` | 下一次允许对账任务处理该笔的时间 |
| `settlementLastError` | 最近一次结算失败的结构化错误摘要 |
| `settlementReviewState` | `auto_retry / manual_review / resolved` |
| `createdAt / callbackAt / queriedAt / updatedAt / version` | 时间与版本 |

规则：

- 支付成功处理固定为两段：先幂等写 `payment_attempts` 渠道终态，**然后无论本次是否新写、是否早已终态，都必须再次调用 `settleReservationOnce(orderId, "pay", attemptId)`**；结算事务提交后才确认回调处理完成。
- **逐笔核算成功扣款**：第一笔成功负责订单结算；后续成功尝试必须置 `settlementState=refund_pending` 并创建 `refundReason=duplicate_charge, refundScope=payment_attempt` 的独立退款任务；重复扣款退款不得改变订单主 `refundStatus`。
- 同一 `merchantOrderNo` 只允许一条记录；`payment.create` 通过订单 `activePaymentAttemptId + version` 事务原子获取/复用支付槽位，禁止“先查询再创建”；并发两个 `create` 只能返回同一 `merchantOrderNo`。`activePaymentAttemptId` 只约束 `create`，**不作为回调授权条件**。
- 定时对账 `paymentSettlementReconciler` 只扫描 `terminal=true, channelStatus=success, settlementState=pending, settlementReviewState=auto_retry, settlementNextRetryAt<=now` 的记录，keyset 处理；失败按 `settlementRetryCount` 持久化退避；第 3 次转 `manual_review` 且 `settlementNextRetryAt=null`，自动任务不再扫描，人工恢复 `auto_retry` 后才重新进入。
- 金额不一致只写 `payment_attempts` 的异常状态并写独立 `ops_alerts`，**不修改订单、不扣库存**，返回 `PAYMENT_AMOUNT_MISMATCH`。
- 任何能按 `merchantOrderNo/attemptId` 定位并通过验签与金额校验的已知尝试，**无论 `active` 与否**，都必须允许写入成功终态并进入逐笔结算；若该尝试仍在 `activePaymentAttemptId` 槽位，终态事务同事务清空槽位。
- `payment_attempts` 也是超时释放前“是否必须查单”的判定依据。
- 退款/异常任务必须在订单结算事务内以 outbox 写入，事务提交后才允许 dispatcher 执行；`refund_tasks` 必须带 `refundReason/refundScope`，订单主 `refundStatus` 只聚合 `refundScope=order` 的任务，见 `order-concurrency-protocol.md` §4.4。

### 4.3 下单幂等键

- 新增独立集合 `order_idempotency`，`_id = sha256(customerOpenId + ":" + idempotencyKey)` 唯一；字段：`orderId`、`requestDigest`、`digestVersion`、`keyVersion`、`createdAt`、`version`。
- `requestDigest = HMAC-SHA256(serverKey, canonicalJson(...))`，**禁止裸 SHA-256 散列手机号/姓名/备注**；记录 `digestVersion = "hmac-sha256-v1"`。
- canonicalJson 优先只覆盖交易语义字段 `storeId, businessDate, slotId, items[{skuId, quantity}]`；姓名、手机号、备注如必须参与一致性比较，也放入 HMAC 输入。
- 服务端密钥存密钥系统；轮换时旧版本保留 verify-only；复核已有幂等记录必须按记录 `keyVersion` 重算，不得只按当前密钥计算。
- 摘要不得进入客户端、普通日志、埋点或错误消息。
- 创建订单与写入幂等记录在同一事务中完成；并发同键只有一个事务能创建记录并创建订单，另一个事务重试后读到已有记录：
  - 摘要相同：返回已有订单（`alreadyReserved: true`），不重复预占；
  - 摘要不同：返回 `IDEMPOTENCY_KEY_CONFLICT`，禁止复用。
- `orders._id` 仍为 `ord_<唯一标识>`，用于排序与游标；`order_idempotency` 单独承担幂等约束，避免把展示 ID 与幂等 ID 混用。
- `idempotencyKey` 由结算页在一次“提交意图”内生成并复用，重试不换键；新购物车新键。

### 4.4 手机号与隐私

试营业硬性退出条件：

- 云模式订单**不保存** `customerPhone` 明文，只保存：
  - `customerPhoneEnvelope`：版本化 AES-256-GCM envelope，含 `enc/kv/iv/tag/ct/aad`；密钥在服务端密钥系统；AAD 绑定 `orderId + fieldName + keyVersion + enc`；
  - `customerPhoneMasked`：`138 **** 0826`；
  - `customerPhoneLast4`：用于商户搜索和客服核对。
- 密钥方案：主密钥只存服务端密钥系统；同一密钥版本下 nonce 不得复用；轮换时新写用新版本，历史文档按批次重加密；旧版本在完成重加密前保留 decrypt-only。解密失败写独立 `ops_alerts`，只返回 masked，禁止猜测或自动生成新数据。
- 顾客 `getOrder` 只返回 `masked/last4`，不返回完整手机号；顾客没有查看完整手机号的业务必要。
- 完整手机号通过独立商户履约接口 `getOrderContact` 按角色返回；调用必须审计查看人、订单、时间、结果。**生产角色永远无权限**。
- 顾客 `getOrder` 与商户 `getMerchantOrder` 分成两个 action，不混用一套授权。
- 本地 demo：订单文档只存 `masked/last4`；常用取货人可保存在独立的本地草稿键，并在结算页明确告知“仅用于本次自提联系、可清除”，提供清除入口。
- 账号注销/个人信息删除入口、隐私指引保存期限、订单依法留存期（至少三年）与留存期后的去标识化/删除策略写入 P4 内容与 runbook；留存隔离不因注销而破坏法定订单留存。
- 隐私查看审计属于试营业前验收项，不推迟到上线后。

### 4.5 取货码可恢复存储

- 支付结算事务中只生成一次取货码；订单保存 `pickupCodeEnvelope + pickupCodeHash + pickupCodeGeneratedAt`。
- envelope 为版本化 AES-256-GCM 格式（nonce/IV、tag、ciphertext、AAD），AAD 绑定 `orderId + fieldName + keyVersion + enc`；密钥版本从 envelope 内部读取。
- `getOrder` 只解密既有 envelope 展示，禁止读取时生成新码；商户核销只比对 hash。
- 码格式、熵、冲突重试、跨设备核销限速、重放处理和密钥轮换规则见 `order-concurrency-protocol.md` §7。

---

## 5. 统一结算与并发协议

### 5.1 唯一结算入口 `settleReservationOnce(orderId, intent, paymentAttemptId?)`

取消、超时、支付回调/查单全部调用同一入口。`intent ∈ {pay, cancel, timeout}`。

支付成功处理固定为两段，消除终态落库与结算之间的崩溃窗口：

1. 事务外验签与金额校验；
2. 独立事务幂等写入 `payment_attempts(channelStatus=success, terminal=true)`，首次成功时初始化 `settlementState=pending`、`settlementNextRetryAt=now`、`settlementRetryCount=0`、`settlementReviewState=auto_retry`；任何已知尝试无论 `active` 与否都可写入终态，并在同一事务内条件处理槽位（本尝试仍在槽位则清空，否则不动新槽位）；
3. **无论第 2 步是新写入还是早已终态，都必须调用** `settleReservationOnce(orderId, "pay", attemptId)`；
4. 结算事务提交后才确认回调处理完成。若第 3 步前进程终止，重复回调、查单或 `paymentSettlementReconciler` 会再次结算。

`settleReservationOnce` 事务内：

1. 读取 `order`、`order_reservations`、本次 `paymentAttemptId` 对应的尝试、其他成功终态尝试和 `inventory_plans/slot_plans`；
2. 校验调用者权限（顾客取消只允许 `customerOpenId` 匹配）；
3. 判定本笔资金事实：本次尝试 `terminal=true AND channelStatus=success AND amountCents=order.totalCents`；
4. 按“本笔成功尝试 × 订单 `settlementState`”逐笔裁决：
   - 订单 `unsettled` 且预占 `reserved`：本笔结算订单为 `paid_settled`，本笔 `settlementState=settled`，生成取货码；
   - 订单 `released_cancelled/released_timeout`：本笔为迟到支付，订单转 `paid_refund_pending`，本笔 `refund_pending` 并创建 `refundReason=late_payment_after_close, refundScope=order` 的退款任务；
   - 订单 `paid_settled` 或 `paid_refund_pending`：先读本笔 `settlementState`，已 `settled/refund_pending` 则幂等返回；仍 `pending` 则本笔为重复/第二次真实扣款，必须 `refund_pending` 并创建 `refundReason=duplicate_charge, refundScope=payment_attempt` 的独立退款任务，**不得无退款地幂等跳过，也不得改变订单主 `refundStatus`**；
   - 本笔无成功终态：按 `intent=cancel/timeout` 释放或幂等返回；`intent=pay` 返回 `PAYMENT_CALLBACK_REQUIRED`；
5. 同时更新 `order_reservations.state`、`order.settlementState/orderSettledAt/refundTaskIds`、`payment_attempts.settlementState/orderSettledAt` 和库存/时段计数；退款任务 outbox 同事务写入；
6. 所有文档用条件更新 `where({ _id, version: readVersion }).update({ ..., version: _.inc(1) })`；任一更新数为 0 则事务重试；
7. 事务内写 `order_events` 和 `audit_logs`；需要退款/外部集成时写 outbox；全部成功才提交。

`payment.create` 必须通过订单 `activePaymentAttemptId + version` 事务原子获取支付槽位：读订单与槽位尝试；槽位可用则返回同一 `paymentAttemptId/merchantOrderNo`；槽位为空/已终态/参数过期则在**同一事务**条件更新订单并创建新尝试、失效旧尝试。并发 `create` 只有一个能更新订单版本，另一个重试后复用同一 `merchantOrderNo`。`activePaymentAttemptId` 只控制创建/复用，失效尝试的迟到有效回调仍必须记录并逐笔结算；即使异常产生第二笔真实扣款，也按第 4 步逐笔退款。

外部查单（微信支付 API）不能在数据库事务内调用。处理顺序固定为：

1. 先服务端查单并把渠道终态幂等写入 `payment_attempts`；
2. 无论是否写入新终态，都进入 `settleReservationOnce` 事务；
3. 回调与查单并发时，`paymentAttemptId + merchantOrderNo` 唯一约束保证渠道终态只落一次。

### 5.2 支付回调规则

- 有效支付成功是资金事实；即使订单已关闭，也必须记账并进入退款流程，不能拒绝。
- 回调到达时订单仍 `pending_payment` 且预占仍在：正常结算为 `pending_acceptance`；即使 `expiresAt` 已过、超时任务尚未释放预占，有效成功回调仍正常结算。`expiresAt` 只决定超时任务启动时点，不是拒绝支付确认的依据。
- 回调到达时订单已被顾客取消或超时释放：订单保持关闭态，`paymentStatus = paid`、`refundStatus = pending`、`settlementState = paid_refund_pending`；退款 outbox 与订单结算同事务写入；不二次释放库存。
- 重复回调：即使该笔支付记录已经终态，也必须再次幂等调用 `settleReservationOnce`；根据该笔 `settlementState` 返回结果，只有该笔已 `settled/refund_pending` 且订单一致才不写业务状态。
- 同一订单两笔成功扣款：第一笔结算订单，后续每笔必须 `refund_pending` 并创建独立退款任务；回调乱序也不影响该结论。
- 第二笔退款失败：退款任务按 1/5/15/30 分钟重试，5 次后人工接管，期间订单/第一笔结算状态不回滚。
- 回调乱序：所有回调先按商户单号定位 `paymentAttempt`；只接受验签和金额校验通过的终态，渠道终态不可逆。
- 查单与回调不一致：以验签回调为资金事实，查单结果只用于补记和告警；无法自动裁决的写人工异常队列。

### 5.3 竞态决策表

所有操作最终按同一事务裁决。`支付终态=有` 表示存在金额一致且验签通过的 `channelStatus=success`。

| # | 场景 | 事务判定 | 订单状态 | 库存/时段 | 支付/退款 | 审计/事件 |
|---|---|---|---|---|---|---|
| 1 | 顾客取消，无支付终态，预占 `reserved` | 释放成功 | `cancelled` | 按预占记录一次性回补 `reservedUnits/reservedOrders` | `paymentStatus` 保持 `pending`；`refundStatus=none` | `order.cancelled.customer` + 审计 |
| 2 | 重复取消，订单已 `cancelled` | 幂等成功 | 不变 | 不变 | 不变 | 不写审计；返回 `alreadyCancelled: true` |
| 3 | 超时任务，无未决支付尝试 | 释放成功 | `cancelled` | 同 #1 | `paymentStatus` 保持 `pending` | `order.expired` + 审计 |
| 4 | 超时任务，存在 `created/user_paying/unknown` 未决尝试 | 先服务端查单；无终态则保持预占 | 仍 `pending_payment` | 暂不释放 | `paymentStatus=paying` | 写重查任务；超过宽限期写 `ops_alerts` |
| 5 | 有效成功回调，预占 `reserved` | 支付成功优先 | `pending_acceptance` | 预占结算为已售：`reserved-1/sold+1`，`reservedOrders-1/paidOrders+1` | `paid` | `payment.confirmed` + 审计 |
| 6 | 有效成功回调，预占已被取消/超时释放 | 资金事实优先 | 保持 `cancelled` | 不重复释放，也不回补 | `paid + refund_pending`；`refundReason=late_payment_after_close, refundScope=order` | `payment.after_close` + 审计 + 退款队列 |
| 7 | 取消 × 有效回调并发 | 回调事务先赢 => #5，取消返回 `ORDER_STATE_CHANGED`；取消先赢 => #6 | 按赢者 | 按赢者且只结算一次 | 按赢者 | 只记实际转换 |
| 8 | 超时 × 有效回调并发 | 同 #7 | 按赢者 | 按赢者且只结算一次 | 按赢者 | 只记实际转换 |
| 9 | 取消 × 超时并发 | 谁先完成释放谁赢，另一方只读幂等返回 | `cancelled` | 只释放一次 | 不变 | 只记一次 |
| 10 | 顾客取消，但已有支付终态 | 拒绝取消 | 按当前状态 | 不变 | 不变 | 不写取消审计；返回 `ORDER_STATE_CHANGED` |
| 11 | 金额/币种/商户单号不一致的回调 | 不结算 | 不变 | 不变 | 不变 | 写 `payment_attempts` 异常 + `ops_alerts` |
| 12 | 重复成功回调 | 必须再次调用结算入口，按该笔 `settlementState` 幂等返回 | 不变 | 不变 | 不变 | 不写审计 |
| 13 | 支付终态已落库、结算前进程崩溃 | 对账/重复回调补偿结算 | 按结算结果 | 按结算结果 | 按结算结果 | 只记一次 |
| 14 | 结算事务提交前失败 | 整体回滚 | 不变 | 不变 | 不变 | 不写成功事件；外层独立 `ops_alerts` |
| 15 | 两次支付尝试均成功 | 第一笔结算订单；后续每笔 `refund_pending`，`refundReason=duplicate_charge, refundScope=payment_attempt` | 保持 `paid_settled`，主 `refundStatus` 不变 | 只结算一次，不回补 | 第一笔 `settled`，第二笔 `refund_pending` | 每笔各记一次实际转换 |
| 16 | 第二笔重复扣款退款失败 | 独立退款任务退避重试，5 次后人工接管 | 主订单状态与 `refundStatus` 不变 | 不变 | 第二笔仍 `refund_pending` | 退款任务状态与告警 |
| 17 | A 过期失效 → 创建 B → B 成功 → A 迟到成功 | 按 `merchantOrderNo` 记录 A 终态，不因 `active=false` 拒绝；B 为主支付，A 进入 `duplicate_charge` 退款 | 保持 `paid_settled` | 只结算一次，不回补 | B `settled`，A `refund_pending` | 每笔各记一次实际转换 |

### 5.4 顾客取消语义

- 仅 `status = pending_payment` 可顾客取消。
- 取消前事务外判定：若存在 `created/user_paying/unknown` 未决支付尝试，服务端主动查单：
  - 查得成功：走支付结算，取消返回 `ORDER_STATE_CHANGED`；
  - 查得明确未支付/已关闭：允许继续取消；
  - 查单超时或结果未知：**不取消**，返回 `PAYMENT_RESULT_PENDING`，提示稍后刷新。
- 重复取消定义为幂等成功：返回当前 `cancelled` 订单并带 `alreadyCancelled: true`。
- 已支付或已进入生产流程：返回 `ORDER_STATE_CHANGED` 和当前状态；已支付订单一期不开放取消/退款入口。
- 手动取消与系统超时共用 `settleReservationOnce`，只在 `intent` 与 `releasedReason` 上区分。

### 5.5 自动超时释放

不再依赖 `bootstrap()` 和 `reserveOrder()` 顺手清理：

- `cloudfunctions/bakery` 配置定时触发器 `orderTimeoutTimer`，每分钟触发；`exports.main` 识别触发器事件并调用 `runOrderTimeoutSweep()`。每次运行先获取 `task_leases` 租约（`order-concurrency-protocol.md` §10.1），未取得则本轮退出。P1 也保留页面调用兜底，但页面调用**不是**验收依据。
- `runOrderTimeoutSweep()` 使用 **keyset 游标**，禁止用会重复命中同一批未决订单的朴素循环：
  1. 候选条件：`status = pending_payment AND expiresAt <= now AND (paymentCheckDueAt == null OR paymentCheckDueAt <= now)`；
  2. 排序 `expiresAt ASC, _id ASC`，`limit = 50`；游标严格大于上一批末项 `(expiresAt, _id)`；
  3. 每单本轮最多处理一次；处理结果为释放、支付结算，或设置未来的 `paymentCheckDueAt`，因此不会立即重新命中；
  4. 每单先做 §5.4 的未决支付查单；查得成功走支付结算，明确未支付才释放，查单未知设置 `paymentCheckDueAt` 与重查次数；
  5. 只在实际完成 `reserved -> released_timeout/settled_paid` 的事务内写审计；已处理/冲突订单跳过；
  6. 单个事务内校验订单、预占记录、日库存计数、时段计数；任何不一致整体回滚，告警在事务外层独立写 `ops_alerts`。
- 订单新增字段：`paymentCheckDueAt`、`lastPaymentCheckAt`、`paymentCheckRetryCount`、`timeoutSweepState`。
- 未决支付保留与人工处置：
  - 查单未知：重查退避 1/2/4/8/16 分钟，`paymentCheckRetryCount += 1`；
  - `paymentCheckRetryCount >= 5` 或 `now > expiresAt + 24h`：转 `timeoutSweepState = manual_review`，独立 `ops_alerts`；人工确认前不自动释放；
  - 人工 SLA：30 分钟内确认，4 个工作小时内完成支付核实或库存处置。
- 积压与恢复：
  - 单轮候选累计超过 50 单或处理时长超过阈值时写 `ops_alerts`，下轮继续，禁止静默截断；
  - 任务中途失败可重跑，预占记录状态和 `settlementState` 保证幂等；重跑验收见 §10；
  - 连续 N 轮积压触发人工告警。
- demo 模式：
  - 本地 Storage 无法拥有服务端定时器，`demoState()` 继续在入口处模拟过期释放，但必须复用同一纯函数 `settleReservationOnce`；
  - 文档和测试中明确：demo 只模拟最终语义，不证明跨 WebView/设备并发原子性。

---

## 6. 云函数 API 设计

所有新增 action 加在 `cloudfunctions/bakery/index.js`，由 `services/api.js` 统一封装；错误契约见 §3.3。

### 6.1 `listOrders`

```jsonc
// 请求
{
  "action": "listOrders",
  "statusGroup": "all | pending_payment | active | completed | cancelled",
  "cursor": "base64url(JSON)，可选",
  "limit": 20
}
// 响应
{
  "ok": true,
  "data": {
    "statusGroup": "active",
    "orders": [ /* OrderSummary[]，见 §3.2 */ ],
    "nextCursor": "base64url(JSON) 或 null"
  }
}
```

规则：

- 服务端筛选，禁止前端逐页过滤。`statusGroup` 映射：
  - `pending_payment` → `status = "pending_payment"`
  - `active` → `status ∈ {pending_acceptance, accepted, making, ready}`
  - `completed` → `status = "completed"`
  - `cancelled` → `status = "cancelled"`
  - `all` → 不按状态过滤
- 固定排序：`createdAt DESC, _id DESC`。demo 模式按完全相同排序实现。
- 游标载荷：`{ "v": 1, "g": "statusGroup", "c": "lastCreatedAt", "id": "lastOrderId" }`，base64url 只作为编码，不是信任边界。服务端校验：
  - 结构、版本、长度（≤512 字符）合法；
  - `g` 与本次请求 `statusGroup` 完全一致；
  - `c` 是合法时间且不超过当前时间；
  - `id` 非空且匹配 `ord_` 规则。
  - 非法游标返回 `INVALID_CURSOR`。
- 游标谓词为严格“小于上一页末项”的元组：`createdAt < last.createdAt OR (createdAt = last.createdAt AND _id < last.id)`，再叠加顾客与状态过滤。
- 查询取 `limit + 1`：返回数 ≤ `limit` 时 `nextCursor = null`；多出 1 条时以第 `limit` 条为末项生成 `nextCursor`。
- 默认 `limit=20`，最大 `50`，非法值归一到 20。
- **禁止**降级为“最近 50 单”。历史订单必须可完整翻页。
- 若真实云开发环境无法可靠执行上述元组谓词与双字段排序，采用备选方案：新增单调 `cursorKey = pad(createdAtEpochMs, 15) + "#" + _id`，排序 `cursorKey DESC`，谓词 `cursorKey < last.cursorKey`。该决策必须在 T3 真实云环境验证后落定，demo 同步实现同一方案。
- 兼容期：`bootstrap` 暂时保留 `latestOrder`，避免破坏现有首页和商户端；订单列表/详情全部改走 `listOrders/getOrder`，`latestOrder` 在页面迁移完成后废弃。

### 6.2 `getOrder`

```jsonc
// 请求
{ "action": "getOrder", "orderId": "ord_xxx" }
// 响应：OrderDetail，见 §3.2
```

规则：

- **仅顾客本人**：`customerOpenId === openid`；订单不存在或不属于当前顾客统一返回 `ORDER_NOT_FOUND`，不返回“无权限”差异。
- P1 不在此 action 中混入员工权限；商户读取走 §6.6 的 `getMerchantOrder`。
- 只返回 `customerPhoneMasked/customerPhoneLast4`，永不返回完整手机号。
- `pickupCode` 仅在 `paymentStatus = paid` 时解密既有 `pickupCodeEnvelope` 返回；预占阶段无取货码，读取时禁止临时生成新码。
- 状态时间线从 `order_events` 读取，不在订单文档内保存数组。

### 6.3 `cancelOrder`

```jsonc
// 请求
{ "action": "cancelOrder", "orderId": "ord_xxx" }
// 响应：更新后的 OrderDetail；重复取消额外带 { "alreadyCancelled": true }
```

规则见 §5.4；释放只通过 `settleReservationOnce`，禁止直接 `reservedStock -=`。

### 6.4 `getOrderEvents`

```jsonc
{ "action": "getOrderEvents", "orderId": "ord_xxx", "cursor": "...", "limit": 100 }
```

- 顾客只能读自己订单的事件；
- 追加式、倒序分页；事件不可更新。

### 6.5 `reserveOrder`

输入约束（P1 前置修复）：

- `items` 非空，先按 `productId/SKU` **合并重复商品行**，合并后再校验；
- `productId/SKU` 必须存在、上架、未停售；数量必须为正整数，拒绝 `0/负数/小数/超大数量/非数字`；
- 单品上限与整单件数上限服务端校验（不同 SKU 行数 ≤ 20、单行 ≤ 10、整单总件数 ≤ 30）；整单金额重新计算，前端传入金额只用于展示，不作为扣款依据；
- `idempotencyKey` 必填，绑定顾客和 `requestDigest`，规则见 §4.3；
- 同一幂等键并发创建只产生一张订单；
- 订单只保存服务端重算的价格快照；
- 预占成功时**不生成取货码**。

服务端校验（缺失配置时拒绝下单）：

- 门店营业状态与营业日历；
- 履约日期 + 时段可售；
- 最晚下单时间；
- 商品/SKU 对履约日期的库存与最短提前量；
- 时段容量与关闭状态；
- 单品/整单限购。

### 6.6 商户接口与最小 RBAC

- **P1 纳入最小 RBAC**：`staff` 集合增加角色字段，至少区分 `owner/customer_service/production`；实现 `getOrderContact(orderId)`，仅 `owner/customer_service` 可查看完整手机号并审计查看人、订单、时间、结果；`production` 永远返回 `FORBIDDEN`。
- `getMerchantOrder(orderId)`：商户视图只返回 `masked/last4`；与顾客 `getOrder` 分属不同 action。
- P2 再扩展 `listMerchantOrders({ statusGroup, slotId, businessDate, cursor, limit })`、店长/客服完整权限矩阵和商户订单中心。
- 生产权限测试从 P2 移入 P1：顾客 A 不能读/取消顾客 B；生产角色不能读完整手机号。
- 现有 `config.merchantOpenIds` 仅用于 demo 体验，不作为生产权限依据。

---

## 7. 小程序端设计

### 7.1 支付编排唯一入口

- 页面只调用 `services/payment.js` 的 `payOrder(orderId)`；**页面不得再调用 `api.confirmPayment()`**。
- `payOrder` 内部封装三种模式：
  - 本地 demo：延迟后调用本地结算；
  - 云 demo：调用云函数 `confirmDemoPayment`（仅测试环境）；
  - 微信：调用 `payment` 云函数 `create`，拉起 `wx.requestPayment`，之后只轮询 `api.getOrder(orderId)` 或 `queryPayment`；**客户端无权确认支付**。
- `wx.requestPayment` 成功只代表拉起完成；支付结果以服务端查单/回调为准。轮询超时返回 `PAYMENT_RESULT_PENDING`，页面提示“请到订单页查看”。
- 结算页提交流程改为：校验表单 → `api.reserveOrder(input)` → `payment.payOrder(order.id)` → 成功跳转；重试复用同一 `idempotencyKey`。

### 7.2 订单列表与详情

`pages/orders/index`：

- 服务端 `statusGroup` tab：全部 / 待支付 / 进行中 / 已完成 / 已取消；
- `nextCursor` 分页，`nextCursor = null` 展示到底；
- 错误按 `error.code` 映射，`INVALID_CURSOR` 时回到第一页并提示。

`pages/orders/detail`：

- 展示商品、费用快照、取货人、门店、规则版本、状态时间线；
- 取货码仅在已支付后由 `getOrder` 返回，`ready` 时突出显示；
- 轮询策略：仅页面可见时轮询；支付确认阶段 1–2 秒短轮询，普通履约阶段 5 秒起步并逐步退避到 30 秒；隐藏/卸载清理定时器。

### 7.3 再次购买

- 只读取历史订单的 `productId/SKU` 和数量，**不复用**旧价格、优惠、时段、备注；
- 重新查询当前商品/SKU 的可售状态、当前价格、限购和库存；
- 部分商品不可售时列出原因，顾客确认后可加入可售项；
- 明确与现有购物车的关系：默认**合并**，同 SKU 数量相加但不超过当前限购上限，超出时裁剪并提示；
- 再次购买最终必须重新选择日期/时段并重新走服务端校验（PRD C-063）。

### 7.4 取货人信息

- 姓名必填，1–30 字；
- 手机号校验前先归一化：去空格、全角转半角、去 `+86`/`86` 前缀，再按 `/^1\d{10}$/` 校验；
- 错误提示说明可执行修正方式，例如“请输入 11 位大陆手机号，可包含 +86”；
- 首次提交后写入本地草稿；页面明示用途、提供清除入口；
- `submit()` 校验通过后才允许预占；缺少姓名/手机号不进入支付状态。

---

## 8. 阶段划分与冻结期工程准备

### 8.1 P0：T0 设计冻结（本次）

完成并评审：

- `docs/order-concurrency-protocol.md`（已创建）；
- `docs/inventory-ledger-model.md`（已创建）；
- `docs/t0-sdk-security-audit.md`（已创建，待 spike 后形成最终处置）；
- `docs/t0-spike-evidence.md`（已创建；本地静态证据已记录，CloudBase 动态证据待执行）；
- 本文 v0.6；
- 独立 `t0-probe` 动态验证（槽位原语、条件更新、唯一索引、事务写上限、定时触发器、任务租约、复合索引查询计划；正式 `payment.create` 行为测试留到 P1）。

T0 退出以四份文档实际创建并通过评审、`t0-probe` 动态证据（含失败项）与安全审计结论落地为准，不以“处置索引已关闭”为准。评审通过前不进入 T1。

### 8.2 P1：交易地基 + 顾客订单域

P1 范围增加第二轮评审要求的交易地基能力：

- 库存预占账本、`reserveOrder` 输入约束/幂等键（HMAC 摘要）、`settleReservationOnce`、取消/超时、`order_events`；
- `payment_attempts` 集合（`activePaymentAttemptId` 原子槽位、逐笔成功核算、inactive 尝试回调仍可写终态、对账重试字段）、mock 支付 `create/callback/query`、支付成功结算、`paymentSettlementReconciler` 补偿对账；真实微信 provider 仍留在 P3；
- `listOrders/getOrder/getOrderEvents/cancelOrder`；
- 定时触发器、`task_leases` 租约、keyset 超时批处理、积压告警、未决支付重查与人工 SLA；
- 取货码一次性生成、`pickupCodeEnvelope` 保存、hash 核销、`pickup_code_guard` 全局限速 + `pickup_code_actor_guard` 人员级限速、重放处理；
- 手机号 `customerPhoneEnvelope`/masked/last4，最小 RBAC 与 `getOrderContact`（生产角色永拒）；
- `services/api.js` 错误契约、`services/payment.js` 唯一支付编排入口；
- 订单列表/详情、结算页取货人、再次购买；
- `wx-server-sdk` 已锁定 4.0.2，lockfile 已生成、冻结后提交。

### 8.3 P2：商户端履约化

- `listMerchantOrders/getMerchantOrder` 与完整角色权限矩阵：owner、店长、客服、生产；生产不可见完整手机号、不可退款和导出；
- 生产看板按 **经营日期 → 时段 → 商品/SKU** 聚合 `pending_acceptance/accepted/making`；单独展示 `ready` 与超时未取货积压，覆盖跨日订单和临时关闭/新增时段；
- 接单、制作、备妥、核销作用于指定订单，并写 `order_events`；
- 时段关闭/恢复、容量调整，写审计；
- 打印/订阅消息/银豹继续 adapter，失败进 outbox 重试与人工补偿队列。

### 8.4 P3：真实微信支付 provider

P1 已用 mock provider 完成支付结构、竞态与补偿；P3 只做真实渠道接入：

- `payment` 云函数接入真实微信支付 `create/callback/query`，复用 P1 的 `payment_attempts` 与结算协议；
- 验签、证书/密钥管理、商户单号、金额与币种校验；
- 真实退款接口与 `refund_tasks` 对接；
- 微信支付成功/失败/超时/重复通知的真实验收；
- 不写死真实密钥，不提前调用真实支付。

### 8.5 P4：内容、协议与运营配置

- 门店信息从硬编码抽到 `stores/runtime.js` 配置：店名、地址、电话、营业日历、取货指引；
- 商品图片迁到云存储；本地/外链只作为开发 fallback；
- 商品原料、过敏原、保存方式、保质期、预订规则、提前量、限购字段补齐；
- 用户协议、隐私政策、退款规则页面（草稿先行，审核前替换终稿）；
- 时段模板、容量、包装费、最晚下单时间、库存计划批量生成配置化；
- 异常 SOP：缺货、打印失败、未取货、客诉的人工处理；
- 账号注销/个人信息删除入口与法定留存隔离落地。

### 8.6 P2–P5 资质冻结期可完成的工程准备

以下均不依赖门店资质，PRD 已列为 P0：

- dev/staging/prod 环境隔离、配置校验、发布与回滚演练；
- 云数据库每日备份与恢复演练；
- 支付、超时任务、库存异常、回调积压、退款队列的监控告警；
- 云函数超时、重试、配额与成本预算；
- 未完成订单应急导出（CSV/XLSX，手机号默认脱敏，导出需权限与审计）；
- 订阅消息失败、打印失败的重试与人工补偿队列；
- 隐私数据查看审计、删除/注销入口、法定留存隔离与留存期后去标识化；
- 峰值三倍的库存/下单/支付回调压测；
- 云数据库索引、定时触发器、权限规则、密钥清单纳入 runbook。

### 8.7 P5：真实环境迁移与试营业验收

- 初始化 `stores/inventory_plans/slot_plans`，从商品主数据迁移到 `storeId + businessDate + SKU` 账本；**全局商品计数不得直接带入生产**；
- 创建/验证全部索引、定时触发器、权限规则、密钥与备份；
- 真实微信支付 0.01 元、重复回调、迟到回调、断点恢复；
- 真实云环境跑通至少 20 笔完整订单；
- 双设备并发抢最后一件/最后一个时段名额；
- 试营业演练：超时积压、打印失败、订阅消息失败、人工补偿。

---

## 9. 数据字段调整与迁移

订单文档目标字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `storeId` | string | 履约门店，必填 |
| `businessDate` | string | `YYYY-MM-DD`，Asia/Shanghai 经营日期 |
| `slotId` | string | 时段快照关联 |
| `customerName` | string | 取货人姓名 |
| `customerPhoneEnvelope` | object | 版本化 AES-GCM envelope（enc/kv/iv/tag/ct/aad）；demo 为空 |
| `customerPhoneMasked` | string | `138 **** 0826` |
| `customerPhoneLast4` | string | 后四位，客服检索 |
| `remark` | string | 0–200 字 |
| `cancelledAt` | string/null | 取消时间 |
| `cancelReason` | string/null | `customer / timeout` |
| `cancelledBy` | string/null | `customer / system` |
| `idempotencyKeyHash` | string | 幂等摘要（不存原始 key 可读信息） |
| `settlementState / orderSettledAt` | string | 结算状态与结算时间 |
| `activePaymentAttemptId` | string/null | 当前支付尝试槽位，与尝试创建/失效同一订单版本事务变更 |
| `refundTaskIds` | array | 本订单全部退款任务引用 |
| `paymentCheckDueAt / lastPaymentCheckAt / paymentCheckRetryCount / timeoutSweepState` | string/number | 超时批处理与未决支付重查 |
| `pickupCodeEnvelope / pickupCodeHash / pickupCodeGeneratedAt` | object/string | 取货码版本化密文、核销 hash、生成时间 |
| `itemsSnapshot / feeSnapshot / fulfillmentSnapshot / ruleSnapshot` | object | 下单快照 |
| `version` | number | 乐观锁版本 |
| `status/paymentStatus/refundStatus/productionStatus` | string | 分字段状态 |

不保存 `statusLabel`、不保存订单内嵌状态日志数组、不保存取货码明文。

迁移：

- 旧 demo 本地订单只用于开发展示，前端兜底 `customerName: "张女士"` 和空备注，不迁移为生产数据；
- 云模式上线前由 P5 初始化脚本导入库存计划和历史测试订单，历史订单只导入已脱敏/去标识字段；
- 不在 P1–P4 声称任何旧全局库存数据可平滑进入试营业。

---

## 10. 测试策略

| 层级 | 内容 | 证明力 |
|---|---|---|
| L1 单元测试 | 状态机、`settleReservationOnce` 纯决策、手机号归一化/脱敏、cursor 编解码、再次购买裁剪 | 分支逻辑 |
| L2 云函数行为测试 | 内存 mock `wx-server-sdk`，验证鉴权、DTO、幂等、分支 | 仅第一层，**不证明**事务冲突/索引/服务端时间 |
| L3 云环境集成测试 | 真实云开发环境或可验证事务语义的 emulator：复合索引、双字段排序、游标谓词、定时触发器、并发重试、服务端时间 | 硬性验收 |
| L4 demo 行为测试 | Node mock `Page/getApp/wx`，验证双模式一致性与本地超时模拟 | demo 语义 |
| L5 WXML/WXSS 防回归 | 订单列表/详情关键结构 | UI 防回归 |
| L6 页面 E2E | miniprogram-automator | 交互闭环 |
| L7 真机/双设备 | 真实 AppID 就绪后 | 最终并发与支付 |

硬性测试矩阵（P1 验收必须包含，L3 为必需层）：

- 取消 × 取消、取消 × 超时、取消 × 支付回调、超时 × 支付回调并发矩阵；
- 支付已成功但回调迟到、重复回调、回调乱序、查单结果与回调不一致；
- **两个并发 `payment.create` 只返回同一 `merchantOrderNo`**：通过 `activePaymentAttemptId + version` 事务抢占槽位；
- **失效尝试迟到回调**：A 参数过期并失效 → 创建 B → B 成功 → A 迟到成功；A 必须被记录为资金事实并进入 `duplicate_charge` 退款，B 为主支付；
- **两次支付尝试均成功、回调乱序、第二笔退款失败**：第一笔 `settled`，第二笔 `refund_pending` 且存在 `refundReason=duplicate_charge, refundScope=payment_attempt` 的独立退款任务；订单主 `refundStatus` 不变；
- **对账失败次数持久化**：`settlementRetryCount/settlementNextRetryAt/settlementLastError/settlementReviewState` 正确推进；查询只取 `auto_retry` 且到期记录，单轮 keyset 每条一次；第三次失败转 `manual_review` 并置 `settlementNextRetryAt=null`，**连续运行十轮定时任务也不再自动处理**；人工恢复后才重新进入；
- **AES-GCM envelope**：CSPRNG 96-bit nonce、AAD 绑定 `orderId+fieldName+kv+enc`、解密失败告警且不生成新取货码；
- **任务租约**：两个对账实例并发只一个取得 `task_leases`；获取校验 `updated=1`；续租匹配 `ownerId + version`，旧实例不能覆盖新持有者；
- **取货码限速**：全局 5 次/5 分钟锁定与人员级 3 次/5 分钟锁定分别计数；成功核销清除两级 guard；核销重放返回原记录；
- **HMAC 轮换**：轮换后旧幂等键按记录 `keyVersion` 复核成功，不误报 `IDEMPOTENCY_KEY_CONFLICT`；
- 同一幂等键并发创建订单只能得到一张订单；
- 同一 SKU 重复出现在 `items`、负数/零数/小数/超大数量、重复商品行；
- 最后一件商品和最后一个时段名额的并发竞争；
- 事务写入一半失败、审计写入失败、超时任务重跑、超时任务中途失败恢复；
- 同时间戳订单跨页、筛选后跨页、新订单插入期间翻页、篡改游标；
- 顾客 A 读取/取消顾客 B 订单（统一返回 `ORDER_NOT_FOUND`），生产角色读取完整手机号（返回 `FORBIDDEN`）；
- 库存计数与预占记录不一致时整体回滚并产生独立 `ops_alerts`（告警不在事务内，回滚后仍存在）；
- 迟到支付命中已取消订单时进入 `refund_pending` 队列且不重复释放库存；
- 支付终态写入成功后、订单结算前模拟进程终止：对账任务或重复回调必须完成结算，不留下 `payment_attempts=success + pending_payment + reserved`；
- 超时批处理中注入一批未决支付订单：单轮内每单最多处理一次，后续批次不饿死，查单未知按 `paymentCheckDueAt` 退避，达到上限转 `manual_review`；
- 幂等摘要使用 HMAC：同键同摘要幂等，同键不同摘要 `IDEMPOTENCY_KEY_CONFLICT`，日志/响应/埋点不含摘要；
- 大订单上限：20 个不同 SKU、单行 10、整单 30，超过即拒绝；
- T0 SDK spike：事务内 `_id + version` 条件更新、唯一索引冲突、事务写上限、`db.serverDate()`、复合索引查询计划、定时触发器样例。

测试基线与口径：

- `npm test` 必须保持 13/13 通过并随 P1 增加；
- `npm run lint` 口径为 **0 error**；现有 6 个 `<img>` performance warning 作为既有基线单独记录，不阻塞本次 P1；
- 内存 mock 不得作为事务、索引、并发、定时触发的最终证明。

---

## 11. 任务拆解与验收

### T0 设计冻结、SDK 最小验证与安全审计（本次）

- 评审并冻结本方案 v0.6、`docs/order-concurrency-protocol.md`、`docs/inventory-ledger-model.md`、`docs/t0-sdk-security-audit.md`、`docs/t0-spike-evidence.md`；
- 执行 `docs/t0-spike-evidence.md` §2 的独立 `t0-probe`：槽位原语、`_id + version` 条件更新、唯一索引冲突、事务写上限、`db.serverDate()`、定时触发器、`task_leases`、复合索引查询计划；正式 `payment.create` 行为测试推迟到 P1；
- `wx-server-sdk` 已锁定 4.0.2，三个 lockfile 已生成；**尚未提交**，T0 冻结通过后随 T0 变更一并提交；spike 不兼容时变更并重新锁定；
- 完成 `docs/t0-sdk-security-audit.md` 的漏洞可达性、override 回归、缓解/风险接受结论，作为 T0 退出硬门槛；
- 验收：四份专项文档实际创建并通过评审；动态 spike 证据（含失败项）与安全审计结论落地；一至五轮 P0 全部关闭。

### T1 库存账本与 `reserveOrder`

- 实现 `stores/inventory_plans/slot_plans/order_reservations` 模型与 demo 镜像；
- `reserveOrder` 幂等键、HMAC 摘要、重复行合并、数量/上限校验（≤20 SKU 行、单行 ≤10、整单 ≤30）；
- 营业状态、最晚下单时间、提前量、时段关闭校验；
- 验收：§10 中下单相关矩阵；并发同键只一单；取货码不在预占阶段生成。

### T2 统一结算引擎、支付补偿与取消/超时

- 实现 `settleReservationOnce`、`payment_attempts`（含 `activePaymentAttemptId + version` 原子槽位、逐笔成功核算、`refundReason/refundScope`、`settlementRetryCount/settlementNextRetryAt/settlementLastError/settlementReviewState`）、mock 支付成功/重复回调/迟到回调/两次成功回调处理、`paymentSettlementReconciler`；
- 手动取消、系统超时复用同一结算入口；
- 审计只在实际转换事务内写；异常告警在事务外独立写；
- 验收：两个并发 `create` 同 `merchantOrderNo`、两次支付均成功且主退款状态不被污染、第二笔退款失败、对账 `manual_review` 后连续十轮不再自动处理、对账失败持久化退避、支付终态落库后崩溃恢复、审计失败回滚、超时重跑、积压告警、退款 outbox 同事务、任务租约。

### T3 `listOrders / getOrder / getOrderEvents`

- 服务端 `statusGroup`、稳定排序、游标校验、`limit+1`、`nextCursor: null`；
- 索引创建与 L3 验证；云数据库不支持元组谓词时启用 `cursorKey` 备选；
- 验收：同时间戳跨页、筛选跨页、翻页中插入、篡改游标、末页契约。

### T4 `services/api.js` 与支付编排

- `ApiError(code)` 错误契约；
- `payOrder(orderId)` 为唯一支付入口，页面移除 `api.confirmPayment` 调用；
- 验收：三种支付模式分支、微信模式客户端无法确认支付。

### T5 订单列表/详情页

- 状态 tab、分页、空/错/loading、错误码映射；
- 详情 DTO、费用/履约/规则快照、`order_events` 时间线；
- 可见性轮询与退避；
- 验收：L4/L5/L6 + `INVALID_CURSOR` 恢复。

### T6 结算页取货人与再次购买

- 手机号归一化校验、本地草稿告知与清除；
- 再次购买合并/裁剪/不可售原因；
- 验收：非法手机号不进入支付；再次购买不携带旧价格/旧时段。

### T7 手机号加密、取货码与最小 RBAC

- 云模式使用 `customerPhoneEnvelope`（AES-256-GCM，iv/tag/ct/aad）+ masked/last4；顾客详情无完整手机号；
- 取货码结算事务一次性生成，`pickupCodeEnvelope` 保存、hash 核销、`pickup_code_guard` 全局限速 + `pickup_code_actor_guard` 人员/设备级限速、重放返回原记录；
- P1 实现最小 RBAC：`owner/customer_service` 可调 `getOrderContact` 并审计，`production` 返回 `FORBIDDEN`；
- 验收：订单文档无明文手机号；生产角色 `FORBIDDEN`；查看审计存在；取货码读取稳定不变；nonce 复用/解密失败告警路径通过。

### T8 超时触发器与告警

- 定时触发器配置、`task_leases` 租约、keyset 游标批处理、`paymentCheckDueAt/retryCount/timeoutSweepState`、未决支付重查与人工 SLA；
- 验收：L3 真实触发/emulator；构造超过 50 单积压且含未决支付订单时可分批推进、不无限重复同一批；多实例并发只一个租约；任务重跑和中途失败恢复后无重复释放、无虚假审计。

### T9 P3 真实微信支付 provider

- 接入真实微信支付 `create/callback/query` 与退款接口，复用 P1 的 `payment_attempts`/`settleReservationOnce`/`refund_tasks`；
- 验签、证书/密钥管理、金额/币种校验、真实通知验收；
- 验收：§10 支付矩阵在真实 provider 下通过。

### T10 冻结期工程准备与 runbook

- §8.6 全部项目列入任务池；
- `docs/go-live-runbook.md`：索引、触发器、权限、密钥、备份、回滚、导出、人工补偿。

### T11 云环境集成测试

- 建立 L3 测试环境或可验证事务 emulator；
- 跑 §10 全部硬性矩阵；
- 验收：L3 报告作为 P1 退出证据。

### T12 文档更新

- `wechat-miniprogram/README.md`、本方案、PRD 差异清单同步更新。

---

## 12. 风险与开放问题

1. **云数据库元组游标能力**：`createdAt DESC, _id DESC` 的严格元组谓词是否被云数据库可靠支持需 T3 在真实环境验证；已明确 `cursorKey` 备选方案，不再允许“最近 50 单”降级。
2. **定时触发器在 tourist 环境不可验证**：P1 用 L3/emulator 和直接调用 `runOrderTimeoutSweep` 验证；真实触发器作为 P5 硬性验收项。
3. **服务端密钥系统可用性**：若当前云环境暂不支持 KMS，先用云函数环境变量 + AES-GCM 过渡，但试营业前必须完成密钥隔离、轮换与访问审计；此为硬退出条件。
4. **支付查单超时**：未决支付尝试按 §5.4/§5.5 处理，不自动释放库存；宽限期后人工处置，避免“已扣款、订单已取消”。
5. **微信登录与 profile 授权**：云模式以 `openid` 为身份；profile 页授权逻辑是否保留另行确认，不影响订单身份。
6. **Web 版与小程序版双轨**：本方案只改小程序和其云函数，`app/api` Web 版保持不动；未来同源另立方案。
7. **支付凭据不可写入仓库**：真实商户号、API v3 密钥、证书只放服务端密钥系统；`project.private.config.json` 继续 gitignore。
8. **CloudBase 事务/索引能力未验证**：事务内 `_id + version` 条件更新、唯一索引冲突、事务写上限、复合索引和 `wx-server-sdk` 版本必须在 T0/T11 实测；T0 报告未通过不得进入 T1。
9. **`wx-server-sdk` 版本与 lockfile 状态**：已锁定 4.0.2，三个 lockfile 已生成但**尚未提交**；待 T0 冻结评审通过后随 T0 变更提交。T0 spike 不兼容时变更并重新锁定。
10. **SDK 安全审计未关闭**：4.0.2 传递依赖存在 5 high + 1 moderate；自动降级到 2.5.3 不得执行。必须完成 `docs/t0-sdk-security-audit.md` 的可达性、override 回归、缓解/风险接受结论后 T0 才可冻结；VPC/出口限制/WAF 等缓解必须先验证微信云开发环境可用，未验证前只是候选措施。

---

## 13. 阶段退出标准

P0/T0 退出标准：

- [ ] 本方案 v0.6 通过评审；
- [ ] `docs/order-concurrency-protocol.md`、`docs/inventory-ledger-model.md`、`docs/t0-sdk-security-audit.md`、`docs/t0-spike-evidence.md` 已实际创建并通过评审；
- [ ] 第一至五轮 P0 全部关闭，不以此前处置索引替代；
- [ ] `docs/t0-spike-evidence.md` 动态证据完成：独立 `t0-probe` 槽位原语、条件更新、唯一索引、事务写上限、`db.serverDate()`、定时触发器、任务租约、复合索引；每条证据含脱敏环境 ID、时间、SDK 版本、请求 ID、原始返回与清理结果；失败项保留并给出替代方案或协议回写；
- [ ] SDK 安全审计结论落地：漏洞可达性、override 回归、缓解/风险接受、生产硬门槛与上游跟踪；
- [ ] `wx-server-sdk` 已锁定 4.0.2，三个 lockfile 已生成；T0 spike 不兼容时变更并重新锁定；lockfile 随 T0 冻结评审通过后提交。

P1 退出标准：

- [ ] `npm test` 全部通过，新增测试覆盖 §10 硬性矩阵；
- [ ] L3 云环境/emulator 集成报告证明事务、索引、游标、定时触发器、任务租约；
- [ ] `npm run lint` 0 error；
- [ ] 微信开发者工具 + tourist AppID 下，demo 模式可完成：创建两个订单、状态筛选与稳定翻页、取消一个待支付订单后库存和时段容量恢复、另一个订单继续支付、历史订单再次购买；
- [ ] mock 支付回调竞态矩阵通过：终态落库后崩溃可补偿结算、重复回调仍走结算入口、迟到回调进入退款 outbox、两次成功扣款逐笔核算；
- [ ] 两个并发 `payment.create` 只返回同一 `merchantOrderNo`；
- [ ] A 参数过期失效 → 创建 B → B 成功 → A 迟到成功：A 记录并退款，B 为主支付；
- [ ] 对账任务失败持久化退避、3 次转人工后连续十轮不再自动处理，人工恢复后可继续；
- [ ] 重复扣款退款成功不会把主订单 `refundStatus` 变为 `refunded`；
- [ ] 超时批处理 keyset 游标验收通过：含未决支付订单的积压不被同一批无限重复；
- [ ] 取货码只生成一次，读取稳定，`pickup_code_guard + pickup_code_actor_guard` 双级限速与核销重放通过；
- [ ] 订单文档无明文手机号/取货码明文，预占阶段无取货码，顾客详情只返回 masked；
- [ ] 最小 RBAC 通过：生产角色读取完整手机号返回 `FORBIDDEN`，查看审计存在；
- [ ] 超时批处理可重跑且无虚假审计；
- [ ] README 与行为文档和代码一致。

全部阶段退出标准：

- [ ] 资质到齐后，按 `go-live-runbook.md` 完成 P5 真实环境迁移，全局 demo 库存已替换为日库存账本；
- [ ] 真实云开发环境跑通至少 20 笔完整订单；
- [ ] 真实支付 0.01 元、重复回调、迟到回调、断点恢复通过；
- [ ] 双设备并发抢最后一件商品/最后一个时段名额通过；
- [ ] 备份恢复、未完成订单导出、监控告警、密钥轮换演练通过；
- [ ] 真实打印机/订阅消息或人工补偿流程通过；
- [ ] PRD 第 18 节 P0 验收清单逐项签字。

---

## 14. 建议执行顺序

1. 评审本方案 v0.6 与四份 T0 专项文档；
2. 执行独立 `t0-probe` 动态 spike 并完成 SDK 安全审计，形成可冻结结论；
3. 冻结 T0 并提交四份 T0 文档与 lockfile；
4. 实施 T1 + T2 + T8（库存账本、结算引擎、mock 支付补偿、超时任务，交易地基优先）；
5. 实施 T3 + T4（API 契约、分页、支付编排）；
6. 实施 T5 + T6 + T7（顾客侧页面、隐私字段、取货码与最小 RBAC）；
7. 并行启动 T10 + T11（冻结期准备、集成测试）；资质到齐后实施 T9 真实微信 provider；
8. P1 评审通过后拆分 P2；P5 前完成全部迁移与试营业验收。
