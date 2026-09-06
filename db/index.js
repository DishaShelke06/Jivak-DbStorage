const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const DB_PATH = cfg.DB_PATH;
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db;

// Save DB to disk
function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-save every 10 seconds
setInterval(save, 10000);

// Save on exit
process.on('exit', save);
process.on('SIGINT', () => { save(); process.exit(); });

function getDb() { return db; }
function saveDb() { save(); }

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('Database loaded from:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('New database created at:', DB_PATH);
  }

  // SQLite has foreign keys OFF by default. Without this, every
  // "ON DELETE CASCADE" in the schema below is silently ignored —
  // deleting a patient would leave their visits/prescriptions/expenses
  // behind as orphaned rows instead of cleaning them up.
  db.run('PRAGMA foreign_keys = ON;');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      phone TEXT UNIQUE NOT NULL,
      address TEXT,
      blood_group TEXT,
      medical_history TEXT,
      patient_code TEXT UNIQUE,
      mrd_number TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      quantity INTEGER DEFAULT 0,
      low_stock_threshold INTEGER DEFAULT 10,
      expiry_date TEXT,
      purchase_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
      visit_date TEXT DEFAULT (date('now','localtime')),
      complaints TEXT,
      diagnosis TEXT,
      notes TEXT,
      consultation_fee REAL DEFAULT 0,
      bp TEXT,
      bsl TEXT,
      temp TEXT,
      weight TEXT,
      followup_required INTEGER DEFAULT 0,
      followup_sent INTEGER DEFAULT 0,
      followup_date TEXT,
      mrd_number TEXT,
      visit_seq INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    -- Add vitals columns if they don't exist (for existing DBs)
    CREATE TABLE IF NOT EXISTS _dummy_vitals_check (x);

    CREATE TABLE IF NOT EXISTS prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
      medicine_id INTEGER REFERENCES medicines(id),
      medicine_name TEXT,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      quantity_given INTEGER DEFAULT 0,
      quantity_returned INTEGER DEFAULT 0,
      selling_price REAL DEFAULT 0,
      line_total REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT,
      amount REAL NOT NULL,
      description TEXT,
      expense_date TEXT DEFAULT (date('now','localtime')),
      visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS suvarnaprashan (
      id TEXT PRIMARY KEY,
      child_name TEXT NOT NULL,
      child_age INTEGER,
      parent_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- A child registers once and keeps coming back monthly until ~5-6 years old.
    -- One profile per child; every monthly visit is a "dose" linked to that profile.
    CREATE TABLE IF NOT EXISTS sp_children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dob TEXT,
      age_at_registration INTEGER,
      registration_date TEXT,
      parent_name TEXT,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sp_doses (
      id TEXT PRIMARY KEY,
      child_id TEXT REFERENCES sp_children(id) ON DELETE CASCADE,
      dose_date TEXT NOT NULL,
      amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_sp_children_phone ON sp_children(phone);
    CREATE INDEX IF NOT EXISTS idx_sp_children_name  ON sp_children(name);
    CREATE INDEX IF NOT EXISTS idx_sp_children_status ON sp_children(status);
    CREATE INDEX IF NOT EXISTS idx_sp_doses_child ON sp_doses(child_id);
    CREATE INDEX IF NOT EXISTS idx_sp_doses_date  ON sp_doses(dose_date);

    CREATE TABLE IF NOT EXISTS pk_courses (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      linked_patient_id TEXT,
      therapies TEXT NOT NULL,
      start_date TEXT NOT NULL,
      total_days INTEGER DEFAULT 7,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS pk_days (
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES pk_courses(id) ON DELETE CASCADE,
      day_number INTEGER,
      date TEXT,
      therapy TEXT,
      payment REAL DEFAULT 0,
      notes TEXT,
      done INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_sp_date   ON suvarnaprashan(visit_date);
    CREATE INDEX IF NOT EXISTS idx_sp_phone  ON suvarnaprashan(phone);
    CREATE INDEX IF NOT EXISTS idx_pk_status ON pk_courses(status);
    CREATE INDEX IF NOT EXISTS idx_pk_days   ON pk_days(course_id);

    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(name);
    CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
    CREATE INDEX IF NOT EXISTS idx_visits_date    ON visits(visit_date);
    CREATE INDEX IF NOT EXISTS idx_medicines_exp  ON medicines(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_date  ON expenses(expense_date);
  `);

  // Add vitals columns to existing databases (safe — ignored if already exist)
  try { db.run('ALTER TABLE visits ADD COLUMN bp TEXT'); } catch {}
  try { db.run('ALTER TABLE visits ADD COLUMN bsl TEXT'); } catch {}
  try { db.run('ALTER TABLE visits ADD COLUMN temp TEXT'); } catch {}
  try { db.run('ALTER TABLE visits ADD COLUMN weight TEXT'); } catch {}
  // Preserve the price charged and link generated finance rows for existing databases.
  try { db.run('ALTER TABLE prescription_items ADD COLUMN selling_price REAL DEFAULT 0'); } catch {}
  try { db.run('ALTER TABLE prescription_items ADD COLUMN line_total REAL DEFAULT 0'); } catch {}
  try { db.run('ALTER TABLE prescription_items ADD COLUMN quantity_returned INTEGER DEFAULT 0'); } catch {}
  try { db.run('ALTER TABLE expenses ADD COLUMN visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE'); } catch {}
  try { db.run('ALTER TABLE patients ADD COLUMN patient_code TEXT'); } catch {}
  try { db.run('ALTER TABLE patients ADD COLUMN mrd_number TEXT'); } catch {}
  try { db.run('ALTER TABLE visits ADD COLUMN mrd_number TEXT'); } catch {}
  try { db.run('ALTER TABLE visits ADD COLUMN visit_seq INTEGER'); } catch {}

  // An older version of this schema put a UNIQUE constraint on
  // visits.mrd_number, back when MRD was (incorrectly) generated fresh per
  // visit. Now MRD lives on the patient and is copied onto each of their
  // visits, so the same value legitimately repeats across many visit rows —
  // drop that old constraint so it doesn't reject repeat visits.
  try { db.run('DROP INDEX IF EXISTS idx_visits_mrd'); } catch {}

  all('SELECT id FROM patients WHERE patient_code IS NULL OR patient_code=""').forEach(p =>
    db.run('UPDATE patients SET patient_code=? WHERE id=?', [`JIV-${String(p.id).padStart(6, '0')}`, p.id]));

  // MRD: assigned once to a patient, the first time they have a visit —
  // formatted with that first visit's year-month and a sequence number
  // among patients first seen that same month — then reused, unchanged, on
  // every visit after that. Never assigned to a patient who has never
  // actually come in for a consultation.
  const mrdMonthCounters = {};
  all(`SELECT p.id, MIN(v.visit_date) as first_visit FROM patients p JOIN visits v ON v.patient_id=p.id
       WHERE p.mrd_number IS NULL OR p.mrd_number=''
       GROUP BY p.id ORDER BY first_visit ASC, p.id ASC`).forEach(p => {
    const month = String(p.first_visit || '').slice(0, 7).replace('-', '') || '000000';
    mrdMonthCounters[month] = (mrdMonthCounters[month] || 0) + 1;
    const mrd = `MRD-${month}-${String(mrdMonthCounters[month]).padStart(4, '0')}`;
    db.run('UPDATE patients SET mrd_number=? WHERE id=?', [mrd, p.id]);
  });
  // Make sure every visit's mrd_number matches its patient's permanent one
  // (repairs any older data where MRD was still being generated per-visit).
  all(`SELECT v.id, p.mrd_number FROM visits v JOIN patients p ON v.patient_id=p.id WHERE p.mrd_number IS NOT NULL`)
    .forEach(v => db.run('UPDATE visits SET mrd_number=? WHERE id=?', [v.mrd_number, v.id]));

  // visit_seq: this visit's place in the queue for the calendar month it
  // falls in — 1, 2, 3... shared across every patient, resetting to 1 at
  // the start of each new month. Backfilled here in chronological order.
  const bySeqMonth = {};
  all('SELECT id, visit_date FROM visits WHERE visit_seq IS NULL ORDER BY visit_date ASC, id ASC').forEach(v => {
    const month = String(v.visit_date || '').slice(0, 7) || 'unknown';
    bySeqMonth[month] = (bySeqMonth[month] || 0) + 1;
    db.run('UPDATE visits SET visit_seq=? WHERE id=?', [bySeqMonth[month], v.id]);
  });

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_code ON patients(patient_code)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_mrd ON patients(mrd_number) WHERE mrd_number IS NOT NULL');

  // One-time migration: fold old flat suvarnaprashan rows (one row per visit,
  // no link between a kid's repeat visits) into sp_children + sp_doses
  // (one profile per kid, doses linked to it). Old table is kept untouched
  // as an archival backup; this only runs while sp_children is still empty.
  const spChildCount = get('SELECT COUNT(*) as c FROM sp_children');
  if (spChildCount && spChildCount.c === 0) {
    const legacyRows = all('SELECT * FROM suvarnaprashan ORDER BY visit_date ASC');
    const childByKey = new Map(); // key: phone|lower(name) -> child id
    legacyRows.forEach((row, i) => {
      const key = `${String(row.phone || '').trim()}|${String(row.child_name || '').trim().toLowerCase()}`;
      let childId = childByKey.get(key);
      if (!childId) {
        childId = `spc${Date.now().toString(36)}${i}`;
        db.run(
          'INSERT INTO sp_children (id,name,age_at_registration,registration_date,parent_name,phone,status) VALUES (?,?,?,?,?,?,?)',
          [childId, row.child_name, row.child_age || null, row.visit_date, row.parent_name, row.phone, 'active']
        );
        childByKey.set(key, childId);
      }
      db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount) VALUES (?,?,?,?)',
        [`spd${Date.now().toString(36)}${i}`, childId, row.visit_date, row.amount || 0]);
    });
    if (legacyRows.length) console.log(`Migrated ${legacyRows.length} suvarnaprashan visit(s) into ${childByKey.size} child profile(s).`);
  }

  save();
  console.log('Database ready.');
}

// Helper: run a query that modifies data (INSERT/UPDATE/DELETE)
// sql.js resets last_insert_rowid() to 0 as a side effect of db.export()
// (which save() calls on every write). Since save() used to run right
// after every db.run(), any code doing INSERT -> lastId() immediately
// afterward was silently getting 0/null — capture the real id here,
// before save() has a chance to wipe it out.
let lastInsertRowId = null;
function run(sql, params = []) {
  db.run(sql, params);
  try {
    const stmt = db.prepare('SELECT last_insert_rowid() as id');
    stmt.step();
    lastInsertRowId = stmt.getAsObject().id;
    stmt.free();
  } catch { /* non-insert statements (CREATE, PRAGMA, etc.) — ignore */ }
  save();
  return db;
}

// Helper: get a single row
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Helper: get all rows
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper: get last inserted row id
function lastId() {
  return lastInsertRowId;
}

module.exports = { initDb, getDb, saveDb, run, get, all, lastId };
