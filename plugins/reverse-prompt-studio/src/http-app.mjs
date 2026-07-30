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

export function createStudioHttpServer({ service, store, publicDirectory }) {
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

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const { runId } = await readJson(request);
        return sendJson(response, 200, await service.analyze(runId));
      }

      if (request.method === "POST" && url.pathname === "/api/revise") {
        const { runId, recipe } = await readJson(request);
        return sendJson(response, 200, await service.revise(runId, recipe));
      }

      if (request.method === "GET") {
        return serveStatic(response, publicDirectory, url.pathname);
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = /Unsupported image type|Invalid run id|too large/i.test(error.message)
        ? 400
        : 500;
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
