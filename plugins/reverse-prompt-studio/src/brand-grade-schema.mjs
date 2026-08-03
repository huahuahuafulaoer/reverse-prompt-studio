export const GATE_IDS = Object.freeze(["G1", "G2", "G3", "G4"]);
export const GATE_STATUS = Object.freeze(["PASS", "HOLD", "FAIL"]);
export const INPUT_ROLES = Object.freeze([
  "edit_target",
  "product_truth",
  "subject_reference",
  "style_reference",
  "composition_reference",
  "material_reference",
  "hard_structure_reference",
]);

const allowedUseValues = new Set([
  "diagnosis_only",
  "repair_candidate",
  "approved_source",
]);
const routeValues = new Set([
  "truth_update",
  "controlled_regeneration",
  "local_edit",
  "manual_retouch",
  "post_layout",
  "human_review",
]);
const stringArraySchema = { type: "array", items: { type: "string" } };

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function strings(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be a string array`);
  }
  return value;
}

export function computeEarliestFailureGate(gates) {
  for (const status of ["FAIL", "HOLD"]) {
    const gate = GATE_IDS
      .map((id) => gates.find((entry) => entry.id === id))
      .find((entry) => entry?.status === status);
    if (gate) return gate.id;
  }
  return null;
}

function validateFinding(finding, path) {
  object(finding, path);
  string(finding.id, `${path}.id`);
  if (!["blocker", "major", "minor"].includes(finding.severity)) {
    throw new Error(`${path}.severity is invalid`);
  }
  string(finding.title, `${path}.title`);
  string(finding.observedEvidence, `${path}.observedEvidence`);
  strings(finding.affectedPaths, `${path}.affectedPaths`);
  string(finding.targetResult, `${path}.targetResult`);
  if (!routeValues.has(finding.recommendedRoute)) {
    throw new Error(`${path}.recommendedRoute is invalid`);
  }
  if (typeof finding.requiresTruth !== "boolean") {
    throw new Error(`${path}.requiresTruth must be boolean`);
  }
  if (typeof finding.humanReview !== "boolean") {
    throw new Error(`${path}.humanReview must be boolean`);
  }
  strings(finding.acceptanceChecks, `${path}.acceptanceChecks`);
  return finding;
}

function validateGates(gates) {
  if (!Array.isArray(gates) || gates.length !== 4) {
    throw new Error("gates must contain G1-G4");
  }
  gates.forEach((gate, index) => {
    object(gate, `gates[${index}]`);
    if (gate.id !== GATE_IDS[index]) {
      throw new Error(`gates[${index}].id must be ${GATE_IDS[index]}`);
    }
    string(gate.name, `gates[${index}].name`);
    if (!GATE_STATUS.includes(gate.status)) {
      throw new Error(`gates[${index}].status is invalid`);
    }
    string(gate.summary, `gates[${index}].summary`);
    if (!Array.isArray(gate.findings)) {
      throw new Error(`gates[${index}].findings must be an array`);
    }
    gate.findings.forEach((finding, findingIndex) =>
      validateFinding(finding, `gates[${index}].findings[${findingIndex}]`));
    if (gate.status === "PASS" && gate.findings.length > 0) {
      throw new Error(`gates[${index}] PASS cannot contain findings`);
    }
  });
  return gates;
}

function validateSharedReport(report, schema) {
  object(report, "report");
  if (report.schema !== schema) throw new Error(`schema must be ${schema}`);
  string(report.sourceVersionId, "sourceVersionId");
  validateGates(report.gates);
  const computed = computeEarliestFailureGate(report.gates);
  if (report.earliestFailureGate !== computed) {
    throw new Error(`earliestFailureGate must be ${computed}`);
  }
  const expectedVerdict = computed
    ? report.gates.find((gate) => gate.id === computed).status
    : "PASS";
  if (report.verdict !== expectedVerdict) {
    throw new Error(`verdict must be ${expectedVerdict}`);
  }
  if (!allowedUseValues.has(report.allowedUse)) {
    throw new Error("allowedUse is invalid");
  }
  return report;
}

export function validateBrandGradeAudit(report) {
  validateSharedReport(report, "brand-grade-audit/v1");
  object(report.truthLedger, "truthLedger");
  for (const key of ["verified", "userProvided", "inferred", "unknown", "humanReview"]) {
    strings(report.truthLedger[key], `truthLedger.${key}`);
  }
  object(report.visualState, "visualState");
  for (const key of ["M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X"]) {
    object(report.visualState[key], `visualState.${key}`);
  }
  if (!Array.isArray(report.inputs) || report.inputs.length === 0) {
    throw new Error("inputs must not be empty");
  }
  report.inputs.forEach((input, index) => {
    string(input.id, `inputs[${index}].id`);
    if (!INPUT_ROLES.includes(input.role)) {
      throw new Error(`inputs[${index}].role is invalid`);
    }
    string(input.filename, `inputs[${index}].filename`);
  });
  return report;
}

export function validateBrandGradeComparison(report) {
  validateSharedReport(report, "brand-grade-comparison/v1");
  string(report.candidateVersionId, "candidateVersionId");
  if (!Array.isArray(report.lockDrift)) throw new Error("lockDrift must be an array");
  report.lockDrift.forEach((drift, index) => {
    string(drift.path, `lockDrift[${index}].path`);
    string(drift.expected, `lockDrift[${index}].expected`);
    string(drift.observed, `lockDrift[${index}].observed`);
    if (!["PASS", "FAIL"].includes(drift.status)) {
      throw new Error(`lockDrift[${index}].status is invalid`);
    }
  });
  if (report.lockDrift.some((item) => item.status === "FAIL") && report.verdict === "PASS") {
    throw new Error("comparison with lock drift cannot PASS");
  }
  return report;
}

const textOrStringsSchema = {
  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
};
const visualGroupSchema = { type: "object", additionalProperties: textOrStringsSchema };
const findingOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "severity",
    "title",
    "observedEvidence",
    "affectedPaths",
    "targetResult",
    "recommendedRoute",
    "requiresTruth",
    "humanReview",
    "acceptanceChecks",
  ],
  properties: {
    id: { type: "string" },
    severity: { type: "string", enum: ["blocker", "major", "minor"] },
    title: { type: "string" },
    observedEvidence: { type: "string" },
    affectedPaths: stringArraySchema,
    targetResult: { type: "string" },
    recommendedRoute: { type: "string", enum: [...routeValues] },
    requiresTruth: { type: "boolean" },
    humanReview: { type: "boolean" },
    acceptanceChecks: stringArraySchema,
  },
};
const gateOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "status", "summary", "findings"],
  properties: {
    id: { type: "string", enum: GATE_IDS },
    name: { type: "string" },
    status: { type: "string", enum: GATE_STATUS },
    summary: { type: "string" },
    findings: { type: "array", items: findingOutputSchema },
  },
};
const sharedReportProperties = {
  sourceVersionId: { type: "string" },
  gates: { type: "array", minItems: 4, maxItems: 4, items: gateOutputSchema },
  earliestFailureGate: {
    anyOf: [{ type: "string", enum: GATE_IDS }, { type: "null" }],
  },
  verdict: { type: "string", enum: GATE_STATUS },
  allowedUse: {
    type: "string",
    enum: ["diagnosis_only", "repair_candidate", "approved_source"],
  },
};

export const brandGradeAuditOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "sourceVersionId",
    "truthLedger",
    "visualState",
    "inputs",
    "gates",
    "earliestFailureGate",
    "verdict",
    "allowedUse",
  ],
  properties: {
    schema: { type: "string", const: "brand-grade-audit/v1" },
    ...sharedReportProperties,
    truthLedger: {
      type: "object",
      additionalProperties: false,
      required: ["verified", "userProvided", "inferred", "unknown", "humanReview"],
      properties: Object.fromEntries(
        ["verified", "userProvided", "inferred", "unknown", "humanReview"]
          .map((key) => [key, stringArraySchema]),
      ),
    },
    visualState: {
      type: "object",
      additionalProperties: false,
      required: ["M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X"],
      properties: Object.fromEntries(
        ["M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X"]
          .map((key) => [key, visualGroupSchema]),
      ),
    },
    inputs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "filename"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: INPUT_ROLES },
          filename: { type: "string" },
        },
      },
    },
  },
};

export const brandGradeComparisonOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "sourceVersionId",
    "candidateVersionId",
    "gates",
    "lockDrift",
    "earliestFailureGate",
    "verdict",
    "allowedUse",
  ],
  properties: {
    schema: { type: "string", const: "brand-grade-comparison/v1" },
    ...sharedReportProperties,
    candidateVersionId: { type: "string" },
    lockDrift: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "expected", "observed", "status"],
        properties: {
          path: { type: "string" },
          expected: { type: "string" },
          observed: { type: "string" },
          status: { type: "string", enum: ["PASS", "FAIL"] },
        },
      },
    },
  },
};
