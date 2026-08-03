import { EventEmitter } from "node:events";
import {
  createAnalyzeTurnParams,
  createProductMatchTurnParams,
  editorRecipeSchema,
} from "./codex-client.mjs";
import {
  createBrandGradeAuditTurnParams,
  createBrandGradeComparisonTurnParams,
} from "./brand-grade-prompts.mjs";
import {
  normalizeBrandGradeAuditTransport,
  validateBrandGradeAudit,
  validateBrandGradeComparison,
} from "./brand-grade-schema.mjs";
import { createRepairContract } from "./repair-contract.mjs";
import {
  buildRevisionPrompt,
  compilePortablePrompt,
  normalizeRecipe,
  restoreLockedRecipeSections,
  validateTransferRecipe,
  validateProductRecipe,
} from "./recipe.mjs";

export class StudioService extends EventEmitter {
  #appServer;
  #store;
  #workspaceRoot;
  #skillPath;
  #brandGradeSkillPath;
  #sessions = new Map();

  constructor({ appServer, store, workspaceRoot, skillPath, brandGradeSkillPath }) {
    super();
    this.#appServer = appServer;
    this.#store = store;
    this.#workspaceRoot = workspaceRoot;
    this.#skillPath = skillPath;
    this.#brandGradeSkillPath = brandGradeSkillPath;
  }

  async analyze(runId, { transferMode = "content_fidelity", replacementSubject = "" } = {}) {
    if (transferMode === "subject_swap" && !String(replacementSubject ?? "").trim()) {
      throw new Error("subject_swap requires a replacementSubject（替换主体）");
    }
    const imagePath = await this.#store.getImagePath(runId);
    const productImagePath = await this.#store.getProductImagePath(runId);
    const thread = await this.#appServer.startThread({ cwd: this.#workspaceRoot });
    this.#attachThread(runId, thread);
    await this.#store.saveThreadId(runId, thread.id);
    const recipe = normalizeRecipe(
      await thread.run(
        createAnalyzeTurnParams({
          threadId: thread.id,
          imagePath,
          productImagePath,
          skillPath: this.#skillPath,
          transferMode,
          replacementSubject,
        }),
      ),
    );
    validateTransferRecipe(recipe, { expectedMode: transferMode, replacementSubject });
    if (productImagePath) validateProductRecipe(recipe);
    await this.#store.saveRecipe(runId, recipe, "analysis");
    return {
      threadId: thread.id,
      recipe,
      compiledPrompt: compilePortablePrompt(recipe),
    };
  }

