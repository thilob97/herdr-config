// Tests des SQLite-Lesers: Quoting, JSON-Zerlegung und die gebundenen Abfragen.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";

import { createReader, logText, parseRows, sqlQuote } from "../db.js";

test("sqlQuote verdoppelt einfache Anführungszeichen", () => {
  assert.equal(sqlQuote("index"), "'index'");
  assert.equal(sqlQuote("ticket:T-1"), "'ticket:T-1'");
  assert.equal(sqlQuote("O'Brien"), "'O''Brien'");
  assert.equal(sqlQuote(null), "''");
  assert.equal(sqlQuote(12), "'12'");
});

test("parseRows: leere Ausgabe sind keine Zeilen, sonst ein Array", () => {
  assert.deepEqual(parseRows(""), []);
  assert.deepEqual(parseRows("  \n"), []);
  assert.deepEqual(parseRows('[{"value":"7"}]'), [{ value: "7" }]);
  assert.throws(() => parseRows('{"value":"7"}'), /kein JSON-Array/);
  assert.throws(() => parseRows("kein json"), SyntaxError);
});

test("logText hängt Zeilen in Leserichtung aneinander", () => {
  assert.equal(logText([]), "");
  assert.equal(logText([{ line: "a" }, { line: "b" }]), "a\nb");
  assert.equal(logText([{ line: "" }]), "");
});

test("createReader liest read_models, meta und Log über sqlite3", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const sql = args[3];
    if (sql.includes("FROM read_models")) {
      return { code: 0, stdout: '[{"value":"{\\"tickets\\":[]}"}]' };
    }
    if (sql.includes("FROM meta")) return { code: 0, stdout: '[{"value":"7"}]' };
    if (sql.includes("FROM autopilot_log")) {
      return { code: 0, stdout: '[{"line":"alt"},{"line":"neu"}]' };
    }
    return { code: 0, stdout: "" };
  };
  const db = createReader(run);

  assert.equal(await db.readModel("/x/fabric.db", "index"), '{"tickets":[]}');
  assert.equal(await db.metaValue("/x/fabric.db", "rev"), "7");
  assert.equal(logText(await db.autopilotLog("/x/fabric.db", 50)), "alt\nneu");

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.command, "/usr/bin/sqlite3");
    assert.deepEqual(call.args.slice(0, 3), ["-readonly", "-json", "/x/fabric.db"]);
  }
  assert.match(calls[0].args[3], /WHERE key = 'index'/);
  assert.match(calls[1].args[3], /meta/);
  assert.match(calls[3 - 1].args[3], /LIMIT 50/);
});

test("createReader meldet Fehler und fehlende Zeilen als null", async () => {
  const db = createReader(async () => ({ code: 1, stdout: "", stderr: "no such table: meta" }));
  await assert.rejects(() => db.metaValue("/x/fabric.db", "rev"), /no such table/);

  const empty = createReader(async () => ({ code: 0, stdout: "" }));
  assert.equal(await empty.readModel("/x/fabric.db", "index"), null);
  assert.equal(await empty.metaValue("/x/fabric.db", "rev"), null);
  assert.deepEqual(await empty.autopilotLog("/x/fabric.db"), []);
});
