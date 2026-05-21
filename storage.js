const fs = require("node:fs");
const path = require("node:path");

function createStorage(options) {
  if (options.driver === "sqlite") return createSqliteStorage(options);
  return createJsonStorage(options);
}

function createJsonStorage({ dataDir, partyDir }) {
  const entryListDir = path.join(dataDir, "entry-lists");

  return {
    driver: "json",
    loadParty(id) {
      const filePath = path.join(partyDir, `${id}.json`);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    },
    saveParty(state) {
      fs.mkdirSync(partyDir, { recursive: true });
      fs.writeFileSync(path.join(partyDir, `${state.id}.json`), JSON.stringify(state, null, 2));
    },
    listEntryLists() {
      return listTsvFiles(entryListDir);
    },
    readEntryList(id) {
      const filePath = path.join(entryListDir, `${id}.tsv`);
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, "utf8");
    },
    writeEntryList(id, tsv) {
      fs.mkdirSync(entryListDir, { recursive: true });
      fs.writeFileSync(path.join(entryListDir, `${id}.tsv`), tsv);
    }
  };
}

function createSqliteStorage({ databaseFile, partyDir }) {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(databaseFile, { timeout: 5000 });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS entry_lists (
      id TEXT PRIMARY KEY,
      entries_tsv TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  importJsonPartiesIfEmpty(db, partyDir);

  return {
    driver: "sqlite",
    loadParty(id) {
      const row = db.prepare("SELECT state_json FROM parties WHERE id = ?").get(id);
      return row ? JSON.parse(row.state_json) : null;
    },
    saveParty(state) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO parties (id, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(state.id, JSON.stringify(state), state.createdAt || now, now);
    },
    listEntryLists() {
      return db.prepare("SELECT id FROM entry_lists ORDER BY id DESC").all().map((row) => row.id);
    },
    readEntryList(id) {
      const row = db.prepare("SELECT entries_tsv FROM entry_lists WHERE id = ?").get(id);
      return row?.entries_tsv || null;
    },
    writeEntryList(id, tsv) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO entry_lists (id, entries_tsv, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entries_tsv = excluded.entries_tsv,
          updated_at = excluded.updated_at
      `).run(id, tsv, now, now);
    }
  };
}

function importJsonPartiesIfEmpty(db, partyDir) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM parties").get();
  if (count || !fs.existsSync(partyDir)) return;

  for (const file of fs.readdirSync(partyDir)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const filePath = path.join(partyDir, file);
    try {
      const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const id = path.basename(file, ".json").toLowerCase();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO parties (id, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(id, JSON.stringify({ ...state, id }), state.createdAt || now, now);
    } catch (error) {
      console.warn(`Skipping invalid party backup ${filePath}: ${error.message}`);
    }
  }
}

function listTsvFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.toLowerCase().endsWith(".tsv"))
      .map((file) => path.basename(file, ".tsv"));
  } catch {
    return [];
  }
}

module.exports = { createStorage };
