import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGateRail,
  canApproveCandidate,
  friendlyFinishError,
  gateLabel,
  presentAudit,
  presentComparison,
  repairActionState,
  statusLabel,
} from "../public/finish-state.js";

const gate = (id, status, findings = []) => ({
  id,
  name: `internal ${id}`,
  status,
  summary: `${id} ${status} summary`,
  findings,
});

const finding = (overrides = {}) => ({
  id: "G1-F01",
  severity: "major",
  title: "人物接触不自然",
  observedEvidence: "脚底与地面之间出现悬空。",
  affectedPaths: ["S.feet", "A.contact"],
  targetResult: "让脚底与地面形成可信接触。",
  recommendedRoute: "local_edit",
  requiresTruth: false,
  humanReview: false,
  acceptanceChecks: ["接触自然"],
  ...overrides,
});

test("highlights only the earliest failed gate", () => {
  const rail = buildGateRail([
    { id: "G1", status: "PASS" },
    { id: "G2", status: "FAIL" },
    { id: "G3", status: "FAIL" },
    { id: "G4", status: "HOLD" },
  ], "G2");
  assert.deepEqual(rail.map((item) => item.isCurrent), [false, true, false, false]);
});

test("disables repair while truth or human review is required", () => {
  assert.deepEqual(
    repairActionState({ requiresTruth: true, humanReview: false }),
    { enabled: false, label: "补充参考" },
  );
  assert.deepEqual(
    repairActionState({ requiresTruth: false, humanReview: true }),
    { enabled: false, label: "需要确认" },
  );
});

test("maps gate, status, action, and service errors to concise user language", () => {
  assert.deepEqual(["G1", "G2", "G3", "G4"].map(gateLabel), ["真实感", "画面", "品牌", "交付"]);
  assert.deepEqual(["PASS", "HOLD", "FAIL"].map(statusLabel), ["通过", "待确认", "需修复"]);
  assert.equal(repairActionState(finding()).label, "生成修复指令");
  assert.equal(
    friendlyFinishError(new Error("invalid_json_schema at visualState G1"), "audit"),
    "本次未完成诊断，请重试",
  );
  assert.equal(
    friendlyFinishError(new TypeError("Failed to fetch"), "comparison"),
    "连接中断，请稍后重试",
  );
  assert.equal(
    friendlyFinishError(new Error("requiresTruth humanReview"), "audit"),
    "需要补充参考信息",
  );
});

test("presents a failed audit without backend ids, paths, routes, or English statuses", () => {
  const audit = {
    earliestFailureGate: "G1",
    gates: [gate("G1", "FAIL", [finding()]), gate("G2", "PASS"), gate("G3", "PASS"), gate("G4", "PASS")],
  };
  const presented = presentAudit(audit);

  assert.equal(presented.title, "先修复人物与场景的真实感");
  assert.deepEqual(presented.gates.map(({ label, status }) => [label, status]), [
    ["真实感", "需修复"], ["画面", "通过"], ["品牌", "通过"], ["交付", "通过"],
  ]);
  assert.deepEqual(presented.findings[0], {
    title: "人物接触不自然",
    observation: "脚底与地面之间出现悬空。",
    suggestion: "让脚底与地面形成可信接触。",
    action: { enabled: true, label: "生成修复指令" },
  });
  assert.doesNotMatch(JSON.stringify(presented), /G1|PASS|FAIL|major|S\.feet|A\.contact|local_edit/);
});

test("presents HOLD and all-pass audits as complete user decisions", () => {
  const hold = presentAudit({
    earliestFailureGate: "G3",
    gates: [
      gate("G1", "PASS"),
      gate("G2", "PASS"),
      gate("G3", "HOLD", [finding({ requiresTruth: true, title: "品牌信息不足" })]),
      gate("G4", "PASS"),
    ],
  });
  assert.equal(hold.title, "先补充品牌判断所需的信息");
  assert.equal(hold.findings[0].action.label, "补充参考");

  const passed = presentAudit({
    earliestFailureGate: null,
    gates: [gate("G1", "PASS"), gate("G2", "PASS"), gate("G3", "PASS"), gate("G4", "PASS")],
  });
  assert.equal(passed.title, "这张图已通过检查");
  assert.deepEqual(passed.findings, []);
});

test("presents candidate success and lock drift without paths or verdict enums", () => {
  const success = presentComparison({
    verdict: "PASS",
    allowedUse: "approved_source",
    gates: [gate("G1", "PASS"), gate("G2", "PASS"), gate("G3", "PASS"), gate("G4", "PASS")],
    lockDrift: [],
  });
  assert.equal(success.outcome, "修复有效");
  assert.equal(success.reason, "这张图可以批准为交付图。");

  const changed = presentComparison({
    verdict: "FAIL",
    allowedUse: "comparison_only",
    gates: [gate("G1", "PASS"), gate("G2", "PASS"), gate("G3", "PASS"), gate("G4", "FAIL")],
    lockDrift: [{ path: "M.subject", observed: "产品轮廓改变", status: "FAIL" }],
  });
  assert.equal(changed.outcome, "仍需调整");
  assert.equal(changed.reason, "有不该改变的内容发生了变化。");
  assert.doesNotMatch(JSON.stringify(changed), /M\.subject|产品轮廓改变|comparison_only|G4|PASS|FAIL/);
});

test("approves only an approved-source PASS without lock drift", () => {
  assert.equal(canApproveCandidate({
    verdict: "PASS",
    allowedUse: "approved_source",
    lockDrift: [],
  }), true);
  assert.equal(canApproveCandidate({
    verdict: "PASS",
    allowedUse: "approved_source",
    lockDrift: [{ status: "FAIL" }],
  }), false);
});
