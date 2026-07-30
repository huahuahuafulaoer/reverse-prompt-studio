import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_API =
  "https://api.github.com/repos/huahuahuafulaoer/reverse-prompt-studio/releases/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_COMMANDS = [
  "codex plugin marketplace upgrade reverse-prompt-studio-marketplace",
  "codex plugin add reverse-prompt-studio@reverse-prompt-studio-marketplace",
];

export function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next.numbers[index] !== installed.numbers[index]) {
      return next.numbers[index] > installed.numbers[index];
    }
  }
  return Boolean(installed.prerelease) && !next.prerelease;
}

export class UpdateChecker {
  #currentVersion;
  #cachePath;
  #fetch;
  #now;
  #ttlMs;
  #memo;

  constructor({
    currentVersion,
    cachePath,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
  }) {
    this.#currentVersion = currentVersion;
    this.#cachePath = cachePath;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  async check() {
    if (this.#memo) return this.#memo;
    const cached = await this.#readCache();
    if (cached && this.#now() - cached.checkedAt < this.#ttlMs) {
      this.#memo = resultForRelease(cached.release, this.#currentVersion);
      return this.#memo;
    }

    try {
      const response = await this.#fetch(RELEASE_API, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `reverse-prompt-studio/${this.#currentVersion}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
      const release = sanitizeRelease(await response.json());
      await this.#writeCache({ checkedAt: this.#now(), release });
      this.#memo = resultForRelease(release, this.#currentVersion);
      return this.#memo;
    } catch {
      if (cached?.release) {
        this.#memo = { ...resultForRelease(cached.release, this.#currentVersion), stale: true };
        return this.#memo;
      }
      this.#memo = { status: "unavailable", currentVersion: this.#currentVersion };
      return this.#memo;
    }
  }

  async #readCache() {
    try {
      const cached = JSON.parse(await readFile(this.#cachePath, "utf8"));
      if (!Number.isFinite(cached.checkedAt) || !cached.release) return null;
      return cached;
    } catch {
      return null;
    }
  }

  async #writeCache(cache) {
    await mkdir(path.dirname(this.#cachePath), { recursive: true });
    await writeFile(this.#cachePath, JSON.stringify(cache, null, 2));
  }
}

function resultForRelease(release, currentVersion) {
  const latestVersion = normalizeVersion(release.tag_name);
  const available = isNewerVersion(latestVersion, currentVersion);
  return {
    status: available ? "available" : "current",
    currentVersion,
    latestVersion,
    releaseName: release.name,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    ...(available ? { updateCommands: UPDATE_COMMANDS } : {}),
  };
}

function sanitizeRelease(release) {
  const latestVersion = normalizeVersion(release?.tag_name);
  if (!latestVersion) throw new Error("GitHub release has no semantic version tag");
  const releaseUrl = String(release?.html_url ?? "");
  if (!releaseUrl.startsWith("https://github.com/huahuahuafulaoer/reverse-prompt-studio/")) {
    throw new Error("GitHub release URL is invalid");
  }
  return {
    tag_name: `v${latestVersion}`,
    name: String(release?.name || `Reverse Prompt Studio v${latestVersion}`).slice(0, 160),
    html_url: releaseUrl,
    published_at: String(release?.published_at ?? ""),
  };
}

function normalizeVersion(value) {
  const parsed = parseVersion(value);
  return parsed ? parsed.numbers.join(".") + (parsed.prerelease ? `-${parsed.prerelease}` : "") : null;
}

function parseVersion(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? "",
  };
}
