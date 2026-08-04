import { EventEmitter } from "node:events";
import {
  createAnalyzeTurnParams,
  createProductMatchTurnParams,
  editorRecipeSchema,
} from "./codex-client.mjs";
import {
  compileFinishOnlyPrompt,
  createBrandGradeAuditTurnParams,
  createBrandGradeComparisonTurnParams,
  createFinishOnlyPlanTurnParams,
} from "./brand-grade-prompts.mjs";
import {
  normalizeBrandGradeAuditTransport,
  validateBrandGradeAudit,
  validateBrandGradeComparison,
  validateFinishOnlyPlan,
} from "./brand-grade-schema.mjs";
import { createRepairContract } from "./repair-contract.mjs";
import {
  buildRevisionPrompt,
  collectAuthorizedSectionIds,
  compilePortablePrompt,
  createRevisionAuthorization,
  normalizeRecipe,
  normalizeSectionInstructions,
  restoreLockedRecipeSections,
  restoreRevisionRecipeSections,
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
    return this.#runAndArchive(runId, thread, async () => {
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
    });
  }

  async revise(runId, currentRecipe, sectionInstructions = []) {
    const normalizedCurrentRecipe = normalizeRecipe(currentRecipe);
    const normalizedInstructions = normalizeSectionInstructions(
      normalizedCurrentRecipe,
      sectionInstructions,
    );
    const authorizedSectionIds = collectAuthorizedSectionIds(
      normalizedCurrentRecipe,
      normalizedInstructions,
    );
    const revisionAuthorization = createRevisionAuthorization(
      normalizedCurrentRecipe,
      authorizedSectionIds,
    );
    const thread = await this.#getOrResumeThread(runId);
    return this.#runAndArchive(runId, thread, async () => {
      const generatedRecipe = normalizeRecipe(
        await thread.run({
          input: [
            {
              type: "text",
              text: buildRevisionPrompt(normalizedCurrentRecipe, normalizedInstructions),
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
      const recipe = restoreRevisionRecipeSections(generatedRecipe, normalizedCurrentRecipe, {
        ...revisionAuthorization,
      });
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
    });
  }

  async matchProduct(runId, currentRecipe) {
    const normalizedCurrentRecipe = normalizeRecipe(currentRecipe);
    const productImagePath = await this.#store.getProductImagePath(runId);
    if (!productImagePath) throw new Error("请先添加产品图");
    const thread = await this.#getOrResumeThread(runId);
    return this.#runAndArchive(runId, thread, async () => {
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
    });
  }

  async auditBrandGrade({ runId, brief }) {
    const run = await this.#store.loadRun(runId);
    if (run.workflow !== "brand_grade") {
      throw new Error("Run is not a brand-grade workflow");
    }
    const thread = await this.#appServer.startThread({ cwd: this.#workspaceRoot });
    this.#attachThread(runId, thread);
    await this.#store.saveThreadId(runId, thread.id);
    return this.#runAndArchive(runId, thread, async () => {
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
    });
  }

  async createFinishOnlyPlan({ runId, direction = "" }) {
    const run = await this.#store.loadRun(runId);
    if (run.workflow !== "brand_grade") {
      throw new Error("Run is not a brand-grade workflow");
    }
    const normalizedDirection = String(direction ?? "").trim();
    if (normalizedDirection.length > 1000) {
      throw new Error("精修调性要求不能超过 1000 个字符");
    }
    const thread = await this.#appServer.startThread({ cwd: this.#workspaceRoot });
    this.#attachThread(runId, thread);
    await this.#store.saveThreadId(runId, thread.id);
    return this.#runAndArchive(runId, thread, async () => {
      const plan = validateFinishOnlyPlan(await thread.run(createFinishOnlyPlanTurnParams({
        threadId: thread.id,
        sourcePath: await this.#store.getImagePath(runId),
        direction: normalizedDirection,
        skillPath: this.#brandGradeSkillPath,
      })), { hasBrandDirection: normalizedDirection !== "" });
      const result = {
        ...plan,
        sourceVersionId: run.sourceVersionId,
        platformPrompt: compileFinishOnlyPrompt({ plan, direction: normalizedDirection }),
      };
      await this.#store.saveFinishOnlyPlan(runId, result);
      return result;
    });
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
    return this.#runAndArchive(runId, thread, async () => {
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
    });
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

  #detachThread(runId, thread) {
    const session = this.#sessions.get(runId);
    if (!session || session.thread !== thread) return;
    session.thread.off("event", session.eventHandler);
    session.thread.close();
    this.#sessions.delete(runId);
  }

  async #runAndArchive(runId, thread, operation) {
    try {
      return await operation();
    } finally {
      await this.#archiveThread(runId, thread);
    }
  }

  async #archiveThread(runId, thread) {
    this.#detachThread(runId, thread);
    if (typeof this.#appServer.archiveThread !== "function") return;
    try {
      await this.#appServer.archiveThread(thread.id);
      await this.#store.setThreadArchived(runId, true);
    } catch (error) {
      this.emit("cleanup-warning", { runId, threadId: thread.id, error });
    }
  }

  async #getOrResumeThread(runId) {
    let thread = this.#sessions.get(runId)?.thread;
    if (thread) return thread;
    const state = typeof this.#store.getThreadState === "function"
      ? await this.#store.getThreadState(runId)
      : { threadId: await this.#store.getThreadId(runId), archived: false };
    const { threadId } = state;
    if (!threadId) throw new Error("This run has no Codex thread. Analyze it first.");
    if (state.archived && typeof this.#appServer.unarchiveThread === "function") {
      try {
        await this.#appServer.unarchiveThread(threadId);
        await this.#store.setThreadArchived(runId, false);
      } catch (unarchiveError) {
        try {
          thread = await this.#appServer.resumeThread(threadId);
          await this.#store.setThreadArchived(runId, false);
          this.#attachThread(runId, thread);
          return thread;
        } catch {
          throw unarchiveError;
        }
      }
    }
    try {
      thread = await this.#appServer.resumeThread(threadId);
    } catch (resumeError) {
      if (state.archived || typeof this.#appServer.unarchiveThread !== "function") {
        throw resumeError;
      }
      try {
        await this.#appServer.unarchiveThread(threadId);
        await this.#store.setThreadArchived(runId, false);
        thread = await this.#appServer.resumeThread(threadId);
      } catch {
        throw resumeError;
      }
    }
    this.#attachThread(runId, thread);
    return thread;
  }
}
