import test from "node:test";
import assert from "node:assert/strict";

import { createRepairContract } from "../src/repair-contract.mjs";

const audit = {
  schema: "brand-grade-audit/v1",
  sourceVersionId: "source-v1",
  earliestFailureGate: "G1",
  gates: [{
    id: "G1",
    status: "FAIL",
    findings: [{
      id: "G1-F01",
      affectedPaths: ["G.texture"],
      targetResult: "恢复真实瓶身高光",
      recommendedRoute: "local_edit",
      requiresTruth: true,
      humanReview: false,
      acceptanceChecks: ["瓶型不变", "高光连续"],
    }],
  }],
};

test("creates a contract for one finding and locks every unedited path", () => {
  const contract = createRepairContract({
    audit,
    findingId: "G1-F01",
    allPaths: ["M.subject", "P.composition", "K.lighting", "G.texture"],
  });
  assert.deepEqual(contract.changePaths, ["G.texture"]);
  assert.deepEqual(contract.lockedPaths, ["K.lighting", "M.subject", "P.composition"]);
  assert.match(contract.platformPrompt, /只修改：G\.texture/);
  assert.match(contract.platformPrompt, /保持不变：K\.lighting、M\.subject、P\.composition/);
});

test("refuses to repair a finding outside the earliest failed gate", () => {
  const later = structuredClone(audit);
  later.gates.push({
    id: "G4",
    status: "FAIL",
    findings: [{ ...audit.gates[0].findings[0], id: "G4-F01" }],
  });
  assert.throws(
    () => createRepairContract({ audit: later, findingId: "G4-F01", allPaths: ["G.texture"] }),
    /earliest failed gate/,
  );
});

test("returns HOLD when truth evidence or human review is required", () => {
  const contract = createRepairContract({
    audit,
    findingId: "G1-F01",
    allPaths: ["G.texture"],
  });
  assert.equal(contract.status, "HOLD");
});
