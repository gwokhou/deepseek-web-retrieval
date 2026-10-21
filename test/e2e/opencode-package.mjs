// Run only inside the pinned e2e container, against its isolated HOME.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const password = "keyless-package-test";
const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "4096"], {
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
let exited = false;
const capture = (data) => {
  diagnostics = `${diagnostics}${data}`.slice(-8000);
};
child.stdout.on("data", capture);
child.stderr.on("data", capture);
child.on("error", (error) => {
  capture(error);
  exited = true;
});
const stopped = new Promise((resolve) =>
  child.once("close", () => {
    exited = true;
    resolve();
  }),
);
let inventory;
try {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    assert.equal(exited, false, `OpenCode exited before plugin activation:\n${diagnostics}`);
    let response;
    try {
      response = await fetch("http://127.0.0.1:4096/api/plugin", {
        headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // The server may still be binding its port.
      await delay(200);
      continue;
    }
    assert.equal(response.ok, true, `Plugin inventory returned HTTP ${response.status}`);
    inventory = await response.json();
    const plugin = inventory.data.find((entry) => entry.id === "deepseek-web-retrieval");
    const failed = inventory.data.find((entry) => entry.state.status === "failed");
    assert.equal(failed, undefined, `Plugin activation failed: ${JSON.stringify(failed)}\n${diagnostics}`);
    if (plugin?.state.status === "active") {
      console.log("packed OpenCode plugin activated through host SDKs");
      break;
    }
    await delay(200);
  }
  assert.ok(
    inventory?.data.some((entry) => entry.id === "deepseek-web-retrieval" && entry.state.status === "active"),
    `Plugin activation did not finish: ${JSON.stringify(inventory)}\n${diagnostics}`,
  );
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await stopped;
  clearTimeout(timer);
}
