import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../portals/dist",
);
const entry = path.join(root, "index.html");
const managedHostPaths = new Set(["_portals/sdk.js"]);

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    // Dropbox Cloud Files can mark a hydrated regular file as a reparse point.
    // On Windows Dirent reports that as a symbolic link even though lstat says
    // it is a regular file and readlink returns EINVAL. Use the authoritative
    // stat for the exact path so a real symlink is still rejected without
    // falsely invalidating every file in a synced workspace.
    const itemStat = await lstat(absolute);
    if (itemStat.isSymbolicLink())
      throw new Error(`Static output contains a symbolic link: ${absolute}`);
    if (itemStat.isDirectory()) files.push(...(await walk(absolute)));
    else if (itemStat.isFile()) files.push(absolute);
    else throw new Error(`Static output contains a non-regular file: ${absolute}`);
  }
  return files;
}

function localReference(value) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) return null;
  const clean = value.split(/[?#]/, 1)[0]?.replace(/^\.\//, "");
  if (!clean || managedHostPaths.has(clean)) return null;
  return clean;
}

const entryStat = await lstat(entry);
if (!entryStat.isFile()) throw new Error("portals/dist/index.html is not a regular file");

const files = await walk(root);
const html = await readFile(entry, "utf8");
const references = [
  ...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g),
].map((match) => match[1]);

for (const value of references) {
  const relative = localReference(value);
  if (!relative) continue;
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`))
    throw new Error(`Static reference escapes portals/dist: ${value}`);
  const stat = await lstat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Static reference is missing: ${value}`);
}

const sizes = await Promise.all(
  files.map(async (file) => ({ file, bytes: (await lstat(file)).size })),
);
const largest = sizes.reduce((current, item) =>
  item.bytes > current.bytes ? item : current,
);
const bytes = sizes.reduce((total, item) => total + item.bytes, 0);

console.log(
  JSON.stringify(
    {
      status: "ok",
      projectDirectory: "portals/dist",
      entryFile: "index.html",
      regularFiles: files.length,
      totalBytes: bytes,
      largestFile: path.relative(root, largest.file).replaceAll("\\", "/"),
      largestFileBytes: largest.bytes,
    },
    null,
    2,
  ),
);
