import {
  brandGradeAuditOutputSchema,
  brandGradeComparisonOutputSchema,
} from "./brand-grade-schema.mjs";

function imageName(imagePath) {
  return imagePath.split(/[\\/]/).at(-1);
}

export function createBrandGradeAuditTurnParams({
  threadId,
  sourcePath,
  roleInputs,
  brief,
  skillPath,
}) {
  const manifest = [
    { path: sourcePath, role: "edit_target" },
    ...roleInputs,
  ];
  const labels = manifest
    .map((item) => `${imageName(item.path)} = ${item.role}`)
    .join("\n");
  return {
    threadId,
    input: [{
      type: "text",
      text: [
        "Analyze the delivery candidate using $brand-grade-finishing.",
        "Image roles:",
        labels,
        `Campaign brief: ${JSON.stringify(brief)}`,
        "Return JSON only using schema brand-grade-audit/v1.",
        "Return visualState as a flat array of {path, value} entries using paths like M.subject.",
        "Do not return earliestFailureGate or verdict; the Studio derives them from gates.",
        "Do not create or edit an image.",
      ].join("\n"),
      text_elements: [],
    }, {
      type: "skill",
      name: "brand-grade-finishing",
      path: skillPath,
    }, ...manifest.map((item) => ({
      type: "localImage",
      path: item.path,
      detail: "original",
    }))],
    outputSchema: brandGradeAuditOutputSchema,
  };
}

export function createBrandGradeComparisonTurnParams({
  threadId,
  sourcePath,
  candidatePath,
  audit,
  contract,
  skillPath,
}) {
  return {
    threadId,
    input: [{
      type: "text",
      text: [
        "Compare the repaired candidate against the source using $brand-grade-finishing.",
        "source image = original edit_target",
        "candidate image = repaired candidate",
        `Original audit: ${JSON.stringify(audit)}`,
        `Repair contract: ${JSON.stringify(contract)}`,
        "Return JSON only using schema brand-grade-comparison/v1.",
        "Any drift in lockedPaths prevents PASS.",
      ].join("\n"),
      text_elements: [],
    }, {
      type: "skill",
      name: "brand-grade-finishing",
      path: skillPath,
    }, {
      type: "localImage",
      path: sourcePath,
      detail: "original",
    }, {
      type: "localImage",
      path: candidatePath,
      detail: "original",
    }],
    outputSchema: brandGradeComparisonOutputSchema,
  };
}
