const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('./db');
const auth    = require('./middleware/auth');
const cfg     = require('./config');
const router  = express.Router();

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === cfg.DOCTOR_USERNAME && password === cfg.DOCTOR_PASSWORD) {
    const token = jwt.sign({ username }, cfg.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid username or password.' });
});

// ── PATIENTS ──────────────────────────────────────────────────────────────────
router.get('/patients', auth, (req, res) => {
  try {
    const { search } = req.query;
    const rows = search
      ? db.all('SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? ORDER BY name', [`%${search}%`, `%${search}%`])
      : db.all('SELECT * FROM patients ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/patients/:id', auth, (req, res) => {
  try {
    const patient = db.get('SELECT * FROM patients WHERE id=?', [req.params.id]);
    if (!patient) return res.status(404).json({ error: 'Not found' });
    const visits = db.all('SELECT * FROM visits WHERE patient_id=? ORDER BY visit_date DESC', [req.params.id]);
    visits.forEach(v => {
      v.items = db.all('SELECT * FROM prescription_items WHERE visit_id=?', [v.id]);
    });
    res.json({ ...patient, visits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/patients', auth, (req, res) => {
  const { name, age, gender, phone, address, blood_group, medical_history } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required.' });
  try {
    db.run('INSERT INTO patients (name,age,gender,phone,address,blood_group,medical_history) VALUES (?,?,?,?,?,?,?)',
      [name, age||null, gender||null, phone, address||null, blood_group||null, medical_history||null]);
    const id = db.lastId();
    db.run('UPDATE patients SET patient_code=? WHERE id=?', [`JIV-${String(id).padStart(6, '0')}`, id]);
    const patient = db.get('SELECT * FROM patients WHERE id=?', [id]);
    res.status(201).json(patient);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Phone already registered.' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/patients/:id', auth, (req, res) => {
  const { name, age, gender, phone, address, blood_group, medical_history } = req.body;
  try {
    db.run("UPDATE patients SET name=?,age=?,gender=?,phone=?,address=?,blood_group=?,medical_history=?,updated_at=datetime('now','localtime') WHERE id=?",
      [name, age||null, gender||null, phone, address||null, blood_group||null, medical_history||null, req.params.id]);
    res.json(db.get('SELECT * FROM patients WHERE id=?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/patients/:id', auth, (req, res) => {
  try {
    db.run('DELETE FROM visits WHERE patient_id=?', [req.params.id]);
    db.run('DELETE FROM patients WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VISITS ────────────────────────────────────────────────────────────────────
router.get('/visits', auth, (req, res) => {
  try {
    const visits = db.all('SELECT v.*,p.name as patient_name,p.phone as patient_phone FROM visits v JOIN patients p ON v.patient_id=p.id ORDER BY v.visit_date DESC LIMIT 50');
    visits.forEach(v => { v.items = db.all('SELECT * FROM prescription_items WHERE visit_id=?', [v.id]); });
    res.json(visits);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/visits', auth, (req, res) => {
  const { patient_id, visit_date, complaints, diagnosis, notes, consultation_fee, followup_required, prescription_items } = req.body;
  if (!patient_id) return res.status(400).json({ error: 'Patient required.' });
  try {
    const fdate = followup_required
      ? new Date(new Date(visit_date||Date.now()).getTime()+7*864e5).toISOString().split('T')[0]
      : null;
    const vdate = visit_date || new Date().toISOString().split('T')[0];

    const patient = db.get('SELECT name FROM patients WHERE id=?', [patient_id]);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    // Resolve inventory medicines before writing anything. A medicine sale is only
    // created for items that are actually supplied from this clinic's inventory.
    const items = [];
    const requestedByMedicine = new Map();
    for (const item of (prescription_items || [])) {
      const suppliedName = String(item.medicine_name || '').trim();
      let medicine = item.medicine_id ? db.get('SELECT * FROM medicines WHERE id=?', [item.medicine_id]) : null;
      if (!medicine && suppliedName) medicine = db.get('SELECT * FROM medicines WHERE lower(name)=lower(?)', [suppliedName]);
      const quantity = Math.max(0, Math.floor(Number(item.quantity_given) || 0));
      const medicineName = medicine?.name || suppliedName;
      if (!medicineName) continue;
      if (medicine && quantity > 0)
        requestedByMedicine.set(medicine.id, (requestedByMedicine.get(medicine.id) || 0) + quantity);
      items.push({ item, medicine, quantity, medicineName });
    }
    for (const [medicineId, quantity] of requestedByMedicine) {
      const medicine = items.find(x => x.medicine?.id === medicineId).medicine;
      if (quantity > Number(medicine.quantity || 0))
        return res.status(400).json({ error: `Only ${medicine.quantity} unit(s) of ${medicine.name} are in stock.` });
    }

    db.run('INSERT INTO visits (patient_id,visit_date,complaints,diagnosis,notes,consultation_fee,followup_required,followup_date) VALUES (?,?,?,?,?,?,?,?)',
      [patient_id, vdate, complaints||null, diagnosis||null, notes||null, consultation_fee||0, followup_required?1:0, fdate]);
    const vid = db.lastId();

    // MRD: belongs to the PATIENT, assigned once on their first-ever visit —
    // formatted with that first visit's year-month, sequential among MRDs
    // first issued that same month — then reused unchanged on every visit
    // after that, regardless of when those later visits happen.
    let patientRow = db.get('SELECT mrd_number FROM patients WHERE id=?', [patient_id]);
    let mrdNumber = patientRow?.mrd_number;
    if (!mrdNumber) {
      const monthPrefix = `MRD-${vdate.slice(0, 7).replace('-', '')}-`;
      const monthMrds = db.all('SELECT mrd_number FROM patients WHERE mrd_number LIKE ?', [`${monthPrefix}%`]);
      const nextSeq = monthMrds.reduce((max, r) => {
        const n = parseInt(String(r.mrd_number).slice(monthPrefix.length), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0) + 1;
      mrdNumber = `${monthPrefix}${String(nextSeq).padStart(4, '0')}`;
      db.run('UPDATE patients SET mrd_number=? WHERE id=?', [mrdNumber, patient_id]);
    }

    // visit_seq: this visit's place in the queue for its calendar month —
    // 1, 2, 3... shared across every patient, resetting to 1 each month.
    const monthStart = `${vdate.slice(0, 7)}-01`, monthEnd = `${vdate.slice(0, 7)}-31`;
    const seqRow = db.get('SELECT MAX(visit_seq) as m FROM visits WHERE visit_date BETWEEN ? AND ?', [monthStart, monthEnd]);
    const visitSeq = (seqRow?.m || 0) + 1;

    db.run('UPDATE visits SET mrd_number=?,visit_seq=? WHERE id=?', [mrdNumber, visitSeq, vid]);
    let medicineSalesTotal = 0;
    const soldItems = [];

    for (const { item, medicine, quantity, medicineName } of items) {
      const unitPrice = medicine ? Number(medicine.selling_price || 0) : 0;
      const lineTotal = medicine && quantity > 0 ? unitPrice * quantity : 0;
      db.run('INSERT INTO prescription_items (visit_id,medicine_id,medicine_name,dosage,frequency,duration,quantity_given,selling_price,line_total) VALUES (?,?,?,?,?,?,?,?,?)',
        [vid, medicine?.id||null, medicineName, item.dosage||null, item.frequency||null, item.duration||null, quantity, unitPrice, lineTotal]);
      if (medicine && quantity > 0) {
        db.run('UPDATE medicines SET quantity=quantity-? WHERE id=?', [quantity, medicine.id]);
        medicineSalesTotal += lineTotal;
        soldItems.push(`${medicine.name} × ${quantity}`);
      }
    }

    if (consultation_fee > 0)
      db.run("INSERT INTO expenses (type,category,amount,description,expense_date,visit_id) VALUES ('income','Consultation',?,?,?,?)",
        [consultation_fee, `Consultation - ${patient.name}`, vdate, vid]);
    if (medicineSalesTotal > 0)
      db.run("INSERT INTO expenses (type,category,amount,description,expense_date,visit_id) VALUES ('income','Medicine Sales',?,?,?,?)",
        [medicineSalesTotal, `Medicine sale - ${patient.name}: ${soldItems.join(', ')}`, vdate, vid]);

    res.status(201).json(db.get('SELECT * FROM visits WHERE id=?', [vid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/visits/:id', auth, (req, res) => {
  try {
    const items = db.all('SELECT medicine_id,quantity_given FROM prescription_items WHERE visit_id=? AND medicine_id IS NOT NULL', [req.params.id]);
    items.forEach(item => db.run('UPDATE medicines SET quantity=quantity+? WHERE id=?', [item.quantity_given, item.medicine_id]));
    db.run('DELETE FROM expenses WHERE visit_id=?', [req.params.id]);
    db.run('DELETE FROM prescription_items WHERE visit_id=?', [req.params.id]);
    db.run('DELETE FROM visits WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return medicine against its original prescription, never as new stock.
router.post('/prescription-items/:id/return', auth, (req, res) => {
  const quantity = Math.floor(Number(req.body.quantity) || 0);
  if (quantity <= 0) return res.status(400).json({ error: 'Return quantity must be at least 1.' });
  try {
    const item = db.get('SELECT * FROM prescription_items WHERE id=?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Prescription medicine not found.' });
    if (!item.medicine_id) return res.status(400).json({ error: 'This medicine was not supplied from inventory.' });
    const available = Number(item.quantity_given || 0) - Number(item.quantity_returned || 0);
    if (quantity > available) return res.status(400).json({ error: `Only ${available} unit(s) can be returned.` });
    db.run('UPDATE prescription_items SET quantity_returned=quantity_returned+? WHERE id=?', [quantity, item.id]);
    db.run('UPDATE medicines SET quantity=quantity+? WHERE id=?', [quantity, item.medicine_id]);
    const refund = quantity * Number(item.selling_price || 0);
    const sale = db.get("SELECT * FROM expenses WHERE visit_id=? AND type='income' AND category='Medicine Sales' ORDER BY id DESC LIMIT 1", [item.visit_id]);
    if (sale && refund > 0) {
      const newAmount = Math.max(0, Number(sale.amount) - refund);
      if (newAmount === 0) db.run('DELETE FROM expenses WHERE id=?', [sale.id]);
      else db.run('UPDATE expenses SET amount=?, description=? WHERE id=?', [newAmount, `${sale.description} (return: ${item.medicine_name} × ${quantity})`, sale.id]);
    }
    res.json({ ok: true, returned: quantity, refund, remaining: available - quantity });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MEDICINES ─────────────────────────────────────────────────────────────────
router.get('/medicines', auth, (req, res) => {
  try {
    const { search, expiring, low_stock } = req.query;
    let q = 'SELECT * FROM medicines WHERE 1=1', p = [];
    if (search)          { q += ' AND (name LIKE ? OR brand LIKE ?)'; p.push(`%${search}%`,`%${search}%`); }
    if (expiring==='true') q += " AND expiry_date <= date('now','+30 days') AND expiry_date >= date('now')";
    if (low_stock==='true') q += ' AND quantity <= low_stock_threshold';
    res.json(db.all(q + ' ORDER BY expiry_date ASC', p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/medicines/alerts', auth, (req, res) => {
  try {
    res.json({
      expiring:     db.all("SELECT * FROM medicines WHERE expiry_date <= date('now','+30 days') AND expiry_date >= date('now') ORDER BY expiry_date"),
      expired:      db.all("SELECT * FROM medicines WHERE expiry_date < date('now')"),
      low_stock:    db.all('SELECT * FROM medicines WHERE quantity <= low_stock_threshold AND quantity > 0'),
      out_of_stock: db.all('SELECT * FROM medicines WHERE quantity = 0'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/medicines', auth, (req, res) => {
  const { name, brand, category, quantity, low_stock_threshold, expiry_date, purchase_price, selling_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required.' });
  try {
    db.run('INSERT INTO medicines (name,brand,category,quantity,low_stock_threshold,expiry_date,purchase_price,selling_price) VALUES (?,?,?,?,?,?,?,?)',
      [name, brand||null, category||null, quantity||0, low_stock_threshold||10, expiry_date||null, purchase_price||0, selling_price||0]);
    const id = db.lastId();
    if (purchase_price > 0 && quantity > 0)
      db.run("INSERT INTO expenses (type,category,amount,description) VALUES ('expense','Medicine Purchase',?,?)",
        [purchase_price*quantity, `Purchased ${quantity} units of ${name}`]);
    res.status(201).json(db.get('SELECT * FROM medicines WHERE id=?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/medicines/:id', auth, (req, res) => {
  const { name, brand, category, quantity, low_stock_threshold, expiry_date, purchase_price, selling_price } = req.body;
  try {
    db.run("UPDATE medicines SET name=?,brand=?,category=?,quantity=?,low_stock_threshold=?,expiry_date=?,purchase_price=?,selling_price=?,updated_at=datetime('now','localtime') WHERE id=?",
      [name, brand||null, category||null, quantity, low_stock_threshold||10, expiry_date||null, purchase_price||0, selling_price||0, req.params.id]);
    res.json(db.get('SELECT * FROM medicines WHERE id=?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/medicines/:id', auth, (req, res) => {
  try { db.run('DELETE FROM medicines WHERE id=?', [req.params.id]); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EXPENSES ──────────────────────────────────────────────────────────────────
router.get('/expenses', auth, (req, res) => {
  try {
    const { month, year, type } = req.query;
    let q = 'SELECT * FROM expenses WHERE 1=1', p = [];
    if (month && year) { q += " AND strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=?"; p.push(String(month).padStart(2,'0'), String(year)); }
    else if (year)     { q += " AND strftime('%Y',expense_date)=?"; p.push(String(year)); }
    if (type)          { q += ' AND type=?'; p.push(type); }
    res.json(db.all(q + ' ORDER BY expense_date DESC', p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/expenses/summary', auth, (req, res) => {
  try {
    const m = String(req.query.month||new Date().getMonth()+1).padStart(2,'0');
    const y = String(req.query.year||new Date().getFullYear());
    const today = new Date().toISOString().split('T')[0];

    const rows  = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=? GROUP BY type", [m, y]);
    const trend = db.all("SELECT strftime('%m',expense_date) as month,strftime('%Y',expense_date) as year,SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY month,year ORDER BY year,month", [y]);

    // Daily income (specific date or today)
    const selectedDate = req.query.date || today;
    const dailyRows = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE expense_date=? GROUP BY type", [selectedDate]);
    const daily = {income:0, expense:0};
    dailyRows.forEach(r => { daily[r.type] = Number(r.total)||0; });

    // Yearly income
    const yearlyRows = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY type", [y]);
    const yearly = {income:0, expense:0};
    yearlyRows.forEach(r => { yearly[r.type] = Number(r.total)||0; });

    // Monthly breakdown for current year (all months)
    const allMonths = db.all("SELECT strftime('%m',expense_date) as month, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY month ORDER BY month", [y]);

    // Top income categories this month
    const topCategories = db.all("SELECT category, SUM(amount) as total FROM expenses WHERE type='income' AND strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=? GROUP BY category ORDER BY total DESC LIMIT 5", [m, y]);

    const t = {income:0, expense:0};
    rows.forEach(r => { t[r.type] = Number(r.total)||0; });

    res.json({
      month:m, year:y,
      income:t.income, expense:t.expense, profit:t.income-t.expense,
      monthly_trend: trend,
      daily_income:   daily.income,
      daily_expense:  daily.expense,
      daily_profit:   daily.income - daily.expense,
      yearly_income:  yearly.income,
      yearly_expense: yearly.expense,
      yearly_profit:  yearly.income - yearly.expense,
      all_months:     allMonths,
      top_categories: topCategories,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/expenses', auth, (req, res) => {
  const { type, category, amount, description, expense_date } = req.body;
  if (!type||!amount) return res.status(400).json({ error: 'Type and amount required.' });
  try {
    db.run('INSERT INTO expenses (type,category,amount,description,expense_date) VALUES (?,?,?,?,?)',
      [type, category||null, amount, description||null, expense_date||new Date().toISOString().split('T')[0]]);
    res.status(201).json(db.get('SELECT * FROM expenses WHERE id=?', [db.lastId()]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/expenses/:id', auth, (req, res) => {
  try { db.run('DELETE FROM expenses WHERE id=?', [req.params.id]); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/dashboard', auth, (req, res) => {
  try {
    const finance = db.get("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%m',expense_date)=strftime('%m','now') AND strftime('%Y',expense_date)=strftime('%Y','now')");
    res.json({
      today_visits:        db.get("SELECT COUNT(*) as c FROM visits WHERE visit_date=date('now','localtime')").c,
      total_patients:      db.get('SELECT COUNT(*) as c FROM patients').c,
      expiring_medicines:  db.get("SELECT COUNT(*) as c FROM medicines WHERE expiry_date<=date('now','+30 days') AND expiry_date>=date('now')").c,
      low_stock_medicines: db.get('SELECT COUNT(*) as c FROM medicines WHERE quantity<=low_stock_threshold').c,
      monthly_income:      finance?.income||0,
      monthly_expense:     finance?.expense||0,
      monthly_profit:      (finance?.income||0)-(finance?.expense||0),
      pending_followups:   db.all("SELECT v.*,p.name as patient_name,p.phone as patient_phone FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.followup_required=1 AND v.followup_sent=0 AND v.followup_date<=date('now','localtime') ORDER BY v.followup_date ASC LIMIT 10"),
      recent_visits:       db.all('SELECT v.id,v.visit_date,v.diagnosis,v.consultation_fee,v.patient_id,p.name as patient_name FROM visits v JOIN patients p ON v.patient_id=p.id ORDER BY v.created_at DESC LIMIT 5'),
      expiring_list:       db.all("SELECT * FROM medicines WHERE expiry_date<=date('now','+30 days') AND expiry_date>=date('now') ORDER BY expiry_date LIMIT 5"),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FOLLOW-UPS ────────────────────────────────────────────────────────────────
router.get('/followups/pending', auth, (req, res) => {
  try {
    res.json(db.all("SELECT v.*,p.name as patient_name,p.phone as patient_phone FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.followup_required=1 AND v.followup_sent=0 ORDER BY v.followup_date ASC"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/followups/send/:visitId', auth, async (req, res) => {
  try {
    const visit = db.get("SELECT v.*,p.name as patient_name,p.phone as patient_phone FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.id=?", [req.params.visitId]);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    await sendFollowup(visit);
    db.run('UPDATE visits SET followup_sent=1 WHERE id=?', [req.params.visitId]);
    res.json({ message: `Follow-up sent to ${visit.patient_name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enable, reschedule, or turn off a reminder on an existing consultation.
// (Previously the only way to set followup_required/followup_date was at
// the moment a visit was first created — there was no way to add or edit a
// reminder afterwards.)
router.put('/visits/:id/followup', auth, (req, res) => {
  const { followup_required, followup_date } = req.body;
  try {
    const visit = db.get('SELECT * FROM visits WHERE id=?', [req.params.id]);
    if (!visit) return res.status(404).json({ error: 'Visit not found.' });
    const required = followup_required ? 1 : 0;
    const date = required
      ? (followup_date || new Date(new Date(visit.visit_date).getTime() + 7 * 864e5).toISOString().split('T')[0])
      : null;
    db.run('UPDATE visits SET followup_required=?,followup_date=?,followup_sent=0 WHERE id=?', [required, date, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark a reminder as done without actually sending a WhatsApp/SMS message —
// useful when the doctor called the patient directly, or Twilio isn't set up.
router.post('/followups/complete/:visitId', auth, (req, res) => {
  try {
    db.run('UPDATE visits SET followup_sent=1 WHERE id=?', [req.params.visitId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function sendFollowup(visit) {
  if (!cfg.TWILIO_SID || !cfg.TWILIO_TOKEN) throw new Error('Twilio not configured in config.js');
  const twilio = require('twilio')(cfg.TWILIO_SID, cfg.TWILIO_TOKEN);
  const msg = `Dear ${visit.patient_name}, this is a reminder from your doctor's clinic. It has been 7 days since your visit on ${new Date(visit.visit_date).toLocaleDateString('en-IN')}. Please schedule a follow-up if needed. Contact: ${cfg.CLINIC_PHONE}.`;
  const to  = `+91${visit.patient_phone.replace(/\D/g,'').slice(-10)}`;
  try {
    await twilio.messages.create({ from: cfg.TWILIO_WA_FROM, to: `whatsapp:${to}`, body: msg });
  } catch {
    await twilio.messages.create({ from: cfg.TWILIO_SMS_FROM, to, body: msg });
  }
}

// ── SUVARNAPRASHAN ────────────────────────────────────────────────────────────
// A child registers once (sp_children) and keeps returning monthly until ~5-6
// years old; every visit is a "dose" (sp_doses) linked to that one profile —
// never a fresh, disconnected record.

function spChildWithStats(child) {
  const doses = db.all('SELECT * FROM sp_doses WHERE child_id=? ORDER BY dose_date DESC', [child.id]);
  child.doses = doses;
  child.dose_count = doses.length;
  child.last_dose_date = doses[0]?.dose_date || null;
  child.total_paid = doses.reduce((s, d) => s + Number(d.amount || 0), 0);
  return child;
}

// List / search child profiles (used for the main table and for autocomplete
// when reception is deciding whether a kid is already registered).
router.get('/suvarnaprashan/children', auth, (req, res) => {
  try {
    const { search, status } = req.query;
    let rows = search
      ? db.all('SELECT * FROM sp_children WHERE name LIKE ? OR phone LIKE ? ORDER BY name', [`%${search}%`, `%${search}%`])
      : db.all('SELECT * FROM sp_children ORDER BY created_at DESC');
    if (status) rows = rows.filter(c => c.status === status);
    res.json(rows.map(spChildWithStats));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/suvarnaprashan/children/:id', auth, (req, res) => {
  try {
    const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
    if (!child) return res.status(404).json({ error: 'Not found' });
    res.json(spChildWithStats(child));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register a new child. Optionally record their first dose in the same call.
router.post('/suvarnaprashan/children', auth, (req, res) => {
  const { name, dob, age_at_registration, parent_name, phone, notes, first_dose_date, first_dose_amount } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Child name and phone required.' });
  try {
    const id = `spc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const regDate = first_dose_date || new Date().toISOString().split('T')[0];
    db.run('INSERT INTO sp_children (id,name,dob,age_at_registration,registration_date,parent_name,phone,notes) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, dob || null, age_at_registration || null, regDate, parent_name || null, phone, notes || null]);
    if (first_dose_date) {
      const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount) VALUES (?,?,?,?)',
        [doseId, id, first_dose_date, first_dose_amount || 0]);
      if (first_dose_amount > 0) {
        db.run("INSERT INTO expenses (type,category,amount,description,expense_date) VALUES ('income','सुवर्णप्राशन',?,?,?)",
          [first_dose_amount, `सुवर्णप्राशन — ${name}`, first_dose_date]);
      }
    }
    res.status(201).json(spChildWithStats(db.get('SELECT * FROM sp_children WHERE id=?', [id])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/suvarnaprashan/children/:id', auth, (req, res) => {
  const { name, dob, age_at_registration, parent_name, phone, status, notes } = req.body;
  try {
    db.run(`UPDATE sp_children SET name=?,dob=?,age_at_registration=?,parent_name=?,phone=?,status=?,notes=?,
            updated_at=datetime('now','localtime') WHERE id=?`,
      [name, dob || null, age_at_registration || null, parent_name || null, phone, status || 'active', notes || null, req.params.id]);
    const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
    if (!child) return res.status(404).json({ error: 'Not found' });
    res.json(spChildWithStats(child));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/suvarnaprashan/children/:id', auth, (req, res) => {
  try {
    db.run('DELETE FROM sp_doses WHERE child_id=?', [req.params.id]);
    db.run('DELETE FROM sp_children WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add a single dose (one monthly visit) to an existing child's history.
router.post('/suvarnaprashan/children/:id/doses', auth, (req, res) => {
  const { dose_date, amount, notes } = req.body;
  if (!dose_date) return res.status(400).json({ error: 'Dose date required.' });
  try {
    const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
    if (!child) return res.status(404).json({ error: 'Child not found.' });
    const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount,notes) VALUES (?,?,?,?,?)',
      [doseId, req.params.id, dose_date, amount || 0, notes || null]);
    if (amount > 0) {
      db.run("INSERT INTO expenses (type,category,amount,description,expense_date) VALUES ('income','सुवर्णप्राशन',?,?,?)",
        [amount, `सुवर्णप्राशन — ${child.name}`, dose_date]);
    }
    res.status(201).json(spChildWithStats(db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Record the clinic's monthly Suvarnaprashan day in one go: one date, several
// already-registered children, one amount each.
router.post('/suvarnaprashan/doses/bulk', auth, (req, res) => {
  const { dose_date, entries } = req.body; // entries: [{ child_id, amount, notes }]
  if (!dose_date || !Array.isArray(entries) || !entries.length)
    return res.status(400).json({ error: 'Dose date and at least one child are required.' });
  try {
    const created = [];
    for (const entry of entries) {
      const child = db.get('SELECT * FROM sp_children WHERE id=?', [entry.child_id]);
      if (!child) continue;
      const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${created.length}`;
      db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount,notes) VALUES (?,?,?,?,?)',
        [doseId, child.id, dose_date, entry.amount || 0, entry.notes || null]);
      if (entry.amount > 0) {
        db.run("INSERT INTO expenses (type,category,amount,description,expense_date) VALUES ('income','सुवर्णप्राशन',?,?,?)",
          [entry.amount, `सुवर्णप्राशन — ${child.name}`, dose_date]);
      }
      created.push(doseId);
    }
    res.status(201).json({ ok: true, created: created.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/suvarnaprashan/doses/:id', auth, (req, res) => {
  const { dose_date, amount, notes } = req.body;
  try {
    db.run('UPDATE sp_doses SET dose_date=?,amount=?,notes=? WHERE id=?',
      [dose_date, amount || 0, notes || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/suvarnaprashan/doses/:id', auth, (req, res) => {
  try { db.run('DELETE FROM sp_doses WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PANCHAKARMA ───────────────────────────────────────────────────────────────
router.get('/panchakarma', auth, (req, res) => {
  try {
    const courses = db.all('SELECT * FROM pk_courses ORDER BY start_date DESC');
    courses.forEach(c => {
      c.therapies = JSON.parse(c.therapies || '[]');
      c.days = db.all('SELECT * FROM pk_days WHERE course_id=? ORDER BY day_number ASC', [c.id]);
    });
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/panchakarma/course', auth, (req, res) => {
  const { id, patient_name, phone, linked_patient_id, therapies, start_date, total_days, status } = req.body;
  if (!patient_name || !phone) return res.status(400).json({ error: 'Patient name and phone required.' });
  try {
    db.run('INSERT OR REPLACE INTO pk_courses (id,patient_name,phone,linked_patient_id,therapies,start_date,total_days,status) VALUES (?,?,?,?,?,?,?,?)',
      [id || `pk${Date.now()}`, patient_name, phone, linked_patient_id||null, JSON.stringify(therapies||[]), start_date, total_days||7, status||'active']);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/panchakarma/course/:id', auth, (req, res) => {
  const { patient_name, phone, linked_patient_id, therapies, start_date, total_days, status } = req.body;
  try {
    db.run('UPDATE pk_courses SET patient_name=?,phone=?,linked_patient_id=?,therapies=?,start_date=?,total_days=?,status=? WHERE id=?',
      [patient_name, phone, linked_patient_id||null, JSON.stringify(therapies||[]), start_date, total_days||7, status||'active', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/panchakarma/course/:id', auth, (req, res) => {
  try {
    db.run('DELETE FROM pk_days WHERE course_id=?', [req.params.id]);
    db.run('DELETE FROM pk_courses WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/panchakarma/day', auth, (req, res) => {
  const { id, course_id, day_number, date, therapy, payment, notes, done } = req.body;
  try {
    const dayId = id || `pkd${Date.now()}`;
    db.run('INSERT OR REPLACE INTO pk_days (id,course_id,day_number,date,therapy,payment,notes,done) VALUES (?,?,?,?,?,?,?,?)',
      [dayId, course_id, day_number, date, therapy, payment||0, notes||null, done?1:1]);
    // Record payment as income in Finance
    if (payment > 0) {
      const course = db.get('SELECT patient_name FROM pk_courses WHERE id=?', [course_id]);
      const patName = course ? course.patient_name : '';
      db.run("INSERT INTO expenses (type,category,amount,description,expense_date) VALUES ('income','पंचकर्म',?,?,?)",
        [payment, `पंचकर्म — ${therapy} — ${patName} (Day ${day_number})`, date || new Date().toISOString().split('T')[0]]);
    }
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/panchakarma/day/:id', auth, (req, res) => {
  const { day_number, date, therapy, payment, notes } = req.body;
  try {
    db.run('UPDATE pk_days SET day_number=?,date=?,therapy=?,payment=?,notes=? WHERE id=?',
      [day_number, date, therapy, payment||0, notes||null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/panchakarma/day/:id', auth, (req, res) => {
  try { db.run('DELETE FROM pk_days WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: RESET ALL CLINIC DATA ────────────────────────────────────────────
// A safe, single-click way to wipe every clinic record (patients, visits,
// prescriptions, finance, follow-ups, suvarnaprashan, panchakarma) instead of
// hand-editing the SQLite file — which is unreliable while the server is
// running, since sql.js keeps the DB in memory and periodically overwrites
// the file from that in-memory copy, silently reverting manual edits.
// Deletion order matters even with foreign_keys enabled, so children are
// cleared before their parents.
router.post('/admin/reset', auth, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL DATA') {
    return res.status(400).json({ error: "Type the confirmation phrase exactly: DELETE ALL DATA" });
  }
  try {
    const tables = [
      'prescription_items', 'visits', 'patients',
      'expenses',
      'sp_doses', 'sp_children', 'suvarnaprashan',
      'pk_days', 'pk_courses',
      'medicines',
    ];
    tables.forEach(t => db.run(`DELETE FROM ${t}`));
    // Reset autoincrement counters so new records start fresh from id 1.
    try { db.run("DELETE FROM sqlite_sequence"); } catch {}
    db.saveDb();
    res.json({ ok: true, cleared: tables });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.sendFollowup = sendFollowup;
