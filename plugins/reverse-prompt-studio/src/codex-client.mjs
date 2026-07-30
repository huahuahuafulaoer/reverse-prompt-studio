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
        version: "0.1.0",
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

export function createAnalyzeTurnParams({ threadId, imagePath, skillPath }) {
  return {
    threadId,
    input: [
      {
        type: "text",
        text: [
          "$reverse-engineering-image-prompts 分析这张参考图。",
          "直接检查图片，只根据可见证据推导可迁移视觉配方。",
          "把结果写入唯一的 reverse-image-prompt/editor-v1 结构化状态。",
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
