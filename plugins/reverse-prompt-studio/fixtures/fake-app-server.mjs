import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function finding({ id, title, path }) {
  return {
    id,
    severity: "major",
    title,
    observedEvidence: `${title}的可见证据`,
    affectedPaths: [path],
    targetResult: `修复${title}`,
    recommendedRoute: "local_edit",
    requiresTruth: false,
    humanReview: false,
    acceptanceChecks: [`${title}已修复`, "锁定内容不变"],
  };
}

function auditFixture() {
  return {
    schema: "brand-grade-audit/v1",
    sourceVersionId: "source-v1",
    truthLedger: {
      verified: [],
      userProvided: [],
      inferred: ["测试夹具中的可见状态"],
      unknown: [],
      humanReview: [],
    },
    visualState: [
      { path: "M.subject", value: "测试产品" },
      { path: "S.setting", value: "测试场景" },
      { path: "A.artDirection", value: "克制" },
      { path: "P.composition", value: "居中" },
      { path: "C.camera", value: "正面" },
      { path: "K.lighting", value: "柔光" },
      { path: "L.palette", value: "中性" },
      { path: "G.texture", value: "材质高光不连续" },
      { path: "E.effects", value: "无" },
      { path: "R.references", value: "product_truth" },
      { path: "T.typography", value: "无" },
      { path: "Q.edgeQuality", value: "轮廓有锯齿" },
      { path: "X.exclusions", value: "不改变产品身份" },
    ],
    inputs: [{ id: "source-v1", role: "edit_target", filename: "source.png" }],
    gates: [
      {
        id: "G1",
        name: "Truth & Physics",
        status: "FAIL",
        summary: "材质光学关系需要修复",
        findings: [finding({ id: "G1-F01", title: "材质高光", path: "G.texture" })],
      },
      {
        id: "G2",
        name: "Art Direction",
        status: "PASS",
        summary: "艺术方向可用",
        findings: [],
      },
      {
        id: "G3",
        name: "Brand & Campaign",
        status: "PASS",
        summary: "品牌目标可用",
        findings: [],
      },
      {
        id: "G4",
        name: "Production Finish",
        status: "FAIL",
        summary: "边缘需要清理",
        findings: [finding({ id: "G4-F01", title: "边缘锯齿", path: "Q.edgeQuality" })],
      },
    ],
    allowedUse: "diagnosis_only",
  };
}

function comparisonFixture() {
  return {
    schema: "brand-grade-comparison/v1",
    sourceVersionId: "source-v1",
    candidateVersionId: "candidate-v1",
    gates: [
      ["G1", "Truth & Physics"],
      ["G2", "Art Direction"],
      ["G3", "Brand & Campaign"],
      ["G4", "Production Finish"],
    ].map(([id, name]) => ({
      id,
      name,
      status: "PASS",
      summary: "通过",
      findings: [],
    })),
    lockDrift: [],
    earliestFailureGate: null,
    verdict: "PASS",
    allowedUse: "approved_source",
  };
}

