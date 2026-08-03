import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateBrandGradeAudit, validateBrandGradeComparison } from "../src/brand-grade-schema.mjs";
import {
  createBrandGradeAuditTurnParams,
  createBrandGradeComparisonTurnParams,
} from "../src/brand-grade-prompts.mjs";
import { CodexAppServer } from "../src/codex-client.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("labels every audit image with one primary role", () => {
  const params = createBrandGradeAuditTurnParams({
    threadId: "thread-1",
    skillPath: "/tmp/brand-grade/SKILL.md",
    sourcePath: "/tmp/source.png",
    roleInputs: [{ id: "truth-1", role: "product_truth", path: "/tmp/truth.jpg" }],
    brief: {
      channel: "PDP",
      audience: "护肤消费者",
      firstRead: "产品",
      brandCharacter: "专业克制",
      copySafeArea: "右上",
    },
  });
  assert.deepEqual(
    params.input.filter((item) => item.type === "localImage").map((item) => item.path),
    ["/tmp/source.png", "/tmp/truth.jpg"],
  );
  assert.match(params.input[0].text, /source\.png = edit_target/);
  assert.match(params.input[0].text, /truth\.jpg = product_truth/);
  assert.equal(params.input[1].type, "skill");
  assert.equal(params.outputSchema.properties.schema.const, "brand-grade-audit/v1");
});

test("comparison includes source, candidate, and the selected contract", () => {
  const params = createBrandGradeComparisonTurnParams({
    threadId: "thread-1",
    skillPath: "/tmp/brand-grade/SKILL.md",
    sourcePath: "/tmp/source.png",
    candidatePath: "/tmp/candidate.png",
    audit: { schema: "brand-grade-audit/v1" },
    contract: {
      schema: "brand-grade-repair-contract/v1",
      lockedPaths: ["M.subject"],
    },
  });
  assert.equal(params.input.filter((item) => item.type === "localImage").length, 2);
  assert.match(params.input[0].text, /brand-grade-comparison\/v1/);
  assert.match(params.input[0].text, /M\.subject/);
  assert.equal(params.outputSchema.properties.schema.const, "brand-grade-comparison/v1");
});

test("fake App Server returns valid audit and comparison contracts", async () => {
  const appServer = await CodexAppServer.launch({
    command: process.execPath,
    args: [path.join(testDirectory, "../fixtures/fake-app-server.mjs")],
  });

  try {
    const thread = await appServer.startThread({ cwd: "/tmp/project" });
    const audit = validateBrandGradeAudit(await thread.run(createBrandGradeAuditTurnParams({
      threadId: thread.id,
      skillPath: "/tmp/brand-grade/SKILL.md",
      sourcePath: "/tmp/source.png",
      roleInputs: [],
      brief: {},
    })));
    assert.equal(audit.earliestFailureGate, "G1");

    const comparison = validateBrandGradeComparison(
      await thread.run(createBrandGradeComparisonTurnParams({
        threadId: thread.id,
        skillPath: "/tmp/brand-grade/SKILL.md",
        sourcePath: "/tmp/source.png",
        candidatePath: "/tmp/candidate.png",
        audit,
        contract: { lockedPaths: ["M.subject"] },
      })),
    );
    assert.equal(comparison.allowedUse, "approved_source");
    thread.close();
  } finally {
    appServer.close();
  }
});
