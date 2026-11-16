// Der Quests-seitige Leser der Ticket-Dateien, die bin/hub schreibt.
//   node --test mods/orchestra/test/tickets.test.mjs
//
// Die App-Module (herdr) werden durch Stubs ersetzt, damit die Regeln ohne Fenster laufen.
import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const HOST = dataUrl(`
export const appHome = () => "/tmp/herdr-test";
export const shared = () => null;
export const setShared = () => {};
`);

registerHooks({
  resolve(spec, context, next) {
    if (spec === "herdr") return { url: HOST, shortCircuit: true };
    return next(spec, context);
  },
});

const tickets = await import(pathToFileURL(join(here, "..", "tickets.js")).href);

const TICKET = `---
title: Prüfung
status: doing
---
# Prüfung

## Abnahmekriterien

- [ ] Die Tür schließt.

## Prüfung
- 2026-11-16 10:00 · pass · 1.2 s · exit 0 · HEAD abc1234 · .herdr/verify.sh

\`\`\`text
ok
\u200b## Kaputt
 ## echt
zeile
\`\`\`

## Verlauf
- 2026-11-16 10:01 · hub · fertig
`;

test("verifyOf liest die Ausgabe trotz einer ## Zeile vollständig", () => {
  const t = tickets.parse("x", TICKET);
  const v = tickets.verifyOf(t);
  assert.ok(v, "der ## Prüfung Abschnitt wird gefunden");
  assert.deepEqual(v.tail, ["ok", "## Kaputt", " ## echt", "zeile"],
    "nur die hub-entschärfte ## Zeile kommt ohne Markierung zurück; eine echte ## Zeile bleibt bytegleich");
  assert.equal(v.fields.checks, "pass");
  assert.equal(v.fields.head, "abc1234");
  assert.equal(v.fields.cmd, ".herdr/verify.sh");
});

test("ohne ## Prüfung gibt es nichts zu lesen", () => {
  const t = tickets.parse("x", "---\ntitle: Leer\n---\n## Ziel\n\nEtwas.\n");
  assert.equal(tickets.verifyOf(t), null);
});
