import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standalone = resolve(root, ".next/standalone");
const server = resolve(standalone, "server.js");
if (!existsSync(server)) throw new Error("Run npm run build:node before npm run start:node.");
mkdirSync(resolve(standalone, ".next"), { recursive: true });
cpSync(resolve(root, ".next/static"), resolve(standalone, ".next/static"), { recursive: true });
if (existsSync(resolve(root, "public"))) cpSync(resolve(root, "public"), resolve(standalone, "public"), { recursive: true });

const child = spawn(process.execPath, [server], { cwd: standalone, stdio: "inherit", env: { ...process.env, HOSTNAME: process.env.DUPDASH_BIND_HOST || "127.0.0.1" } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
