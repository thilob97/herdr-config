// readJson fällt auf exec zurück, wenn readTextFile eine Datei über 1 MiB
// nicht liefert (~/.claude.json). readTextFile wird hier zum Werfen gebracht,
// exec liefert das JSON.
//   node --test mods/mcp-servers/test/read-json.test.mjs

import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const APP = dataUrl(`
export const home = () => "/home/me";
export const readTextFile = async () => { throw new Error("file is too large"); };
export const writeTextFile = async () => {};
export const exec = async (program, argv) => {
  const cat = program === "sh" && argv[0] === "-c" && argv[1] === 'cat "$1"' && argv[3].endsWith(".claude.json");
  return { code: cat ? 0 : 1, stdout: cat ? '{"mcpServers":{"big":{"command":"node"}}}' : "", stderr: "" };
};
`);

registerHooks({
  resolve(spec, context, next) {
    return spec === "herdr" ? { url: APP, shortCircuit: true } : next(spec, context);
  },
});

const { readJson } = await import(pathToFileURL(join(here, "..", "hosts.js")).href);
const m = { name: null, win: false, home: "/home/me" };

test("liest eine zu große Datei über exec", async () => {
  const { text, data } = await readJson(m, "/home/me/.claude.json");
  assert.match(text, /mcpServers/);
  assert.equal(data.mcpServers.big.command, "node");
});

test("eine fehlende Datei bleibt absent", async () => {
  const { text, data } = await readJson(m, "/home/me/missing.json");
  assert.equal(text, null);
  assert.equal(data, null);
});
