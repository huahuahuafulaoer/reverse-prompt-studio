import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplaceRoot = path.resolve(pluginRoot, "../..");

test("the marketplace points to a self-contained Reverse Prompt Studio plugin", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  const packageMetadata = JSON.parse(
    await readFile(path.join(pluginRoot, "package.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    await readFile(
      path.join(marketplaceRoot, ".agents/plugins/marketplace.json"),
      "utf8",
    ),
  );

  assert.equal(manifest.name, "reverse-prompt-studio");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(manifest.repository, "https://github.com/huahuahuafulaoer/reverse-prompt-studio");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(marketplace.plugins[0].source.path, "./plugins/reverse-prompt-studio");

  await Promise.all(
    [
      "skills/reverse-prompt-studio/SKILL.md",
      "skills/reverse-engineering-image-prompts/SKILL.md",
      "skills/reverse-engineering-image-prompts/references/output-contract.md",
      "skills/reverse-engineering-image-prompts/references/type-modules.md",
      "scripts/start-studio.mjs",
      "src/server.mjs",
      "public/index.html",
    ].map(async (relativePath) => {
      const contents = await readFile(path.join(pluginRoot, relativePath));
      assert.ok(contents.length > 0, `${relativePath} should be present`);
    }),
  );
});

test("published text and runtime code do not contain the developer's absolute home path", async () => {
  const files = [
    ".codex-plugin/plugin.json",
    "README.md",
    "src/server.mjs",
    "skills/reverse-prompt-studio/SKILL.md",
  ];
  for (const relativePath of files) {
    const contents = await readFile(path.join(pluginRoot, relativePath), "utf8");
    assert.doesNotMatch(contents, /\/Users\/bjb03268/);
  }
});
