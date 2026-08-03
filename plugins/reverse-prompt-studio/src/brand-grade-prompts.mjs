import {
  brandGradeAuditOutputSchema,
  brandGradeComparisonOutputSchema,
  finishOnlyPlanOutputSchema,
} from "./brand-grade-schema.mjs";

function imageName(imagePath) {
  return imagePath.split(/[\\/]/).at(-1);
}

export function compileFinishOnlyPrompt({ plan, direction = "" }) {
  const treatments = plan.priorities
    .map((priority, index) => `${index + 1}. ${priority.treatment}`)
    .join("\n");
  const toneDirection = String(direction ?? "").trim();
  return [
    "成稿精修任务：输入图是已确认母版，只允许调整画质、真实质感与光影调性。",
    "绝对保持不变：人物身份、面部、身体、姿态、产品、装备、文字、标志；构图、裁切、镜头、场景结构与物体位置也必须与原图一致。",
    `精修重点：\n${treatments}`,
    toneDirection ? `期望调性：${toneDirection}` : "期望调性：延续原图的光线方向、色温与视觉意图，只做克制统一。",
    "处理原则：保留真实皮肤与材料的宏观形体、中层结构和合理微细节；局部对比、锐度、噪点与颗粒随焦点和景深自然衰减，让人物、产品和环境处于同一成像世界。",
    "禁止：改变任何内容或几何关系；避免全局磨皮、全局锐化、HDR、均匀高频纹理、塑料皮肤、重复纹路、锐化白边和虚假材质。",
  ].join("\n\n");
}

export function createFinishOnlyPlanTurnParams({
  threadId,
  sourcePath,
  direction = "",
  skillPath,
}) {
  return {
    threadId,
    input: [{
      type: "text",
      text: [
        "Analyze this image as an approved and semantically complete master.",
        "The only allowed scope is production finish: texture naturalism, existing skin and material detail, illumination coherence, tonal/color grading, noise, sharpness, grain, edges, and dynamic range.",
        "Do not evaluate or propose changes to identity, anatomy, pose, product, equipment, text, logo, camera, crop, composition, scene structure, geometry, or object placement.",
        `Optional user tone direction: ${String(direction ?? "").trim() || "preserve the current intent"}`,
        "Return 1-4 visible, evidence-based priorities. Prefer the shortest sufficient plan; do not use generic quality buzzwords.",
        "Return JSON only using schema finish-only-plan/v1.",
        "Do not create or edit an image.",
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
    }],
    outputSchema: finishOnlyPlanOutputSchema,
  };
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
