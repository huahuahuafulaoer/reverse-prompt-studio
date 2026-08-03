import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGateRail,
  canApproveCandidate,
  repairActionState,
} from "../public/finish-state.js";

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
    { enabled: false, label: "补充真值后继续" },
  );
  assert.deepEqual(
    repairActionState({ requiresTruth: false, humanReview: true }),
    { enabled: false, label: "等待人工确认" },
  );
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
