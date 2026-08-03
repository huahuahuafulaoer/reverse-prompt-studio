function locateFinding(audit, findingId) {
  for (const gate of audit.gates) {
    const finding = gate.findings.find((item) => item.id === findingId);
    if (finding) return { gate, finding };
  }
  throw new Error(`Finding not found: ${findingId}`);
}

export function createRepairContract({ audit, findingId, allPaths }) {
  const { gate, finding } = locateFinding(audit, findingId);
  if (gate.id !== audit.earliestFailureGate) {
    throw new Error("Only a finding in the earliest failed gate can be repaired");
  }
  const changePaths = [...new Set(finding.affectedPaths)].sort();
  const lockedPaths = [...new Set(allPaths)]
    .filter((path) => !changePaths.includes(path))
    .sort();
  const status = finding.requiresTruth || finding.humanReview ? "HOLD" : "READY";
  const platformPrompt = [
    "任务：对当前图片做局部高质量修复。",
    `只修改：${changePaths.join("、")}。`,
    `目标：${finding.targetResult}。`,
    `保持不变：${lockedPaths.join("、") || "除上述修改外的全部内容"}。`,
    "禁止：改变产品身份、结构、比例、构图、镜头、品牌文字或未列入 changePaths 的内容。",
    `验收：${finding.acceptanceChecks.join("；")}。`,
  ].join("\n");
  return {
    schema: "brand-grade-repair-contract/v1",
    sourceVersionId: audit.sourceVersionId,
    findingId,
    gateId: gate.id,
    status,
    route: finding.recommendedRoute,
    changePaths,
    lockedPaths,
    targetResult: finding.targetResult,
    acceptanceChecks: [...finding.acceptanceChecks],
    platformPrompt,
  };
}
