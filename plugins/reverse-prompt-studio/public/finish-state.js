export function buildGateRail(gates, earliestFailureGate) {
  return gates.map((gate) => ({
    ...gate,
    isCurrent: gate.id === earliestFailureGate,
    tone: gate.status === "PASS"
      ? "pass"
      : gate.status === "HOLD"
        ? "hold"
        : "fail",
  }));
}

export function repairActionState(finding) {
  if (finding.requiresTruth) {
    return { enabled: false, label: "补充真值后继续" };
  }
  if (finding.humanReview) {
    return { enabled: false, label: "等待人工确认" };
  }
  return { enabled: true, label: "生成修复指令" };
}

export function canApproveCandidate(comparison) {
  return comparison?.verdict === "PASS"
    && comparison.allowedUse === "approved_source"
    && Array.isArray(comparison.lockDrift)
    && comparison.lockDrift.every((item) => item.status === "PASS");
}
