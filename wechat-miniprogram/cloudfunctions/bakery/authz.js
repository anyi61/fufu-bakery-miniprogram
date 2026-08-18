const ROLE_PERMISSIONS = {
  owner: ["*"],
  manager: ["order.read", "order.accept", "order.make", "pickup.verify", "inventory.adjust", "staff.manage"],
  operator: ["order.read", "order.accept", "order.make", "pickup.verify"],
  clerk: ["order.read", "pickup.verify"],
};

function hasPermission(staff, permission, storeId) {
  if (!staff || staff.active !== true || staff.storeId !== storeId) return false;
  const permissions = ROLE_PERMISSIONS[staff.role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

function permissionForTransition(nextStatus) {
  if (nextStatus === "accepted") return "order.accept";
  if (nextStatus === "making" || nextStatus === "ready") return "order.make";
  if (nextStatus === "completed") return "pickup.verify";
  return null;
}

module.exports = { hasPermission, permissionForTransition, ROLE_PERMISSIONS };
