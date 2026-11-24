// Regressionstest für das Fensterlayout (T-122): Der Zeichenbereich hinter dem
// Kopf muss ein Flex-Container sein und waagerecht schrumpfen dürfen. Sonst
// füllt die Seite die Höhe nicht (alles wird abgeschnitten) oder schiebt ihren
// rechten Rand aus dem Fenster.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const main = join(dirname(fileURLToPath(import.meta.url)), "..", "main.js");

/** Der Quelltext von renderWindow ab dem Zeichenbereich bis zur Overlay-Ebene. */
function windowBodySource() {
  const source = readFileSync(main, "utf8");
  const start = source.indexOf("const contentPane =");
  const end = source.indexOf("const overlay =", start);
  assert.ok(start >= 0 && end > start, "renderWindow: Zeichenbereich nicht gefunden");
  return source.slice(start, end).replace(/\s+/g, " ");
}

test("Fensterkörper: der Drawer-Host ist ein Flex-Container", () => {
  const body = windowBodySource();
  const host = body.match(/div\(\) \.relative\(\) (.*?)\.child\(/);
  assert.ok(host, "Fensterkörper: relativer Drawer-Host fehlt");
  assert.match(host[1], /\.flex\(\)/,
    "Drawer-Host braucht .flex(), sonst kollabiert die Seite auf ihre Eigenhöhe");
  assert.match(host[1], /\.flex_1\(\)/);
  assert.match(host[1], /\.min_h\(0\)/);
});

test("Fensterkörper: die Inhaltszeile darf waagerecht schrumpfen", () => {
  const body = windowBodySource();
  const row = body.match(/h_flex\(\) (.*?)\.items_stretch\(\)/);
  assert.ok(row, "Fensterkörper: Inhaltszeile fehlt");
  assert.match(row[1], /\.flex_1\(\)/);
  assert.match(row[1], /\.min_w\(0\)/,
    "Inhaltszeile braucht .min_w(0), sonst schiebt die min-content-Breite den rechten Rand aus dem Fenster");
  assert.match(row[1], /\.min_h\(0\)/);
});

test("Fensterkörper: der Zeichenbereich füllt Höhe und schneidet am Rand", () => {
  const body = windowBodySource();
  assert.match(body, /const contentPane = v_flex\(\)\s*\.flex_1\(\)\s*\.min_w\(0\)\s*\.h_full\(\)\s*\.min_h\(0\)\s*\.overflow_hidden\(\)/);
});
