import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { INPUT_ROLES } from "./brand-grade-schema.mjs";

const IMAGE_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

export function imageExtensionFor(contentType) {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase();
  const extension = IMAGE_EXTENSIONS.get(normalized);
  if (!extension) throw new Error(`Unsupported image type: ${contentType || "unknown"}`);
  return extension;
}

export class RunStore {
  #root;

  constructor(root) {
    this.#root = path.resolve(root);
  }

  async createRun({ bytes, contentType, workflow = "reverse_prompt" }) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new Error("Image bytes are required");
    }
    if (!["reverse_prompt", "brand_grade"].includes(workflow)) {
      throw new Error("Unsupported workflow");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const runDirectory = path.join(this.#root, id);
    const imagePath = path.join(runDirectory, `source${imageExtensionFor(contentType)}`);
    const run = {
      id,
      workflow,
      createdAt,
      updatedAt: createdAt,
      imagePath,
      sourceVersionId: "source-v1",
      inputs: [],
      candidates: [],
      approvedCandidateId: null,
    };
    await mkdir(runDirectory, { recursive: true });
    await writeFile(imagePath, bytes);
    await this.#writeRun(run);
    return run;
  }

  async saveRecipe(id, recipe, kind = "revision") {
    const runDirectory = this.#runDirectory(id);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "recipe.json"), JSON.stringify(recipe, null, 2));
    const revisionsPath = path.join(runDirectory, "revisions.json");
    let revisions = [];
    try {
      revisions = JSON.parse(await readFile(revisionsPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    revisions.push({ kind, createdAt: new Date().toISOString(), recipe });
    await writeFile(revisionsPath, JSON.stringify(revisions, null, 2));
  }

  async saveProductImage(id, { bytes, contentType }) {
    const runDirectory = this.#runDirectory(id);
    const runPath = path.join(runDirectory, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8"));
    const productImagePath = path.join(
      runDirectory,
      `product${imageExtensionFor(contentType)}`,
    );
    await writeFile(productImagePath, bytes);
    await writeFile(runPath, JSON.stringify({ ...run, productImagePath }, null, 2));
    return { id, productImagePath };
  }

  async saveThreadId(id, threadId) {
    const runDirectory = this.#runDirectory(id);
    const runPath = path.join(runDirectory, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8"));
    await writeFile(
      runPath,
      JSON.stringify({ ...run, threadId, threadArchived: false }, null, 2),
    );
  }

  async getThreadId(id) {
    const runDirectory = this.#runDirectory(id);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8"));
    return run.threadId ?? null;
  }

  async getThreadState(id) {
    const runDirectory = this.#runDirectory(id);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8"));
    return {
      threadId: run.threadId ?? null,
      archived: run.threadArchived === true,
    };
  }

  async setThreadArchived(id, archived) {
    if (typeof archived !== "boolean") throw new Error("Thread archived state must be boolean");
    const runDirectory = this.#runDirectory(id);
    const runPath = path.join(runDirectory, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8"));
    if (!run.threadId) throw new Error("This run has no Codex thread");
    await writeFile(runPath, JSON.stringify({ ...run, threadArchived: archived }, null, 2));
  }

  async loadRun(id) {
    const runDirectory = this.#runDirectory(id);
    const run = await readFile(path.join(runDirectory, "run.json"), "utf8").then(JSON.parse);
    if ((run.workflow ?? "reverse_prompt") === "brand_grade") return run;
    const [recipe, revisions] = await Promise.all([
      readFile(path.join(runDirectory, "recipe.json"), "utf8").then(JSON.parse),
      readFile(path.join(runDirectory, "revisions.json"), "utf8").then(JSON.parse),
    ]);
    return { ...run, workflow: "reverse_prompt", recipe, revisions };
  }

  async addRoleImage(id, { bytes, contentType, role }) {
    if (!INPUT_ROLES.includes(role) || role === "edit_target") {
      throw new Error("Unsupported role image role");
    }
    const run = await this.loadRun(id);
    if (run.workflow !== "brand_grade") throw new Error("Run is not a brand-grade workflow");
    const inputId = randomUUID();
    const extension = imageExtensionFor(contentType);
    const relativePath = path.join("inputs", `${inputId}${extension}`);
    await mkdir(path.join(this.#runDirectory(id), "inputs"), { recursive: true });
    await writeFile(path.join(this.#runDirectory(id), relativePath), bytes);
    const input = { id: inputId, role, filename: relativePath };
    run.inputs.push(input);
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return input;
  }

  async saveBrandGradeAudit(id, audit) {
    const run = await this.loadRun(id);
    const version = (run.auditVersions?.length ?? 0) + 1;
    const relativePath = path.join("audits", `audit-v${version}.json`);
    await mkdir(path.join(this.#runDirectory(id), "audits"), { recursive: true });
    await writeFile(
      path.join(this.#runDirectory(id), relativePath),
      `${JSON.stringify(audit, null, 2)}\n`,
    );
    run.auditVersions = [...(run.auditVersions ?? []), relativePath];
    run.latestAudit = relativePath;
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return audit;
  }

  async saveFinishOnlyPlan(id, plan) {
    const run = await this.loadRun(id);
    if (run.workflow !== "brand_grade") throw new Error("Run is not a brand-grade workflow");
    const version = (run.finishPlanVersions?.length ?? 0) + 1;
    const relativePath = path.join("finish-plans", `plan-v${version}.json`);
    await mkdir(path.join(this.#runDirectory(id), "finish-plans"), { recursive: true });
    await writeFile(
      path.join(this.#runDirectory(id), relativePath),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    run.finishPlanVersions = [...(run.finishPlanVersions ?? []), relativePath];
    run.latestFinishPlan = relativePath;
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return plan;
  }

  async saveRepairContract(id, contract) {
    const run = await this.loadRun(id);
    const version = (run.contractVersions?.length ?? 0) + 1;
    const relativePath = path.join("contracts", `contract-v${version}.json`);
    await mkdir(path.join(this.#runDirectory(id), "contracts"), { recursive: true });
    await writeFile(
      path.join(this.#runDirectory(id), relativePath),
      `${JSON.stringify(contract, null, 2)}\n`,
    );
    run.contractVersions = [...(run.contractVersions ?? []), relativePath];
    run.latestContract = relativePath;
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return contract;
  }

  async addCandidate(id, { bytes, contentType }) {
    const run = await this.loadRun(id);
    if (run.workflow !== "brand_grade") throw new Error("Run is not a brand-grade workflow");
    const candidateId = randomUUID();
    const extension = imageExtensionFor(contentType);
    const relativePath = path.join("candidates", candidateId, `image${extension}`);
    await mkdir(path.join(this.#runDirectory(id), "candidates", candidateId), {
      recursive: true,
    });
    await writeFile(path.join(this.#runDirectory(id), relativePath), bytes);
    const candidate = {
      id: candidateId,
      filename: relativePath,
      createdAt: new Date().toISOString(),
      comparison: null,
    };
    run.candidates.push(candidate);
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return candidate;
  }

  async saveComparison(id, candidateId, comparison) {
    const run = await this.loadRun(id);
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const relativePath = path.join("candidates", candidateId, "comparison.json");
    await writeFile(
      path.join(this.#runDirectory(id), relativePath),
      `${JSON.stringify(comparison, null, 2)}\n`,
    );
    candidate.comparison = relativePath;
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return comparison;
  }

  async approveCandidate(id, candidateId) {
    const run = await this.loadRun(id);
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate?.comparison) throw new Error("Candidate comparison is required");
    const comparison = JSON.parse(
      await readFile(path.join(this.#runDirectory(id), candidate.comparison), "utf8"),
    );
    if (comparison.lockDrift?.some((item) => item.status === "FAIL")) {
      throw new Error("Candidate with lock drift cannot be approved");
    }
    if (comparison.verdict !== "PASS" || comparison.allowedUse !== "approved_source") {
      throw new Error("Only a passing candidate can be approved");
    }
    run.approvedCandidateId = candidateId;
    run.updatedAt = new Date().toISOString();
    await this.#writeRun(run);
    return run;
  }

  async getStoredPath(id, relativePath) {
    const runDirectory = this.#runDirectory(id);
    const resolved = path.resolve(runDirectory, relativePath);
    if (!resolved.startsWith(`${runDirectory}${path.sep}`)) {
      throw new Error("Stored path escapes its run directory");
    }
    await readFile(resolved);
    return resolved;
  }

  async loadLatestAudit(id) {
    const run = await this.loadRun(id);
    if (!run.latestAudit) throw new Error("Brand-grade audit is required");
    return JSON.parse(await readFile(await this.getStoredPath(id, run.latestAudit), "utf8"));
  }

  async loadLatestFinishOnlyPlan(id) {
    const run = await this.loadRun(id);
    if (!run.latestFinishPlan) throw new Error("Finish-only plan is required");
    return JSON.parse(
      await readFile(await this.getStoredPath(id, run.latestFinishPlan), "utf8"),
    );
  }

  async loadLatestContract(id) {
    const run = await this.loadRun(id);
    if (!run.latestContract) throw new Error("Repair contract is required");
    return JSON.parse(
      await readFile(await this.getStoredPath(id, run.latestContract), "utf8"),
    );
  }

  async getImagePath(id) {
    const runDirectory = this.#runDirectory(id);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8"));
    const resolvedImage = path.resolve(run.imagePath);
    if (!resolvedImage.startsWith(`${runDirectory}${path.sep}`)) {
      throw new Error("Stored image path escapes its run directory");
    }
    return resolvedImage;
  }

  async getProductImagePath(id) {
    const runDirectory = this.#runDirectory(id);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8"));
    if (!run.productImagePath) return null;
    const resolvedImage = path.resolve(run.productImagePath);
    if (!resolvedImage.startsWith(`${runDirectory}${path.sep}`)) {
      throw new Error("Stored product image path escapes its run directory");
    }
    return resolvedImage;
  }

  async #writeRun(run) {
    await writeFile(
      path.join(this.#runDirectory(run.id), "run.json"),
      JSON.stringify(run, null, 2),
    );
  }

  #runDirectory(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid run id");
    return path.join(this.#root, id);
  }
}
