export function evaluateMerchantAccess({ enabled, allowedUserIds, userId, email }) {
  if (!enabled) return { ok: false, status: 403, message: "商户 API 未启用" };
  if (!userId || !email) return { ok: false, status: 401, message: "请先登录" };
  if (!allowedUserIds.has(userId)) return { ok: false, status: 403, message: "需要门店权限" };
  return { ok: true, actor: { userId, email } };
}
