import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

  async createRun({ bytes, contentType }) {
    const id = randomUUID();
    const runDirectory = path.join(this.#root, id);
    const imagePath = path.join(runDirectory, `source${imageExtensionFor(contentType)}`);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(imagePath, bytes);
    await writeFile(
      path.join(runDirectory, "run.json"),
      JSON.stringify({ id, imagePath, createdAt: new Date().toISOString() }, null, 2),
    );
    return { id, imagePath };
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
    await writeFile(runPath, JSON.stringify({ ...run, threadId }, null, 2));
  }

  async getThreadId(id) {
    const runDirectory = this.#runDirectory(id);
    const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8"));
    return run.threadId ?? null;
  }

  async loadRun(id) {
    const runDirectory = this.#runDirectory(id);
    const [run, recipe, revisions] = await Promise.all([
      readFile(path.join(runDirectory, "run.json"), "utf8").then(JSON.parse),
      readFile(path.join(runDirectory, "recipe.json"), "utf8").then(JSON.parse),
      readFile(path.join(runDirectory, "revisions.json"), "utf8").then(JSON.parse),
    ]);
    return { ...run, recipe, revisions };
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

  #runDirectory(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid run id");
    return path.join(this.#root, id);
  }
}
