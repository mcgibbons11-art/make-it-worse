import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const e2eDistDir = `.next-e2e-link-${process.pid}`;
const physicalDistDir = join(tmpdir(), `make-it-worse-e2e-${process.pid}`);
const junctionPath = join(process.cwd(), e2eDistDir);
const tsconfigPath = join(process.cwd(), "tsconfig.json");
// Next adds the active distDir to tsconfig during a build. Strip any orphaned
// E2E entries before starting so a previously interrupted/concurrent run cannot
// poison the next production build.
const originalTsconfig = readFileSync(tsconfigPath, "utf8").replace(
  /^\s*"\.next-e2e-link-[^"]+"[,]?\r?\n/gm,
  "",
);
writeFileSync(tsconfigPath, originalTsconfig);
mkdirSync(physicalDistDir, { recursive: true });
symlinkSync(physicalDistDir, junctionPath,
  process.platform === "win32" ? "junction" : "dir");
const env = {
  ...process.env,
  NEXT_DIST_DIR: e2eDistDir,
  NEXT_PUBLIC_E2E_TEST_MODE: "1",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
};

function run(args) {
  // Avoid shell parsing entirely. In particular, Windows cmd treats `|` in a
  // Playwright --grep expression as a pipeline even when it arrived as one arg.
  const installedPnpmCli = process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs")
    : "";
  const pnpmCli =
    process.env.npm_execpath ||
    (process.platform === "win32" && existsSync(installedPnpmCli)
      ? installedPnpmCli
      : undefined);
  const command = pnpmCli ? process.execPath : pnpm;
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${pnpm} ${args.join(" ")} failed`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

let exitCode = 0;
try {
  run(["exec", "next", "build"]);
  run(["exec", "playwright", "test", ...process.argv.slice(2)]);
} catch (error) {
  exitCode = error?.exitCode ?? 1;
  if (!error?.exitCode) console.error(error);
} finally {
  writeFileSync(tsconfigPath, originalTsconfig);
  if (existsSync(junctionPath)) unlinkSync(junctionPath);
  if (physicalDistDir.startsWith(tmpdir()))
    rmSync(physicalDistDir, { recursive: true, force: true });
}
process.exitCode = exitCode;
