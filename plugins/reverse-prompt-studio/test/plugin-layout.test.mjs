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
  assert.equal(manifest.version, "0.5.0");
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

test("bundles the brand grade finishing skill", async () => {
  await readFile(path.join(pluginRoot, "skills/brand-grade-finishing/SKILL.md"));
  await readFile(
    path.join(pluginRoot, "skills/brand-grade-finishing/references/output-contract.md"),
  );
});

test("bundled reverse-prompt contracts synchronize explicit section revisions", async () => {
  const skill = await readFile(
    path.join(pluginRoot, "skills/reverse-engineering-image-prompts/SKILL.md"),
    "utf8",
  );
  const contract = await readFile(
    path.join(
      pluginRoot,
      "skills/reverse-engineering-image-prompts/references/output-contract.md",
    ),
    "utf8",
  );

  for (const source of [skill, contract]) {
    assert.match(source, /明确.*板块.*修改.*同步.*contentAnchors/s);
    assert.match(source, /关联.*保留.*排除/s);
    assert.doesNotMatch(source, /revisions and product matching retain this contract unchanged/i);
  }
});

test("declares the 0.5 release across runtime metadata", async () => {
  const packageMetadata = JSON.parse(
    await readFile(path.join(pluginRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  const marketplacePackage = JSON.parse(
    await readFile(path.join(marketplaceRoot, "package.json"), "utf8"),
  );
  const readme = await readFile(path.join(pluginRoot, "README.md"), "utf8");
  const codexClient = await readFile(path.join(pluginRoot, "src/codex-client.mjs"), "utf8");

  assert.equal(packageMetadata.version, "0.5.0");
  assert.equal(manifest.version, "0.5.0");
  assert.equal(marketplacePackage.version, "0.5.0");
  assert.match(codexClient, /version: "0\.5\.0"/);
  for (const source of [
    "src/brand-grade-schema.mjs",
    "src/brand-grade-prompts.mjs",
    "src/repair-contract.mjs",
    "public/finish-state.js",
  ]) {
    assert.match(packageMetadata.scripts.check, new RegExp(source.replace(".", "\\.")));
  }
  assert.match(readme, /品牌级精修/);
  assert.match(readme, /生成精修提示词/);
  assert.match(readme, /人物、产品、构图和场景内容保持不变/);
  assert.doesNotMatch(readme, /最早失败层|单问题 contract|四层全部 PASS/);
  assert.match(readme, /不包含工具内直接出修复图/);
  assert.match(readme, /动作.*同步|同步.*动作/s);
  assert.match(readme, /自动归档/);
});
