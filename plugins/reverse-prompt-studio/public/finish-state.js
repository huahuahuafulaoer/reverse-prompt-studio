const gatePresentation = {
  G1: {
    label: "真实感",
    failTitle: "先修复人物与场景的真实感",
    holdTitle: "先补充真实感判断所需的信息",
  },
  G2: {
    label: "画面",
    failTitle: "先调整画面表现",
    holdTitle: "先确认画面方向",
  },
  G3: {
    label: "品牌",
    failTitle: "先校准品牌表达",
    holdTitle: "先补充品牌判断所需的信息",
  },
  G4: {
    label: "交付",
    failTitle: "先完善交付细节",
    holdTitle: "先确认交付要求",
  },
};

const statusPresentation = {
  PASS: { label: "通过", tone: "positive", icon: "✓" },
  HOLD: { label: "待确认", tone: "caution", icon: "!" },
  FAIL: { label: "需修复", tone: "critical", icon: "×" },
};

export function gateLabel(gateId) {
  return gatePresentation[gateId]?.label ?? "检查项";
}

export function statusLabel(status) {
  return statusPresentation[status]?.label ?? "待确认";
}

export function buildGateRail(gates, earliestFailureGate) {
  return gates.map((gate) => ({
    ...gate,
    isCurrent: gate.id === earliestFailureGate,
    tone: statusPresentation[gate.status]?.tone ?? "caution",
  }));
}

export function repairActionState(finding) {
  if (finding.requiresTruth) {
    return { enabled: false, label: "补充参考" };
  }
  if (finding.humanReview) {
    return { enabled: false, label: "需要确认" };
  }
  return { enabled: true, label: "生成修复指令" };
}

export function presentFinding(finding) {
  return {
    title: finding.title,
    observation: finding.observedEvidence,
    suggestion: finding.targetResult,
    action: repairActionState(finding),
  };
}

export function presentAudit(audit) {
  const activeGate = audit.gates.find((gate) => gate.id === audit.earliestFailureGate);
  const state = activeGate ? gatePresentation[activeGate.id] : null;
  return {
    title: !activeGate
      ? "这张图已通过检查"
      : activeGate.status === "HOLD"
        ? state?.holdTitle ?? "先补充判断所需的信息"
        : state?.failTitle ?? "先处理当前问题",
    allPass: !activeGate,
    gates: buildGateRail(audit.gates, audit.earliestFailureGate).map((gate) => ({
      label: gateLabel(gate.id),
      status: statusLabel(gate.status),
      tone: gate.tone,
      icon: statusPresentation[gate.status]?.icon ?? "!",
      isCurrent: gate.isCurrent,
    })),
    findings: (activeGate?.findings ?? []).map(presentFinding),
  };
}

export function presentComparison(comparison) {
  const approvable = canApproveCandidate(comparison);
  const changedUnexpectedly = comparison.lockDrift?.some((item) => item.status !== "PASS");
  const needsReference = comparison.gates?.some((gate) => gate.status === "HOLD");
  return {
    outcome: approvable ? "修复有效" : "仍需调整",
    reason: approvable
      ? "这张图可以批准为交付图。"
      : changedUnexpectedly
        ? "有不该改变的内容发生了变化。"
        : needsReference
          ? "还需要补充参考信息或人工确认。"
          : "当前问题还没有完全解决。",
    approvable,
  };
}

export function friendlyFinishError(error, context = "default") {
  const message = String(error?.message ?? error ?? "");
  if (/requiresTruth|humanReview|truth|真值|人工确认/i.test(message)) {
    return "需要补充参考信息";
  }
  if (/failed to fetch|network|connection|ECONN|JSON-RPC|连接|中断/i.test(message)) {
    return "连接中断，请稍后重试";
  }
  const fallback = {
    upload: "图片上传失败，请重试",
    audit: "本次未完成诊断，请重试",
    contract: "修复指令生成失败，请重试",
    comparison: "修复图检查未完成，请重试",
    approval: "批准未完成，请重试",
  };
  return fallback[context] ?? "操作未完成，请重试";
}

export function canApproveCandidate(comparison) {
  return comparison?.verdict === "PASS"
    && comparison.allowedUse === "approved_source"
    && Array.isArray(comparison.lockDrift)
    && comparison.lockDrift.every((item) => item.status === "PASS");
}
