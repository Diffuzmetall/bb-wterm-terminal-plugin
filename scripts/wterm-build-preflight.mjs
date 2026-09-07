#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const WTERM_PACKAGES = ["@wterm/core", "@wterm/dom", "@wterm/ghostty", "@wterm/react"];
const GHOSTTY_PACKAGE = "@wterm/ghostty";
const REPO_WASM = "ghostty-vt.wasm";
const INSTALLED_WASM = ["wasm", "ghostty-vt.wasm"];

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid (${error.message})`);
  }
}

function packagePath(root, name) {
  return join(root, "node_modules", ...name.split("/"));
}

function lockPath(name) {
  return `node_modules/${name}`;
}

async function sha256(path, label) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    throw new Error(`${label} is missing or unreadable (${error.message})`);
  }
}

export async function verifyWtermInstall(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  const errors = [];
  const manifest = await readJson(join(root, "package.json"), "root package.json");
  const lock = await readJson(join(root, "package-lock.json"), "root package-lock.json");
  const lockPackages = lock.packages ?? {};
  const packageResults = {};
  const installedPackages = {};

  for (const name of WTERM_PACKAGES) {
    const declared = manifest.dependencies?.[name];
    const lockEntry = lockPackages[lockPath(name)];
    if (name !== "@wterm/core" && declared === undefined) {
      errors.push(`${name}: root manifest dependency is missing`);
    }
    if (!lockEntry?.version) {
      errors.push(`${name}: authoritative package-lock entry is missing`);
    }

    let installed;
    try {
      installed = await readJson(join(packagePath(root, name), "package.json"), `${name} installed package.json`);
      installedPackages[name] = installed;
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    packageResults[name] = {
      declared: declared ?? null,
      locked: lockEntry?.version ?? null,
      installed: installed.version ?? null,
    };
    if (name !== "@wterm/core" && declared !== lockEntry?.version) {
      errors.push(`${name}: root manifest pins ${declared ?? "<missing>"}, but package-lock pins ${lockEntry?.version ?? "<missing>"}`);
    }
    if (installed.version !== lockEntry?.version) {
      errors.push(`${name}: installed ${installed.version ?? "<missing>"} does not match authoritative lock ${lockEntry?.version ?? "<missing>"}`);
    }
  }

  const coreVersion = installedPackages["@wterm/core"]?.version;
  for (const parent of ["@wterm/dom", "@wterm/ghostty"]) {
    const installed = installedPackages[parent];
    const lockEntry = lockPackages[lockPath(parent)];
    const expected = installed?.dependencies?.["@wterm/core"];
    const lockedExpected = lockEntry?.dependencies?.["@wterm/core"];
    if (expected !== coreVersion) {
      errors.push(`${parent}: installed dependency @wterm/core expects ${expected ?? "<missing>"}, installed core is ${coreVersion ?? "<missing>"}`);
    }
    if (lockedExpected !== coreVersion) {
      errors.push(`${parent}: package-lock dependency @wterm/core expects ${lockedExpected ?? "<missing>"}, installed core is ${coreVersion ?? "<missing>"}`);
    }
  }

  const react = installedPackages["@wterm/react"];
  const reactLock = lockPackages[lockPath("@wterm/react")];
  for (const [source, sourcePackage, sourceLock] of [
    ["@wterm/react", react, reactLock],
  ]) {
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const [name, expected] of Object.entries(sourcePackage?.[field] ?? {})) {
        if (!name.startsWith("@wterm/")) continue;
        const actual = installedPackages[name]?.version;
        const locked = sourceLock?.[field]?.[name];
        if (expected !== actual) {
          errors.push(`${source}: installed ${field} entry ${name} expects ${expected}, installed version is ${actual ?? "<missing>"}`);
        }
        if (locked !== actual) {
          errors.push(`${source}: package-lock ${field} entry ${name} expects ${locked ?? "<missing>"}, installed version is ${actual ?? "<missing>"}`);
        }
      }
    }
  }

  let repoSha256 = null;
  let installedSha256 = null;
  try {
    repoSha256 = await sha256(join(root, REPO_WASM), `repository ${REPO_WASM}`);
    installedSha256 = await sha256(
      join(packagePath(root, GHOSTTY_PACKAGE), ...INSTALLED_WASM),
      `installed ${GHOSTTY_PACKAGE}/${INSTALLED_WASM.join("/")}`,
    );
    if (repoSha256 !== installedSha256) {
      errors.push(`WASM mismatch: repository ${REPO_WASM} SHA-256 ${repoSha256} != installed ${GHOSTTY_PACKAGE}/${INSTALLED_WASM.join("/")} SHA-256 ${installedSha256}`);
    }
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length > 0) {
    const error = new Error(errors.join("\n"));
    error.preflightErrors = errors;
    throw error;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifiedVersions: Object.fromEntries(WTERM_PACKAGES.map((name) => [name, packageResults[name].installed])),
    packages: packageResults,
    wasm: {
      repository: REPO_WASM,
      installed: `${GHOSTTY_PACKAGE}/${INSTALLED_WASM.join("/")}`,
      sha256: repoSha256,
    },
  };
}

export async function writeProvenance(rootDir = process.cwd(), outputPath = "dist/wterm-build-provenance.json") {
  const root = resolve(rootDir);
  const provenance = await verifyWtermInstall(root);
  const output = resolve(root, outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  return { output, provenance };
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let outputPath = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root") root = args[++index];
    else if (args[index] === "--write-provenance") outputPath = args[++index] ?? "dist/wterm-build-provenance.json";
    else throw new Error(`unknown argument: ${args[index]}`);
  }

  const result = outputPath === null
    ? { provenance: await verifyWtermInstall(root) }
    : await writeProvenance(root, outputPath);
  const { provenance } = result;
  if (outputPath) {
    console.log(`Wterm build provenance saved to ${relative(resolve(root), result.output)}`);
  } else {
    console.log(`Wterm build preflight passed: ${Object.entries(provenance.verifiedVersions).map(([name, version]) => `${name}@${version}`).join(", ")}; WASM SHA-256 ${provenance.wasm.sha256}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Wterm build preflight failed:\n- ${error.message}`);
  process.exitCode = 1;
}
