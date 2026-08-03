import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

export function createStudioHttpServer({ service, store, publicDirectory, updateChecker }) {
  const clients = new Set();
  const onServiceEvent = (event) => {
    const payload = `event: codex\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(payload);
  };
  service.on("event", onServiceEvent);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { status: "ready" });
      }

      if (request.method === "GET" && url.pathname === "/api/update") {
        const update = updateChecker
          ? await updateChecker.check()
          : { status: "unavailable" };
        return sendJson(response, 200, update);
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write("event: ready\ndata: {}\n\n");
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/upload") {
        const bytes = await readBody(request);
        const run = await store.createRun({
          bytes,
          contentType: request.headers["content-type"],
        });
        return sendJson(response, 201, {
          runId: run.id,
          imageUrl: `/api/runs/${run.id}/image`,
        });
      }

      const productMatch = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/product$/i);
      if (request.method === "POST" && productMatch) {
        const bytes = await readBody(request);
        await store.saveProductImage(productMatch[1], {
          bytes,
          contentType: request.headers["content-type"],
        });
        return sendJson(response, 201, {
          runId: productMatch[1],
          productImageUrl: `/api/runs/${productMatch[1]}/product`,
        });
      }

      const imageMatch = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/image$/i);
      if (request.method === "GET" && imageMatch) {
        const imagePath = await store.getImagePath(imageMatch[1]);
        const bytes = await readFile(imagePath);
        response.writeHead(200, {
          "content-type": CONTENT_TYPES.get(path.extname(imagePath).toLowerCase()) ?? "application/octet-stream",
          "cache-control": "private, max-age=3600",
        });
        return response.end(bytes);
      }

      if (request.method === "GET" && productMatch) {
        const imagePath = await store.getProductImagePath(productMatch[1]);
        if (!imagePath) return sendJson(response, 404, { error: "Product image not found" });
        const bytes = await readFile(imagePath);
        response.writeHead(200, {
          "content-type": CONTENT_TYPES.get(path.extname(imagePath).toLowerCase()) ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        return response.end(bytes);
      }

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const { runId, transferMode, replacementSubject } = await readJson(request);
        return sendJson(response, 200, await service.analyze(runId, {
          transferMode,
          replacementSubject,
        }));
      }

      if (request.method === "POST" && url.pathname === "/api/revise") {
        const { runId, recipe, sectionInstructions } = await readJson(request);
        return sendJson(
          response,
          200,
          await service.revise(runId, recipe, sectionInstructions),
        );
      }
      if (request.method === "POST" && url.pathname === "/api/product-match") {
        const { runId, recipe } = await readJson(request);
        return sendJson(response, 200, await service.matchProduct(runId, recipe));
      }

      if (request.method === "POST" && url.pathname === "/api/brand-grade/runs") {
        const run = await store.createRun({
          bytes: await readBody(request),
          contentType: request.headers["content-type"],
          workflow: "brand_grade",
        });
        return sendJson(response, 201, {
          id: run.id,
          workflow: run.workflow,
          sourceVersionId: run.sourceVersionId,
        });
      }

      const inputMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/inputs$/i,
      );
      if (request.method === "POST" && inputMatch) {
        const input = await store.addRoleImage(inputMatch[1], {
          bytes: await readBody(request),
          contentType: request.headers["content-type"],
          role: url.searchParams.get("role"),
        });
        return sendJson(response, 201, input);
      }

      const auditMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/audit$/i,
      );
      if (request.method === "POST" && auditMatch) {
        return sendJson(response, 200, await service.auditBrandGrade({
          runId: auditMatch[1],
          brief: await readJson(request),
        }));
      }

      const contractMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/contracts$/i,
      );
      if (request.method === "POST" && contractMatch) {
        const { findingId } = await readJson(request);
        return sendJson(response, 201, await service.createBrandGradeRepairContract({
          runId: contractMatch[1],
          findingId,
        }));
      }

      const candidateMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/candidates$/i,
      );
      if (request.method === "POST" && candidateMatch) {
        return sendJson(response, 201, await store.addCandidate(candidateMatch[1], {
          bytes: await readBody(request),
          contentType: request.headers["content-type"],
        }));
      }

      const compareMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/candidates\/([0-9a-f-]{36})\/compare$/i,
      );
      if (request.method === "POST" && compareMatch) {
        return sendJson(response, 200, await service.compareBrandGradeCandidate({
          runId: compareMatch[1],
          candidateId: compareMatch[2],
        }));
      }

      const approveMatch = url.pathname.match(
        /^\/api\/brand-grade\/runs\/([0-9a-f-]{36})\/candidates\/([0-9a-f-]{36})\/approve$/i,
      );
      if (request.method === "POST" && approveMatch) {
        return sendJson(response, 200, await service.approveBrandGradeCandidate({
          runId: approveMatch[1],
          candidateId: approveMatch[2],
        }));
      }

      if (request.method === "GET") {
        return serveStatic(response, publicDirectory, url.pathname);
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = errorStatus(error);
      sendJson(response, status, { error: error.message });
    }
  });

  server.on("close", () => {
    service.off("event", onServiceEvent);
    for (const client of clients) client.end();
    clients.clear();
  });
  return server;
}

function errorStatus(error) {
  if (error?.code === "ENOENT" || /Candidate not found/i.test(error.message)) return 404;
  if (
    error instanceof SyntaxError
    || /Unsupported image type|Invalid run id|too large|Image bytes are required|Unsupported workflow|Unsupported role|Unsupported transfer mode|replacementSubject|替换主体|sectionInstructions|未知板块|重复板块|修改要求不能为空|锁定板块|not a brand-grade workflow|earliest failed gate|Finding not found/i.test(error.message)
  ) return 400;
  if (
    /Codex|JSON-RPC|Turn |structured agent message|schema must|gates must|earliestFailureGate|verdict must|lock drift cannot PASS/i.test(error.message)
  ) return 502;
  return 500;
}

async function readJson(request) {
  const bytes = await readBody(request);
  return JSON.parse(bytes.toString("utf8"));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(response, publicDirectory, requestPath) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const root = path.resolve(publicDirectory);
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    return sendJson(response, 404, { error: "Not found" });
  }
  try {
    const contents = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
    });
    response.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

function sendJson(response, status, body) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