  async revise(runId, currentRecipe) {
    const normalizedCurrentRecipe = normalizeRecipe(currentRecipe);
    const thread = await this.#getOrResumeThread(runId);
    const generatedRecipe = normalizeRecipe(
      await thread.run({
        input: [
          {
            type: "text",
            text: buildRevisionPrompt(normalizedCurrentRecipe),
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
    const recipe = restoreLockedRecipeSections(generatedRecipe, normalizedCurrentRecipe);
    validateTransferRecipe(recipe, {
      expectedMode: normalizedCurrentRecipe.transferMode,
      replacementSubject: normalizedCurrentRecipe.transferMode === "subject_swap"
        ? normalizedCurrentRecipe.contentAnchors?.subject?.value
        : "",
    });
    await this.#store.saveRecipe(runId, recipe, "revision");
    return {
      threadId: thread.id,
      recipe,
      compiledPrompt: compilePortablePrompt(recipe),
    };
  }

  async matchProduct(runId, currentRecipe) {
    const normalizedCurrentRecipe = normalizeRecipe(currentRecipe);
    const productImagePath = await this.#store.getProductImagePath(runId);
    if (!productImagePath) throw new Error("请先添加产品图");
    const thread = await this.#getOrResumeThread(runId);
    const generatedRecipe = normalizeRecipe(
      await thread.run(
        createProductMatchTurnParams({
          threadId: thread.id,
          productImagePath,
          skillPath: this.#skillPath,
          currentRecipe: normalizedCurrentRecipe,
        }),
      ),
    );
    const recipe = restoreLockedRecipeSections(generatedRecipe, normalizedCurrentRecipe, {
      authorizedSectionIds: ["P"],
    });
    validateTransferRecipe(recipe, {
      expectedMode: normalizedCurrentRecipe.transferMode,
      replacementSubject: normalizedCurrentRecipe.transferMode === "subject_swap"
        ? normalizedCurrentRecipe.contentAnchors?.subject?.value
        : "",
    });
    validateProductRecipe(recipe, { previousRecipe: normalizedCurrentRecipe });
    await this.#store.saveRecipe(runId, recipe, "product-match");
    return {
      threadId: thread.id,
      recipe,
      compiledPrompt: compilePortablePrompt(recipe),
    };
  }

  async auditBrandGrade({ runId, brief }) {
    const run = await this.#store.loadRun(runId);
    if (run.workflow !== "brand_grade") {
      throw new Error("Run is not a brand-grade workflow");
    }
    const thread = await this.#appServer.startThread({ cwd: this.#workspaceRoot });
    this.#attachThread(runId, thread);
    await this.#store.saveThreadId(runId, thread.id);
    const roleInputs = await Promise.all(run.inputs.map(async (input) => ({
      ...input,
      path: await this.#store.getStoredPath(runId, input.filename),
    })));
    const raw = await thread.run(createBrandGradeAuditTurnParams({
      threadId: thread.id,
      sourcePath: await this.#store.getImagePath(runId),
      roleInputs,
      brief,
      skillPath: this.#brandGradeSkillPath,
    }));
    raw.sourceVersionId = run.sourceVersionId;
    const audit = validateBrandGradeAudit(normalizeBrandGradeAuditTransport(raw));
    await this.#store.saveBrandGradeAudit(runId, audit);
    return audit;
  }

  async createBrandGradeRepairContract({ runId, findingId }) {
    const audit = await this.#store.loadLatestAudit(runId);
    const allPaths = Object.entries(audit.visualState).flatMap(([group, values]) =>
      Object.keys(values).map((key) => `${group}.${key}`));
    const contract = createRepairContract({ audit, findingId, allPaths });
    await this.#store.saveRepairContract(runId, contract);
    return contract;
  }

  async compareBrandGradeCandidate({ runId, candidateId }) {
    const run = await this.#store.loadRun(runId);
    if (run.workflow !== "brand_grade") {
      throw new Error("Run is not a brand-grade workflow");
    }
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const audit = await this.#store.loadLatestAudit(runId);
    const contract = await this.#store.loadLatestContract(runId);
    const thread = await this.#getOrResumeThread(runId);
    const raw = await thread.run(createBrandGradeComparisonTurnParams({
      threadId: thread.id,
      sourcePath: await this.#store.getImagePath(runId),
      candidatePath: await this.#store.getStoredPath(runId, candidate.filename),
      audit,
      contract,
      skillPath: this.#brandGradeSkillPath,
    }));
    raw.sourceVersionId = run.sourceVersionId;
    raw.candidateVersionId = candidateId;
    const comparison = validateBrandGradeComparison(raw);
    await this.#store.saveComparison(runId, candidateId, comparison);
    return comparison;
  }

  async approveBrandGradeCandidate({ runId, candidateId }) {
    return this.#store.approveCandidate(runId, candidateId);
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

  async #getOrResumeThread(runId) {
    let thread = this.#sessions.get(runId)?.thread;
    if (thread) return thread;
    const threadId = await this.#store.getThreadId(runId);
    if (!threadId) throw new Error("This run has no Codex thread. Analyze it first.");
    thread = await this.#appServer.resumeThread(threadId);
    this.#attachThread(runId, thread);
    return thread;
  }
}
