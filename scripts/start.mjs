import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules/tsx/dist/cli.mjs");
const processes = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const [cwd, entry, envFile] of [
  [root, "scripts/serve-room.ts", ".env"],
  ...["api", "buyer-portal", "supplier-portal", "carrier-portal"].map((app) => [
    path.join(root, "apps", app),
    "src/server.ts",
    "../../.env",
  ]),
]) {
  const child = spawn(
    process.execPath,
    [cli, `--env-file-if-exists=${envFile}`, entry],
    {
      cwd,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
  processes.push(child);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
