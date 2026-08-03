import {
  brandGradeAuditOutputSchema,
  brandGradeComparisonOutputSchema,
  finishOnlyPlanOutputSchema,
} from "./brand-grade-schema.mjs";

function imageName(imagePath) {
  return imagePath.split(/[\\/]/).at(-1);
}

export function compileFinishOnlyPrompt({ plan, direction = "" }) {
  const realismTreatments = plan.realismPriorities
    .map((priority, index) => `${index + 1}. ${priority.treatment}`)
    .join("\n");
  const brandDirection = plan.brandDirection;
  return [
    "成稿精修任务：输入图是已确认母版，只做摄影真实感与品牌调性的后期收口。",
    "绝对保持不变：人物身份、面部、身体、姿态、产品、装备、文字、标志；构图、裁切、镜头、场景结构与物体位置也必须与原图一致。",
    `摄影真实感：\n${realismTreatments}`,
    `品牌调性：${brandDirection.intent}\n${brandDirection.treatment}`,
    "摄影一致性：沿用原图已有光线方向与景深。统一高光过渡、暗部层次、接触阴影和色温；不同材质保留各自的反光、粗糙度与细节尺度；皮肤保留自然色差、毛孔和细小绒毛，但这些细节必须随受光和焦点变化；锐度、噪点与颗粒从焦点向景深自然衰减，让人物、产品和环境属于同一成像世界。",
    "禁止：改变任何内容或几何关系；避免全局磨皮、全局锐化、HDR、统一套色、过度电影化、均匀高频纹理、假毛孔、贴图感、塑料皮肤、重复纹路、锐化白边和虚假材质。",
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
        "The only allowed scope is production finish: lighting coherence, material response, skin realism, depth and optics, and image finish.",
        "Do not evaluate or propose changes to identity, anatomy, pose, product, equipment, text, logo, camera, crop, composition, scene structure, geometry, or object placement.",
        `Brand direction supplied: ${String(direction ?? "").trim() ? "yes" : "no"}`,
        `Optional user brand direction: ${String(direction ?? "").trim() || "preserve the current visual intent without inventing a new style"}`,
        "Return 1-4 visible, evidence-based realism priorities. Treat realism as one photographic system: light behavior, material-specific response, skin variation, focus/depth falloff, and coherent noise/sharpness/grain. Do not add generic micro-detail everywhere.",
        "Translate the optional brand direction only into finish controls: tone curve, color balance, light quality, contrast, saturation, and surface finish. If none was supplied, use mode preserve_existing and do not invent premium, cinematic, luxury, or another style.",
        "Use mode user_direction only when a direction was supplied. Prefer the shortest sufficient plan; do not use generic quality buzzwords or camera-name cargo culting.",
        "Write assessment, observations, treatments, and brand-direction text in concise Simplified Chinese.",
        "Return JSON only using schema finish-only-plan/v2.",
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
