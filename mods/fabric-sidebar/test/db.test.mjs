// Tests des SQLite-Lesers der Seitenleiste: Quoting, JSON und Abfragen.
//   node --test mods/fabric-sidebar/test/

import test from "node:test";
import assert from "node:assert/strict";

import { createReader, parseRows, sqlQuote } from "../db.js";

test("sqlQuote verdoppelt einfache Anführungszeichen", () => {
  assert.equal(sqlQuote("index"), "'index'");
  assert.equal(sqlQuote("O'Brien"), "'O''Brien'");
  assert.equal(sqlQuote(null), "''");
});

test("parseRows: leere Ausgabe sind keine Zeilen, sonst ein Array", () => {
  assert.deepEqual(parseRows(""), []);
  assert.deepEqual(parseRows('[{"value":"3"}]'), [{ value: "3" }]);
  assert.throws(() => parseRows('{"value":"3"}'), /kein JSON-Array/);
});

test("createReader liest Index und rev über sqlite3 -json mit query_only", async () => {
  const calls = [];
  const db = createReader(async (command, args) => {
    calls.push({ command, args });
    if (args[3].includes("FROM read_models")) {
      return { code: 0, stdout: '[{"value":"{\\"tickets\\":[]}"}]' };
    }
    return { code: 0, stdout: '[{"value":"4"}]' };
  });

  assert.equal(await db.readModel("/x/fabric.db", "index"), '{"tickets":[]}');
  assert.equal(await db.metaValue("/x/fabric.db", "rev"), "4");
  assert.equal(calls[0].command, "/usr/bin/sqlite3");
  assert.deepEqual(calls[0].args.slice(0, 6), ["-json", "-cmd", ".timeout 3000", "-cmd", "PRAGMA query_only=ON", "/x/fabric.db"]);
  assert.match(calls[0].args[3], /WHERE key = 'index'/);
});

test("createReader meldet sqlite3-Fehler", async () => {
  const db = createReader(async () => ({ code: 1, stdout: "", stderr: "busy" }));
  await assert.rejects(() => db.readModel("/x/fabric.db", "index"), /busy/);
  const empty = createReader(async () => ({ code: 0, stdout: "" }));
  assert.equal(await empty.metaValue("/x/fabric.db", "rev"), null);
});
