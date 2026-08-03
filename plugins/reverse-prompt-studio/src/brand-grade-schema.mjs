export const GATE_IDS = Object.freeze(["G1", "G2", "G3", "G4"]);
export const GATE_STATUS = Object.freeze(["PASS", "HOLD", "FAIL"]);
const VISUAL_STATE_GROUPS = Object.freeze([
  "M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X",
]);
const VISUAL_STATE_PATH_PATTERN = `^(?:${VISUAL_STATE_GROUPS.join("|")})\\.[^\\s.]+$`;
const FINISH_ONLY_AREAS = Object.freeze([
  "texture_realism",
  "skin_people",
  "material_separation",
  "light_tone",
  "technical_finish",
]);
const PROTECTED_CONTENT_TERMS = "人物|身份|面部|脸部|身体|姿态|动作|产品|装备|服装|文字|标志|logo|构图|裁切|镜头|场景|结构|几何|物体位置";
const CONTENT_CHANGE_TERMS = "调整|改变|修改|更换|替换|移动|删除|增加|添加|重做|重绘|重构";
const protectedContentChangePattern = new RegExp(
  `(?:${CONTENT_CHANGE_TERMS})[^，。；\\n]{0,12}(?:${PROTECTED_CONTENT_TERMS})|(?:${PROTECTED_CONTENT_TERMS})[^，。；\\n]{0,12}(?:${CONTENT_CHANGE_TERMS})`,
  "i",
);
const generativeReconstructionPattern = /白膜|clay\s*render|重新渲染|重建|rerender|reconstruct/i;
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
  for (const key of VISUAL_STATE_GROUPS) {
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

export function normalizeBrandGradeAuditTransport(report) {
  if (!Array.isArray(report.visualState)) {
    throw new Error("visualState transport must be an array");
  }
  const visualState = Object.fromEntries(VISUAL_STATE_GROUPS.map((group) => [group, {}]));
  const seenPaths = new Set();
  report.visualState.forEach((entry, index) => {
    object(entry, `visualState[${index}]`);
    const entryPath = string(entry.path, `visualState[${index}].path`);
    const match = /^([^.]+)\.([^\s.]+)$/.exec(entryPath);
    if (!match) throw new Error(`visualState[${index}].path is invalid`);
    const [, group, field] = match;
    if (!VISUAL_STATE_GROUPS.includes(group)) {
      throw new Error(`visualState[${index}].path has an invalid group`);
    }
    const value = string(entry.value, `visualState[${index}].value`);
    if (seenPaths.has(entryPath)) throw new Error(`duplicate visualState path ${entryPath}`);
    seenPaths.add(entryPath);
    visualState[group][field] = value;
  });
  const earliestFailureGate = computeEarliestFailureGate(report.gates);
  const verdict = earliestFailureGate
    ? report.gates.find((gate) => gate.id === earliestFailureGate)?.status
    : "PASS";
  return { ...report, visualState, earliestFailureGate, verdict };
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

export function validateFinishOnlyPlan(plan) {
  object(plan, "plan");
  if (plan.schema !== "finish-only-plan/v1") {
    throw new Error("schema must be finish-only-plan/v1");
  }
  string(plan.assessment, "assessment");
  if (!Array.isArray(plan.priorities) || plan.priorities.length < 1 || plan.priorities.length > 4) {
    throw new Error("priorities must contain 1-4 items");
  }
  const seenAreas = new Set();
  plan.priorities.forEach((priority, index) => {
    object(priority, `priorities[${index}]`);
    if (!FINISH_ONLY_AREAS.includes(priority.area)) {
      throw new Error(`priorities[${index}].area is invalid`);
    }
    if (seenAreas.has(priority.area)) {
      throw new Error(`priorities[${index}].area is duplicated`);
    }
    seenAreas.add(priority.area);
    string(priority.observation, `priorities[${index}].observation`);
    string(priority.treatment, `priorities[${index}].treatment`);
    if (protectedContentChangePattern.test(priority.treatment)) {
      throw new Error(`priorities[${index}].treatment changes protected content`);
    }
    if (generativeReconstructionPattern.test(priority.treatment)) {
      throw new Error(`priorities[${index}].treatment requests generative reconstruction`);
    }
  });
  return plan;
}

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
    "allowedUse",
  ],
  properties: {
    schema: { type: "string", const: "brand-grade-audit/v1" },
    sourceVersionId: sharedReportProperties.sourceVersionId,
    gates: sharedReportProperties.gates,
    allowedUse: sharedReportProperties.allowedUse,
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
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "value"],
        properties: {
          path: { type: "string", pattern: VISUAL_STATE_PATH_PATTERN },
          value: { type: "string" },
        },
      },
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

export const finishOnlyPlanOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "assessment", "priorities"],
  properties: {
    schema: { type: "string", const: "finish-only-plan/v1" },
    assessment: { type: "string" },
    priorities: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "observation", "treatment"],
        properties: {
          area: { type: "string", enum: FINISH_ONLY_AREAS },
          observation: { type: "string" },
          treatment: { type: "string" },
        },
      },
    },
  },
};
