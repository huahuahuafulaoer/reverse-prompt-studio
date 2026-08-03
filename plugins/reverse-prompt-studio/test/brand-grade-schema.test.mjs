import test from "node:test";
import assert from "node:assert/strict";

import * as brandGradeSchema from "../src/brand-grade-schema.mjs";
import {
  brandGradeAuditOutputSchema,
  validateBrandGradeAudit,
  validateBrandGradeComparison,
} from "../src/brand-grade-schema.mjs";

function assertStrictObjectSchemas(schema, path = "$") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.ok(
      schema.properties && typeof schema.properties === "object",
      `${path} must declare fixed properties`,
    );
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must set additionalProperties=false`,
    );
    assert.ok(Array.isArray(schema.required), `${path} must declare required`);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
      `${path}.required must contain every property key and no extras`,
    );
  }
  for (const [key, child] of Object.entries(schema)) {
    if (key === "properties") {
      for (const [property, propertySchema] of Object.entries(child)) {
        assertStrictObjectSchemas(propertySchema, `${path}.properties.${property}`);
      }
    } else if (key === "items") {
      assertStrictObjectSchemas(child, `${path}.items`);
    } else if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      child.forEach((entry, index) => assertStrictObjectSchemas(entry, `${path}.${key}[${index}]`));
    }
  }
}

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

test("audit response schema uses the strict fixed-property profile for every object", () => {
  assertStrictObjectSchemas(brandGradeAuditOutputSchema);
});

test("audit response schema constrains visual-state paths to internal groups", () => {
  const pathPattern = new RegExp(
    brandGradeAuditOutputSchema.properties.visualState.items.properties.path.pattern,
  );
  assert.match("M.subject", pathPattern);
  assert.match("Q.edgeQuality", pathPattern);
  assert.doesNotMatch("D.dimensions", pathPattern);
  assert.doesNotMatch("M.subject.detail", pathPattern);
});

test("audit transport omits derived routing fields and normalization computes them", () => {
  assert.equal(brandGradeAuditOutputSchema.properties.earliestFailureGate, undefined);
  assert.equal(brandGradeAuditOutputSchema.properties.verdict, undefined);
  assert.ok(!brandGradeAuditOutputSchema.required.includes("earliestFailureGate"));
  assert.ok(!brandGradeAuditOutputSchema.required.includes("verdict"));
  const transport = structuredClone(audit);
  delete transport.earliestFailureGate;
  delete transport.verdict;
  transport.visualState = [{ path: "M.subject", value: "护肤品瓶装产品" }];
  transport.gates[0].status = "HOLD";
  transport.gates[2].status = "FAIL";

  const normalized = brandGradeSchema.normalizeBrandGradeAuditTransport(transport);

  assert.equal(normalized.earliestFailureGate, "G3");
  assert.equal(normalized.verdict, "FAIL");
  assert.equal(validateBrandGradeAudit(normalized), normalized);
});

test("normalizes flat visual-state transport entries into every internal group", () => {
  assert.equal(
    typeof brandGradeSchema.normalizeBrandGradeAuditTransport,
    "function",
    "normalizeBrandGradeAuditTransport must be exported",
  );
  const transport = {
    ...structuredClone(audit),
    visualState: [
      { path: "M.subject", value: "护肤品瓶装产品" },
      { path: "K.lighting", value: "左上柔光" },
      { path: "X.exclusions", value: "不要改变瓶型" },
    ],
  };

  const normalized = brandGradeSchema.normalizeBrandGradeAuditTransport(transport);

  assert.deepEqual(normalized.visualState.M, { subject: "护肤品瓶装产品" });
  assert.deepEqual(normalized.visualState.K, { lighting: "左上柔光" });
  assert.deepEqual(normalized.visualState.X, { exclusions: "不要改变瓶型" });
  assert.deepEqual(Object.keys(normalized.visualState), [
    "M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X",
  ]);
  assert.notEqual(normalized, transport);
});

test("rejects an illegal visual-state group or path", () => {
  assert.throws(
    () => brandGradeSchema.normalizeBrandGradeAuditTransport({
      ...audit,
      visualState: [{ path: "Z.subject", value: "产品" }],
    }),
    /visualState\[0\]\.path has an invalid group/,
  );
  for (const path of ["M", "M.", "M.subject.detail", "M. subject"]) {
    assert.throws(
      () => brandGradeSchema.normalizeBrandGradeAuditTransport({
        ...audit,
        visualState: [{ path, value: "产品" }],
      }),
      /visualState\[0\]\.path is invalid/,
    );
  }
});

test("rejects duplicate visual-state paths", () => {
  assert.throws(
    () => brandGradeSchema.normalizeBrandGradeAuditTransport({
      ...audit,
      visualState: [
        { path: "M.subject", value: "产品" },
        { path: "M.subject", value: "另一个产品" },
      ],
    }),
    /duplicate visualState path M\.subject/,
  );
});

test("rejects empty visual-state paths and values", () => {
  assert.throws(
    () => brandGradeSchema.normalizeBrandGradeAuditTransport({
      ...audit,
      visualState: [{ path: "", value: "产品" }],
    }),
    /visualState\[0\]\.path must be a non-empty string/,
  );
  assert.throws(
    () => brandGradeSchema.normalizeBrandGradeAuditTransport({
      ...audit,
      visualState: [{ path: "M.subject", value: "   " }],
    }),
    /visualState\[0\]\.value must be a non-empty string/,
  );
});

test("rejects a non-array visual-state transport", () => {
  assert.throws(
    () => brandGradeSchema.normalizeBrandGradeAuditTransport({
      ...audit,
      visualState: audit.visualState,
    }),
    /visualState transport must be an array/,
  );
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
