function money(cents) {
  return (Number(cents || 0) / 100).toFixed(Number(cents || 0) % 100 === 0 ? 0 : 2);
}

function slotText(slot) {
  return slot ? `${slot.startsAt}–${slot.endsAt}` : "暂无可约时段";
}

function statusStep(status) {
  return ["pending_acceptance", "accepted", "making", "ready", "completed"].indexOf(status);
}

module.exports = { money, slotText, statusStep };
