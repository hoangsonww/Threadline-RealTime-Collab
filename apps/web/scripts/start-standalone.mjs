import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const appRoot = process.cwd();
const buildRoot = resolve(appRoot, ".next");
const standaloneRoot = resolve(buildRoot, "standalone");
const serverPath = resolve(standaloneRoot, "apps/web/server.js");
const staticSource = resolve(buildRoot, "static");
const staticDestination = resolve(standaloneRoot, "apps/web/.next/static");
const publicSource = resolve(appRoot, "public");
const publicDestination = resolve(standaloneRoot, "apps/web/public");

if (!existsSync(serverPath) || !existsSync(staticSource)) {
  throw new Error("The standalone build is missing. Run `npm run build --workspace=@threadline/web` first.");
}

mkdirSync(dirname(staticDestination), { recursive: true });
cpSync(staticSource, staticDestination, { recursive: true, force: true });

if (existsSync(publicSource)) {
  cpSync(publicSource, publicDestination, { recursive: true, force: true });
}

const server = spawn(process.execPath, [serverPath], {
  cwd: dirname(serverPath),
  env: process.env,
  stdio: "inherit",
});

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
