import { EventEmitter } from "node:events";
import {
  createAnalyzeTurnParams,
  editorRecipeSchema,
} from "./codex-client.mjs";
import {
  buildRevisionPrompt,
  compilePortablePrompt,
  normalizeRecipe,
} from "./recipe.mjs";

export class StudioService extends EventEmitter {
  #appServer;
  #store;
  #workspaceRoot;
  #skillPath;
  #sessions = new Map();

  constructor({ appServer, store, workspaceRoot, skillPath }) {
    super();
    this.#appServer = appServer;
    this.#store = store;
    this.#workspaceRoot = workspaceRoot;
    this.#skillPath = skillPath;
  }

  async analyze(runId) {
    const imagePath = await this.#store.getImagePath(runId);
    const thread = await this.#appServer.startThread({ cwd: this.#workspaceRoot });
    this.#attachThread(runId, thread);
    await this.#store.saveThreadId(runId, thread.id);
    const recipe = normalizeRecipe(
      await thread.run(
        createAnalyzeTurnParams({
          threadId: thread.id,
          imagePath,
          skillPath: this.#skillPath,
        }),
      ),
    );
    await this.#store.saveRecipe(runId, recipe, "analysis");
    return {
      threadId: thread.id,
      recipe,
      compiledPrompt: compilePortablePrompt(recipe),
    };
  }

  async revise(runId, currentRecipe) {
    let thread = this.#sessions.get(runId)?.thread;
    if (!thread) {
      const threadId = await this.#store.getThreadId(runId);
      if (!threadId) throw new Error("This run has no Codex thread. Analyze it first.");
      thread = await this.#appServer.resumeThread(threadId);
      this.#attachThread(runId, thread);
    }
    const recipe = normalizeRecipe(
      await thread.run({
        input: [
          {
            type: "text",
            text: buildRevisionPrompt(currentRecipe),
            text_elements: [],
          },
          {
            type: "skill",
            name: "reverse-engineering-image-prompts",
            path: this.#skillPath,
          },
        ],
        outputSchema: editorRecipeSchema,
      }),
    );
    await this.#store.saveRecipe(runId, recipe, "revision");
    return {
      threadId: thread.id,
      recipe,
      compiledPrompt: compilePortablePrompt(recipe),
    };
  }

  close() {
    for (const { thread, eventHandler } of this.#sessions.values()) {
      thread.off("event", eventHandler);
      thread.close();
    }
    this.#sessions.clear();
  }

  #attachThread(runId, thread) {
    const previous = this.#sessions.get(runId);
    if (previous) {
      previous.thread.off("event", previous.eventHandler);
      previous.thread.close();
    }
    const eventHandler = (event) => this.emit("event", { runId, ...event });
    thread.on("event", eventHandler);
    this.#sessions.set(runId, { thread, eventHandler });
  }
}
