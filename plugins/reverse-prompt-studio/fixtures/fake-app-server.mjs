import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    send({
      method: "item/completed",
      params: {
        threadId: message.params.threadId,
        turnId,
        item: { type: "agentMessage", id: "item_fake", text: JSON.stringify(recipe), phase: "final_answer" },
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
