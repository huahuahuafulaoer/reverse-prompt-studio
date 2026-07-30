import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

export class CodexAppServer extends EventEmitter {
  #process;
  #connection;

  constructor({ process, connection }) {
    super();
    this.#process = process;
    this.#connection = connection;
    process.stderr?.on("data", (chunk) => this.emit("stderr", chunk.toString()));
    process.on("exit", (code, signal) => this.emit("exit", { code, signal }));
  }

  static async launch({
    command = "codex",
    args = ["app-server", "--listen", "stdio://"],
    cwd,
  } = {}) {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });
    const server = new CodexAppServer({ process: child, connection });
    await connection.request("initialize", {
      clientInfo: {
        name: "reverse_prompt_studio",
        title: "Reverse Prompt Studio",
        version: "0.3.0",
      },
    });
    connection.notify("initialized", {});
    return server;
  }

  async startThread({ cwd }) {
    const result = await this.#connection.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "reverse_prompt_studio",
    });
    return new CodexThread({ connection: this.#connection, threadId: result.thread.id });
  }

  async resumeThread(threadId) {
    const result = await this.#connection.request("thread/resume", { threadId });
    return new CodexThread({ connection: this.#connection, threadId: result.thread.id });
  }

  close() {
    this.#connection.close();
    if (!this.#process.killed) this.#process.kill("SIGTERM");
  }
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
};

export const editorRecipeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "title",
    "sections",
    "referenceTransfer",
    "truthGaps",
    "negativeConstraints",
  ],
  properties: {
    schema: { type: "string", const: "reverse-image-prompt/editor-v1" },
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "fields"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "value", "confidence", "control", "locked"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                value: { type: "string" },
                confidence: {
                  type: "string",
                  enum: ["high", "medium", "low", "unknown"],
                },
                control: {
                  type: "string",
                  enum: ["text", "textarea", "range", "select"],
                },
                locked: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    referenceTransfer: {
      type: "object",
      additionalProperties: false,
      required: ["preserve", "translate", "omit"],
      properties: {
        preserve: stringArraySchema,
        translate: stringArraySchema,
        omit: stringArraySchema,
      },
    },
    truthGaps: stringArraySchema,
    negativeConstraints: stringArraySchema,
  },
};

export function createAnalyzeTurnParams({
  threadId,
  imagePath,
  productImagePath,
  skillPath,
}) {
  const input = [
    {
      type: "text",
      text: [
        "$reverse-engineering-image-prompts 分析这张参考图。",
        "下面第一张图片的唯一主角色是 inspiration_only；允许提取的线索维度仅限构图、光影、色彩、环境和可迁移风格关系。",
        "直接检查图片，只根据可见证据推导可迁移视觉配方。",
        productImagePath
          ? "另有一张明确标注的产品图；它只负责产品真值，不得接管参考图的构图、场景或风格。"
          : "产品结构或身份没有可靠真值时，必须写入 truthGaps，不要凭外观补全。",
        "把结果写入唯一的 reverse-image-prompt/editor-v1 结构化状态。",
        "初次分析的所有字段都设为 locked=false；锁定只由用户之后在界面中操作。",
        "字段 ID 在后续修改中必须保持稳定。不要输出额外 prose prompt。",
      ].join("\n"),
      text_elements: [],
    },
    {
      type: "skill",
      name: "reverse-engineering-image-prompts",
      path: skillPath,
    },
    { type: "localImage", path: imagePath, detail: "original" },
  ];

  if (productImagePath) {
    input.push(
      {
        type: "text",
        text: [
          "下面第二张是产品图，唯一主角色为 product_truth。",
          "它只可控制可见的产品轮廓、比例、朝向、色块、表面反应、部件和细节。",
          "不得从外观推断品牌、精确材质规格、工程功能或性能宣称；无法确认的内容写入 truthGaps。",
          "把产品真值转译到参考图的视觉关系中，并保持参考图的构图、场景和风格职责不变。",
        ].join("\n"),
        text_elements: [],
      },
      { type: "localImage", path: productImagePath, detail: "original" },
    );
  }

  return {
    threadId,
    input,
    outputSchema: editorRecipeSchema,
  };
}

export function createProductMatchTurnParams({
  threadId,
  productImagePath,
  skillPath,
  currentRecipe,
}) {
  const currentRecipeForMatch = structuredClone(currentRecipe);
  const productSection = currentRecipeForMatch.sections.find((section) => section.id === "P");
  for (const field of productSection?.fields ?? []) field.locked = false;
  const lockedFieldIds = currentRecipeForMatch.sections
    .filter((section) => section.id !== "P")
    .flatMap((section) => section.fields)
    .filter((field) => field.locked)
    .map((field) => field.id);

  return {
    threadId,
    input: [
      {
        type: "text",
        text: [
          "使用 $reverse-engineering-image-prompts 将下面的产品图匹配到当前视觉配方。",
          "这张图片的唯一主角色是 product_truth；它不拥有构图、环境、叙事、色调或风格。",
          "优先更新产品相关的 P 字段：可见轮廓、比例、朝向、色块、表面反应、部件与细节。",
          "点击匹配产品已经构成对产品板块的明确授权，因此产品板块的锁不进入 locked_field_ids；其他板块的锁仍须严格保留。",
          "只有为物理合理性所必需时，才最小幅联动 S/A/C/L/R 中的比例、抓握、接触、遮挡、阴影和材质受光。",
          "其余字段默认保持不变；严格保留 locked_field_ids。若锁定字段与必要联动冲突，不得静默覆盖，把冲突写入 truthGaps。",
          "所有未受影响的字段 ID 必须保持稳定；不要重编号。",
          "不得推断品牌、工程功能、性能宣称或精确材质规格；不可见或无法确认的内容写入 truthGaps。",
          "返回完整且唯一的 reverse-image-prompt/editor-v1 结构化状态，不要附加 prose prompt。",
          JSON.stringify({
            source_role: "product_truth",
            locked_field_ids: lockedFieldIds,
            current_recipe: currentRecipeForMatch,
          }),
        ].join("\n\n"),
        text_elements: [],
      },
      {
        type: "skill",
        name: "reverse-engineering-image-prompts",
        path: skillPath,
      },
      { type: "localImage", path: productImagePath, detail: "original" },
    ],
    outputSchema: editorRecipeSchema,
  };
}

export class CodexThread extends EventEmitter {
  #connection;
  #threadId;
  #outputs = new Map();
  #completions = new Map();
  #waiters = new Map();
  #notificationHandler;

  constructor({ connection, threadId }) {
    super();
    this.#connection = connection;
    this.#threadId = threadId;
    this.#notificationHandler = (message) => this.#handleNotification(message);
    connection.on("notification", this.#notificationHandler);
  }

  get id() {
    return this.#threadId;
  }

  async run(params) {
    const result = await this.#connection.request("turn/start", {
      ...params,
      threadId: this.#threadId,
    });
    const turnId = result.turn.id;
    return new Promise((resolve, reject) => {
      this.#waiters.set(turnId, { resolve, reject });
      this.#settleIfComplete(turnId);
    });
  }

  close() {
    this.#connection.off("notification", this.#notificationHandler);
    for (const { reject } of this.#waiters.values()) {
      reject(new Error("Codex thread closed"));
    }
    this.#waiters.clear();
  }

  #handleNotification(message) {
    const { method, params = {} } = message;
    if (params.threadId && params.threadId !== this.#threadId) return;
    this.emit("event", message);

    if (method === "item/completed" && params.item?.type === "agentMessage") {
      const current = this.#outputs.get(params.turnId) ?? [];
      current.push(params.item);
      this.#outputs.set(params.turnId, current);
    }

    if (method === "turn/completed") {
      this.#completions.set(params.turn.id, params.turn);
      this.#settleIfComplete(params.turn.id);
    }
  }

  #settleIfComplete(turnId) {
    const waiter = this.#waiters.get(turnId);
    const completion = this.#completions.get(turnId);
    if (!waiter || !completion) return;

    this.#waiters.delete(turnId);
    this.#completions.delete(turnId);
    if (completion.status !== "completed") {
      waiter.reject(new Error(completion.error?.message ?? `Turn ${completion.status}`));
      return;
    }

    const messages = this.#outputs.get(turnId) ?? [];
    this.#outputs.delete(turnId);
    const finalMessage =
      messages.findLast((item) => item.phase === "final_answer") ?? messages.at(-1);
    if (!finalMessage) {
      waiter.reject(new Error("Codex completed without a structured agent message"));
      return;
    }
    try {
      waiter.resolve(parseStructuredMessage(finalMessage.text));
    } catch (error) {
      waiter.reject(error);
    }
  }
}

export function parseStructuredMessage(text) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(unfenced);
}

export class JsonRpcConnection extends EventEmitter {
  #input;
  #output;
  #nextId = 1;
  #pending = new Map();
  #reader;

  constructor({ input, output }) {
    super();
    this.#input = input;
    this.#output = output;
    this.#reader = readline.createInterface({ input });
    this.#reader.on("line", (line) => this.#onLine(line));
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#output.write(`${JSON.stringify({ method, id, params })}\n`);
    return promise;
  }

  notify(method, params = {}) {
    this.#output.write(`${JSON.stringify({ method, params })}\n`);
  }

  close() {
    this.#reader.close();
    this.#input.destroy();
    this.#output.destroy();
    for (const { reject } of this.#pending.values()) {
      reject(new Error("JSON-RPC connection closed"));
    }
    this.#pending.clear();
  }

  #onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", error);
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "JSON-RPC error"));
      else pending.resolve(message.result);
      return;
    }

    if (message.method) this.emit("notification", message);
  }
}
