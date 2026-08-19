import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectDir, "node_modules", "vinext", "dist", "cli.js");

async function waitForServer(url, process) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Render server exited with code ${process.exitCode}.`);
    try { return await fetch(url); } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  throw new Error("Production server did not become ready.");
}

test("server-renders the independent authentication shell", async () => {
  const port = 3197;
  let server = null;
  try {
    let response;
    try { response = await fetch("http://localhost:3000/", { signal: AbortSignal.timeout(2_000) }); } catch {
      server = spawn(process.execPath, [cli, "dev", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: projectDir, stdio: "ignore", windowsHide: true });
      response = await waitForServer(`http://127.0.0.1:${port}/`, server);
    }
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /Personal Besties/);
    assert.match(html, /Sign in by email|Preparing your coaching workspace/);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  } finally {
    if (server) {
      server.kill();
      if (server.exitCode === null) await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
  }
});
