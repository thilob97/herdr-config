// Lesezugriff auf fabric.db. Die Seitenleiste liest nur die fertigen Modelle
// (`read_models`) und den Änderungszähler (`meta.rev`); geschrieben wird
// ausschließlich in `fab`. `/usr/bin/sqlite3` läuft mit `-readonly -json` und
// liefert ein JSON-Array, bei leerem Ergebnis nichts. Reine Teile bleiben ohne
// "herdr"-Import testbar.

export const SQLITE = "/usr/bin/sqlite3";

/** SQL-Stringliteral; nur so gebaute Werte dürfen in Abfragen stehen. */
export function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/** Ausgabe von `sqlite3 -json`: leer = keine Zeilen, sonst ein JSON-Array. */
export function parseRows(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("sqlite3 lieferte kein JSON-Array.");
  return rows;
}

/** Bindet die sqlite3-Aufrufe an `run` (herdrs `exec`) und liefert die Leser. */
export function createReader(run) {
  async function queryJson(dbPath, sql) {
    const result = await run(SQLITE, ["-readonly", "-json", dbPath, sql]);
    const code = Number(result?.code ?? 0);
    if (code !== 0) {
      const detail = String(result?.stderr ?? "").trim();
      throw new Error(detail || `sqlite3 endete mit Code ${code}.`);
    }
    return parseRows(result?.stdout);
  }

  async function one(dbPath, sql) {
    const rows = await queryJson(dbPath, sql);
    return rows.length ? rows[0].value ?? null : null;
  }

  /** Ein fertiges Lesemodell (`index`, `ticket:T-12`); null, wenn es fehlt. */
  function readModel(dbPath, key) {
    return one(dbPath, `SELECT value FROM read_models WHERE key = ${sqlQuote(key)}`);
  }

  /** Ein Wert aus `meta` (`rev`, `autopilot`, `tick_off`). */
  function metaValue(dbPath, key) {
    return one(dbPath, `SELECT value FROM meta WHERE key = ${sqlQuote(key)}`);
  }

  return { queryJson, readModel, metaValue };
}
