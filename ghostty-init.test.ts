import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "@wterm/ghostty";
import {
  getAnyEventMouseModeState,
  supportAnyEventMouseMode,
} from "./wterm-renderer";
import { encodeLatin1 } from "./osc52-clipboard";
import { terminalLinkAction } from "./terminal-links";

const wasmBytes = await readFile(new URL("./ghostty-vt.wasm", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ghostty core wrapper", () => {
  it("inits, ignores a second init, and survives OSC 52 writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);

    core.init(120, 40);
    expect(core.getCols()).toBe(120);
    expect(core.getRows()).toBe(40);

    const afterChunk = vi.fn();
    expect(() => {
      core.writeRaw(encodeLatin1("hello\x1b]52;c;YQ==\x07world"), afterChunk);
      core.writeString("plain\n", afterChunk);
      core.writeRaw(new Uint8Array(4096).fill(65));
    }).not.toThrow();
    expect(afterChunk).toHaveBeenCalled();
  });

  it("accepts a direct Kitty RGB image and exposes bounded graphics state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({
        wasmPath: "http://wterm.test/ghostty-vt.wasm",
        imageStorageLimit: 32 * 1024 * 1024,
      }),
    );
    core.init(80, 24);

    expect(() => {
      core.writeString("\x1b_Ga=T,f=24,s=1,v=1,c=1,r=1,m=0;AP8A\x1b\\");
    }).not.toThrow();
    const graphics = core.getGraphicsState();
    expect(graphics?.images).toHaveLength(1);
    expect(graphics?.placements).toHaveLength(1);
    expect(core.getResourceState().graphics?.capacity).toBe(32 * 1024 * 1024);
    const image = graphics?.images[0];
    expect(image).toBeDefined();
    expect(core.getGraphicsImage?.(image!.imageId, image!.version)?.rgba).toEqual(
      new Uint8Array([0, 255, 0, 255]),
    );
  });

  it("tracks fragmented DEC 1003 enable and disable sequences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);

    core.writeString("\x1b[?10");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 0,
    });
    core.writeString("03h");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: true,
      generation: 1,
    });
    expect(core.mouseTracking()).toBe(1002);

    core.writeString("\x1b[?1002h");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 2,
    });
    expect(core.mouseTracking()).toBe(1002);

    core.writeString("\x1b[?1003h");
    core.writeRaw(encodeLatin1("\x1b[?1003l"));
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 4,
    });
  });

  it("ignores collapsed 1x1 init and resize from a hidden tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(1, 1);
    expect(core.getCols()).toBe(0);
    expect(core.getRows()).toBe(0);

    core.init(80, 24);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);

    core.resize(1, 1);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);
  });

  it("exposes OSC 8 web and file links through the renderer-safe core wrapper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);
    core.writeString(
      "\x1b]8;;https://example.com\x07web\x1b]8;;\x07\r\n" +
        "\x1b]8;;file:///workspace/src/app.ts\x07file\x1b]8;;\x07",
    );

    expect(core.getCell(0, 0).linkUri).toBe("https://example.com/");
    expect(terminalLinkAction(core.getCell(1, 0).linkUri ?? "")).toEqual({
      kind: "file",
      path: "/workspace/src/app.ts",
    });
  });
});

const preflightScript = fileURLToPath(new URL("./scripts/wterm-build-preflight.mjs", import.meta.url));

async function makePreflightFixture(options: {
  missing?: string;
  installedCoreVersion?: string;
  rootPinPackage?: string;
  wasmMatches?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "wterm-preflight-fixture-"));
  const version = "0.5.0";
  const packages = {
    "@wterm/core": { version },
    "@wterm/dom": { version, dependencies: { "@wterm/core": version } },
    "@wterm/ghostty": { version, dependencies: { "@wterm/core": version } },
    "@wterm/react": {
      version,
      peerDependencies: { "@wterm/dom": version, react: "^18.0.0 || ^19.0.0", "react-dom": "^18.0.0 || ^19.0.0" },
    },
  };
  const dependencies = Object.fromEntries(Object.keys(packages).filter((name) => name !== "@wterm/core").map((name) => [name, options.rootPinPackage === name ? "0.4.0" : version]));
  const lockPackages = Object.fromEntries(Object.entries(packages).map(([name, metadata]) => [`node_modules/${name}`, metadata]));
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies }, ...lockPackages } }));
  await writeFile(join(root, "ghostty-vt.wasm"), Buffer.from("repo wasm"));

  for (const [name, metadata] of Object.entries(packages)) {
    if (name === options.missing) continue;
    const packageRoot = join(root, "node_modules", ...name.split("/"));
    await mkdir(packageRoot, { recursive: true });
    const installed = { ...metadata };
    if (name === "@wterm/core" && options.installedCoreVersion) installed.version = options.installedCoreVersion;
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(installed));
    if (name === "@wterm/ghostty") {
      await mkdir(join(packageRoot, "wasm"), { recursive: true });
      await writeFile(join(packageRoot, "wasm", "ghostty-vt.wasm"), Buffer.from(options.wasmMatches === false ? "different wasm" : "repo wasm"));
    }
  }
  return root;
}

function runPreflight(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [preflightScript, "--root", root, ...args], { encoding: "utf8" });
}

describe("Wterm build preflight", () => {
  it("passes matching manifest, lock, installed packages, core, and WASM", async () => {
    const root = await makePreflightFixture();
    const result = runPreflight(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@wterm/core@0.5.0");
    expect(result.stdout).toContain("WASM SHA-256");

    await mkdir(join(root, "dist"), { recursive: true });
    const provenanceResult = runPreflight(root, ["--write-provenance", "dist/provenance.json"]);
    expect(provenanceResult.status).toBe(0);
    const provenance = JSON.parse(await readFile(join(root, "dist/provenance.json"), "utf8"));
    expect(provenance.verifiedVersions["@wterm/ghostty"]).toBe("0.5.0");
    expect(provenance.wasm.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["missing package", { missing: "@wterm/dom" }, "@wterm/dom installed package.json is missing"],
    ["wrong transitive core", { installedCoreVersion: "0.4.0" }, "installed core is 0.4.0"],
    ["mismatched root pin", { rootPinPackage: "@wterm/dom" }, "root manifest pins 0.4.0"],
    ["WASM", { wasmMatches: false }, "WASM mismatch"],
  ])("fails with a clear reason for %s", async (_name, options, reason) => {
    const result = runPreflight(await makePreflightFixture(options));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(reason);
  });

  it("fails the whole build before the bundler and preserves prior artifacts", async () => {
    const root = await makePreflightFixture({ wasmMatches: false });
    const dist = join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "manifest.json"), "previous manifest\\n");
    await writeFile(join(root, "fake-bundler.mjs"), "import { writeFile } from 'node:fs/promises'; await writeFile('dist/bundler-ran', 'bad'); await writeFile('dist/manifest.json', 'new manifest\\n');");
    const result = spawnSync("/bin/sh", ["-c", '"$NODE" "$SCRIPT" --root "$WTERM_FIXTURE" && "$NODE" fake-bundler.mjs'], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE: process.execPath, SCRIPT: preflightScript, WTERM_FIXTURE: root },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("WASM mismatch");
    expect(await readFile(join(dist, "manifest.json"), "utf8")).toBe("previous manifest\\n");
    await expect(readFile(join(dist, "bundler-ran"), "utf8")).rejects.toThrow();
  });
});
