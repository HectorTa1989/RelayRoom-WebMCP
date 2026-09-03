import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

const required = ["VITE_API_ORIGIN", "VITE_BUYER_ORIGIN", "VITE_SUPPLIER_ORIGIN", "VITE_CARRIER_ORIGIN"];
const missing = required.filter((name) => !process.env[name] || /localhost|127\.0\.0\.1/i.test(process.env[name]));
if (missing.length) {
  console.error(`Sites build requires deployed HTTPS origins for: ${missing.join(", ")}`);
  console.error("Set these variables before building; localhost origins would make the deployed app unusable.");
  process.exit(1);
}
for (const name of required) {
  if (!/^https:\/\//i.test(process.env[name])) {
    console.error(`${name} must use HTTPS for a Sites deployment`);
    process.exit(1);
  }
}
execFileSync("npm", ["run", "build", "-w", "@relayroom/room"], { stdio: "inherit", shell: true });
rmSync("dist", { recursive: true, force: true });
cpSync("apps/room/dist", "dist", { recursive: true });
