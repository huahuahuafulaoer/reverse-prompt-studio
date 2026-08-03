import test from "node:test";
import assert from "node:assert/strict";

import {
  validateBrandGradeAudit,
  validateBrandGradeComparison,
} from "../src/brand-grade-schema.mjs";

const audit = {
  schema: "brand-grade-audit/v1",
  sourceVersionId: "source-v1",
  truthLedger: {
    verified: ["瓶身轮廓来自 product_truth"],
    userProvided: ["首读是产品"],
    inferred: ["背景像室内工作台"],
    unknown: ["包装背标不可见"],
    humanReview: ["品牌色偏差需设计师确认"],
  },
  visualState: {
    M: { subject: "护肤品瓶装产品" },
    S: { setting: "室内工作台" },
    A: { artDirection: "克制、专业" },
    P: { composition: "中心产品主导" },
    C: { camera: "正面中近景" },
    K: { lighting: "左上柔光" },
    L: { palette: "低饱和暖灰" },
    G: { texture: "瓶身有蜡感假纹理" },
    E: { effects: "无" },
    R: { references: ["product_truth"] },
    T: { typography: "无" },
    Q: { quality: "边缘需清理" },
    X: { exclusions: ["不要改变瓶型"] },
  },
  inputs: [{ id: "source-v1", role: "edit_target", filename: "source.png" }],
  gates: [
    {
      id: "G1",
      name: "Truth & Physics",
      status: "FAIL",
      summary: "瓶身材质不可信",
      findings: [{
        id: "G1-F01",
        severity: "blocker",
        title: "瓶身蜡感",
        observedEvidence: "高光没有遵循瓶身曲率",
        affectedPaths: ["G.texture", "K.lighting"],
        targetResult: "恢复真实塑料曲率高光",
        recommendedRoute: "local_edit",
        requiresTruth: true,
        humanReview: false,
        acceptanceChecks: ["瓶型不变", "高光连续"],
      }],
    },
    { id: "G2", name: "Art Direction", status: "PASS", summary: "构图可用", findings: [] },
    {
      id: "G3",
      name: "Brand & Campaign",
      status: "HOLD",
      summary: "缺少渠道信息",
      findings: [{
        id: "G3-F01",
        severity: "major",
        title: "渠道未知",
        observedEvidence: "brief 未填写 channel",
        affectedPaths: ["A.brandCharacter"],
        targetResult: "补充渠道",
        recommendedRoute: "human_review",
        requiresTruth: false,
        humanReview: true,
        acceptanceChecks: ["确认投放渠道"],
      }],
    },
    {
      id: "G4",
      name: "Production Finish",
      status: "FAIL",
      summary: "边缘有噪点",
      findings: [{
        id: "G4-F01",
        severity: "major",
        title: "边缘噪点",
        observedEvidence: "右侧轮廓有锯齿",
        affectedPaths: ["Q.edgeQuality"],
        targetResult: "清洁边缘",
        recommendedRoute: "manual_retouch",
        requiresTruth: false,
        humanReview: false,
        acceptanceChecks: ["轮廓连续"],
      }],
    },
  ],
  earliestFailureGate: "G1",
  verdict: "FAIL",
  allowedUse: "diagnosis_only",
};

test("accepts a complete audit", () => {
  assert.equal(validateBrandGradeAudit(audit).earliestFailureGate, "G1");
});

test("rejects an unknown gate status", () => {
  const invalid = structuredClone(audit);
  invalid.gates[0].status = "MAYBE";
  assert.throws(() => validateBrandGradeAudit(invalid), /status/);
});

test("rejects a reported earliest gate that contradicts gate results", () => {
  const invalid = structuredClone(audit);
  invalid.earliestFailureGate = "G4";
  assert.throws(() => validateBrandGradeAudit(invalid), /earliestFailureGate/);
});

test("accepts a comparison tied to one candidate", () => {
  const comparison = {
    schema: "brand-grade-comparison/v1",
    sourceVersionId: "source-v1",
    candidateVersionId: "candidate-v1",
    gates: audit.gates.map((gate) => ({ ...gate, status: "PASS", findings: [] })),
    lockDrift: [],
    earliestFailureGate: null,
    verdict: "PASS",
    allowedUse: "approved_source",
  };
  assert.equal(validateBrandGradeComparison(comparison).verdict, "PASS");
});