function finishOnlyPlanFixture(promptText) {
  const hasDirection = /Brand direction supplied: yes/.test(promptText);
  return {
    schema: "finish-only-plan/v2",
    assessment: "画面内容已经完整，当前只需统一真实质感与光影完成度。",
    realismPriorities: [
      {
        area: "material_response",
        observation: "局部表面存在重复、均匀的高频纹理。",
        treatment: "保留原有大形和中层结构，仅清理重复纹理并让微细节随景深自然衰减。",
      },
      {
        area: "lighting_coherence",
        observation: "主体与环境的局部对比和锐度略显割裂。",
        treatment: "延续原有光线方向，统一局部对比、暗部层次和色温，不做全局 HDR。",
      },
    ],
    brandDirection: hasDirection ? {
      mode: "user_direction",
      intent: "自然通透、保留户外纪实感",
      treatment: "控制饱和度与黑位，保持自然通透、专业克制的户外纪实质感。",
    } : {
      mode: "preserve_existing",
      intent: "延续原图调性",
      treatment: "保留原图已有的色温、对比与饱和度关系，不额外套用新的风格。",
    },
  };
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start" || message.method === "thread/resume") {
    send({ id: message.id, result: { thread: { id: message.params.threadId ?? "thr_fake" } } });
    return;
  }
  if (message.method === "turn/start") {
    const turnId = "turn_fake";
    const promptText = message.params.input.find((item) => item.type === "text")?.text ?? "";
    const revised = promptText.includes("更新这份视觉配方");
    const revisionContract = revised
      ? JSON.parse(promptText.trim().split("\n").at(-1))
      : null;
    const productMatched = promptText.includes("匹配到当前视觉配方");
    const productAware =
      !productMatched && message.params.input.some(
        (item) => item.type === "text" && item.text.includes("product_truth"),
      );
    const styleComposition = promptText.includes("transferMode 是 style_composition")
      || promptText.includes('"transferMode":"style_composition"');
    const subjectSwap = promptText.includes("transferMode 是 subject_swap")
      || promptText.includes('"transferMode":"subject_swap"');
    const replacementSubject = promptText.match(/替换主体“([^”]+)”/)?.[1]
      ?? promptText.match(/"subject":\{"value":"([^"]+)"/)?.[1]
      ?? "替换主体";
    const transferMode = styleComposition
      ? "style_composition"
      : subjectSwap
        ? "subject_swap"
        : "content_fidelity";
    const contentSourceRole = subjectSwap ? "user_or_project_truth" : "content_reference";
    const preservesContent = !styleComposition;
    const recipe = {
      schema: "reverse-image-prompt/editor-v1",
      title: productMatched
        ? "Fake product-matched result"
        : productAware
          ? "Fake product-aware result"
          : revised
            ? "Fake revised result"
            : "Fake result",
      transferMode,
      contentAnchors: {
        subject: {
          value: styleComposition ? "" : subjectSwap ? replacementSubject : "测试主体",
          preserve: preservesContent,
          sourceRole: styleComposition ? "not_applicable" : contentSourceRole,
        },
        action: {
          value: styleComposition ? "" : "测试动作",
          preserve: preservesContent,
          sourceRole: styleComposition ? "not_applicable" : "content_reference",
        },
        interaction: {
          value: styleComposition ? "" : "测试交互",
          preserve: preservesContent,
          sourceRole: styleComposition ? "not_applicable" : "content_reference",
        },
        scene: {
          value: styleComposition ? "" : "测试场景",
          preserve: preservesContent,
          sourceRole: styleComposition ? "not_applicable" : "content_reference",
        },
      },
      sections: [
        {
          id: "S",
          label: "主体",
          fields: [
            {
              id: "S01",
              label: "主体",
              value: subjectSwap ? replacementSubject : "测试主体",
              confidence: "high",
              control: "text",
              locked: false,
            },
          ],
        },
        {
          id: "A",
          label: "动作",
          fields: [
            {
              id: "A01",
              label: "动作",
              value: "测试动作",
              confidence: "high",
              control: "text",
              locked: false,
            },
          ],
        },
        {
          id: "C",
          label: "构图",
          fields: [
            {
              id: "C03",
              label: "主体占比",
              value: revised ? "68%" : "55%",
              confidence: "medium",
              control: "text",
              locked: false,
            },
          ],
        },
        {
          id: "L",
          label: "光影",
          fields: [
            {
              id: "L01",
              label: "主光方向",
              value: "柔和日光",
              confidence: "high",
              control: "text",
              locked: false,
            },
          ],
        },
      ],
      referenceTransfer: { preserve: [], translate: [], omit: [] },
      truthGaps: [],
      negativeConstraints: [],
    };
    if (revisionContract?.current_recipe) {
      recipe.transferMode = revisionContract.current_recipe.transferMode;
      recipe.contentAnchors = structuredClone(revisionContract.current_recipe.contentAnchors);
      recipe.sections = structuredClone(revisionContract.current_recipe.sections);
      recipe.referenceTransfer = structuredClone(revisionContract.current_recipe.referenceTransfer);
      recipe.truthGaps = structuredClone(revisionContract.current_recipe.truthGaps);
      recipe.negativeConstraints = structuredClone(
        revisionContract.current_recipe.negativeConstraints,
      );
      for (const change of revisionContract.changed_fields ?? []) {
        const field = recipe.sections
          .flatMap((section) => section.fields ?? [])
          .find((candidate) => candidate.id === change.id);
        if (field) field.value = change.value;
      }
      for (const { sectionId, instruction } of revisionContract.section_instructions ?? []) {
        const section = recipe.sections.find((candidate) => candidate.id === sectionId);
        const field = section?.fields?.[0];
        if (!field) continue;
        const percentage = instruction.match(/\d+(?:\.\d+)?%/)?.[0];
        field.value = percentage ?? instruction;
      }
    }
    if (productMatched) {
      recipe.sections.push({
        id: "P",
        label: "产品",
        fields: [
          {
            id: "P01",
            label: "产品",
            value: "matched product",
            confidence: "high",
            control: "text",
            locked: false,
          },
        ],
      });
      const lightSection = recipe.sections.find((section) => section.id === "L");
      lightSection.label = "被模型改写的光影";
      lightSection.fields[0].value = "模型擅自改成右下光";
      lightSection.fields[0].confidence = "low";
    } else if (productAware) {
      recipe.sections.push({
        id: "P",
        label: "产品",
        fields: [
          {
            id: "P01",
            label: "产品",
            value: "initial product",
            confidence: "high",
            control: "text",
            locked: false,
          },
        ],
      });
    }
    const payload = promptText.includes("finish-only-plan/v2")
      ? finishOnlyPlanFixture(promptText)
      : promptText.includes("brand-grade-comparison/v1")
      ? comparisonFixture()
      : promptText.includes("brand-grade-audit/v1")
        ? auditFixture()
        : recipe;
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    send({
      method: "item/completed",
      params: {
        threadId: message.params.threadId,
        turnId,
        item: { type: "agentMessage", id: "item_fake", text: JSON.stringify(payload), phase: "final_answer" },
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: message.params.threadId,
        turn: { id: turnId, status: "completed" },
      },
    });
  }
});
