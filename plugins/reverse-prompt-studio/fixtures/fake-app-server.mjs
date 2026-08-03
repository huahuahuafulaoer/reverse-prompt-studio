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
    const productMatched = promptText.includes("匹配到当前视觉配方");
    const productAware =
      !productMatched && message.params.input.some(
        (item) => item.type === "text" && item.text.includes("product_truth"),
      );
    const recipe = {
      schema: "reverse-image-prompt/editor-v1",
      title: productMatched
        ? "Fake product-matched result"
        : productAware
          ? "Fake product-aware result"
          : revised
            ? "Fake revised result"
            : "Fake result",
      sections: [
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
      ],
      referenceTransfer: { preserve: [], translate: [], omit: [] },
      truthGaps: [],
      negativeConstraints: [],
    };
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
      recipe.sections.push({
        id: "L",
        label: "被模型改写的光影",
        fields: [
          {
            id: "L01",
            label: "主光方向",
            value: "模型擅自改成右下光",
            confidence: "low",
            control: "text",
            locked: false,
          },
        ],
      });
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
    const payload = promptText.includes("brand-grade-comparison/v1")
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
