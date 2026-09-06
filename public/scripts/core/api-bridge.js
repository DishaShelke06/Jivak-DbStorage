/**
 * Jivak API Bridge
 * Replaces localStorage data with real backend API calls.
 * Your original UI stays 100% unchanged.
 */

const API = (() => {
  const TOKEN_KEY = 'jivak-api-token';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    if (res.status === 401 || res.status === 403) { clearToken();}
    return res.json();
  } 

  return {
    login: (username, password) => req('POST', '/auth/login', { username, password }),
    getToken, setToken, clearToken,

    // Patients
    getPatients:  (search) => req('GET', `/patients${search ? '?search=' + encodeURIComponent(search) : ''}`),
    getPatient:   (id)     => req('GET', `/patients/${id}`),
    addPatient:   (data)   => req('POST', '/patients', data),
    updatePatient:(id, data)=> req('PUT', `/patients/${id}`, data),
    deletePatient:(id)     => req('DELETE', `/patients/${id}`),

    // Visits
    getVisits:    ()       => req('GET', '/visits'),
    addVisit:     (data)   => req('POST', '/visits', data),
    deleteVisit:  (id)     => req('DELETE', `/visits/${id}`),
    returnMedicine: (id, data) => req('POST', `/prescription-items/${id}/return`, data),

    // Medicines
    getMedicines: (params) => req('GET', '/medicines' + (params ? '?' + new URLSearchParams(params) : '')),
    getAlerts:    ()       => req('GET', '/medicines/alerts'),
    addMedicine:  (data)   => req('POST', '/medicines', data),
    updateMedicine:(id,data)=> req('PUT', `/medicines/${id}`, data),
    deleteMedicine:(id)    => req('DELETE', `/medicines/${id}`),

    // Expenses
    getExpenses:  (params) => req('GET', '/expenses' + (params ? '?' + new URLSearchParams(params) : '')),
    getSummary:   (params) => req('GET', '/expenses/summary' + (params ? '?' + new URLSearchParams(params) : '')),
    addExpense:   (data)   => req('POST', '/expenses', data),
    deleteExpense:(id)     => req('DELETE', `/expenses/${id}`),

    // Followups
    getFollowups: ()       => req('GET', '/followups/pending'),
    sendFollowup: (id)     => req('POST', `/followups/send/${id}`),

    // Dashboard
    getDashboard: ()       => req('GET', '/dashboard'),
  };
})();

// ── Override auth to use backend ──────────────────────────────────────────────
// We wait for DOM, then patch the auth system to use our API login
document.addEventListener('DOMContentLoaded', () => {
  // If already have a valid token, mark session as active
  if (API.getToken()) {
    sessionStorage.setItem('jivak-doctor-session-v1', 'true');
  }

  // Patch logout
  document.querySelector('#logoutBtn')?.addEventListener('click', () => {
    API.clearToken();
    sessionStorage.removeItem('jivak-doctor-session-v1');
  }, true);

  // Intercept login form submission
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.id === 'loginForm') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const password = document.querySelector('#loginPassword')?.value;
      const errorEl  = document.querySelector('#authError');

      try {
        const res = await API.login('doctor', password);
        if (res.token) {
          API.setToken(res.token);
          sessionStorage.setItem('jivak-doctor-session-v1', 'true');
          // Store doctor name from account if set
          const account = JSON.parse(localStorage.getItem('jivak-doctor-account-v1') || '{}');
          if (!account.name) {
            localStorage.setItem('jivak-doctor-account-v1', JSON.stringify({ name: 'Disha Shelke', passwordHash: '' }));
          }
          document.querySelector('.auth-gate')?.remove();
          document.documentElement.classList.remove('auth-pending');
          const nameEl = document.querySelector('#doctorName');
          if (nameEl) nameEl.textContent = account.name || 'Disha Shelke';
          // Trigger dashboard render
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          if (errorEl) { errorEl.textContent = res.error || 'Incorrect password.'; errorEl.classList.add('visible'); }
        }
      } catch {
        if (errorEl) { errorEl.textContent = 'Could not connect to server.'; errorEl.classList.add('visible'); }
      }
    }

    // Intercept setup form — save name locally, use API for auth
    if (form.id === 'setupForm') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const name     = document.querySelector('#setupName')?.value.trim();
      const password = document.querySelector('#setupPassword')?.value;
      const confirm  = document.querySelector('#confirmPassword')?.value;
      const errorEl  = document.querySelector('#authError');

      if (password !== confirm) {
        if (errorEl) { errorEl.textContent = 'The passwords do not match.'; errorEl.classList.add('visible'); }
        return;
      }

      // Try logging in with backend (setup just means first login)
      try {
        const res = await API.login('doctor', password);
        if (res.token) {
          API.setToken(res.token);
          sessionStorage.setItem('jivak-doctor-session-v1', 'true');
          localStorage.setItem('jivak-doctor-account-v1', JSON.stringify({ name, passwordHash: '' }));
          document.querySelector('.auth-gate')?.remove();
          document.documentElement.classList.remove('auth-pending');
          const nameEl = document.querySelector('#doctorName');
          if (nameEl) nameEl.textContent = name;
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          if (errorEl) { errorEl.textContent = 'Wrong password. Use the password set in config.js'; errorEl.classList.add('visible'); }
        }
      } catch {
        if (errorEl) { errorEl.textContent = 'Could not connect to server.'; errorEl.classList.add('visible'); }
      }
    }
  }, true);
});


// ── Patch localStorage so original scripts read from API ─────────────────────
// We do this by loading data from API once and syncing to localStorage,
// then intercepting saves to write to API instead.

const KEYS = {
  patients:  'jivak-patients-v1',
  visits:    'jivak-visits-v1',
  inventory: 'jivak-inventory-v1',
  followups: 'jivak-followups-v1',
  finance:   'jivak-finance-entries-v1',
};

// Convert backend patient to original format
function toLocalPatient(p) {
  return {
    id: String(p.id),
    patientCode: p.patient_code || `JIV-${String(p.id).padStart(6, '0')}`,
    name: p.name,
    age: p.age,
    gender: p.gender || '',
    phone: p.phone,
    bloodGroup: p.blood_group || '',
    address: p.address || '',
    medicalHistory: p.medical_history || '',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

// Convert backend visit to original format
function toLocalVisit(v, patients) {
  const patient = patients.find(p => String(p.id) === String(v.patient_id));
  return {
    id: String(v.id),
    patientId: String(v.patient_id),
    patientName: v.patient_name || patient?.name || '',
    patientPhone: v.patient_phone || patient?.phone || '',
    patientCode: patient?.patient_code || patient?.patientCode || '',
    mrdNumber: v.mrd_number || '',
    visitSeq: v.visit_seq || null,
    date: v.visit_date,
    fee: v.consultation_fee || 0,
    complaints: v.complaints || '',
    diagnosis: v.diagnosis || '',
    medicines: (v.items || []).map(i => ({
      medicineId: i.medicine_id ? String(i.medicine_id) : null,
      name: i.medicine_name,
      quantity: i.quantity_given || 0,
      quantityReturned: i.quantity_returned || 0,
      sellingPrice: i.selling_price || 0,
      dosage: i.dosage || '',
      frequency: i.frequency || '',
      duration: i.duration || '',
    })),
    instructions: v.notes || '',
    createdAt: v.created_at,
    followupRequired: v.followup_required === 1,
    followupDate: v.followup_date,
  };
}

// Convert backend medicine to original format
function toLocalMedicine(m) {
  return {
    id: String(m.id),
    name: m.name,
    brand: m.brand || '',
    category: m.category || '',
    quantity: m.quantity || 0,
    lowStock: m.low_stock_threshold || 10,
    expiry: m.expiry_date || '',
    purchasePrice: m.purchase_price || 0,
    sellingPrice: m.selling_price || 0,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

// Convert backend expense to original finance format
function toLocalFinance(e) {
  return {
    id: String(e.id),
    date: e.expense_date,
    createdAt: e.created_at,
    type: e.type,
    description: e.description || '',
    category: e.category || '',
    amount: e.amount,
  };
}

// Load all data from backend into localStorage so original scripts work
async function syncFromBackend() {
  if (!API.getToken()) return;

  try {
    const [patients, visits, medicines, expenses] = await Promise.all([
      API.getPatients(),
      API.getVisits(),
      API.getMedicines(),
      API.getExpenses(),
    ]);

    const localPatients  = Array.isArray(patients)  ? patients.map(toLocalPatient)  : [];
    const localVisits    = Array.isArray(visits)     ? visits.map(v => toLocalVisit(v, patients))    : [];
    const localMedicines = Array.isArray(medicines)  ? medicines.map(toLocalMedicine) : [];
    const localFinance   = Array.isArray(expenses)   ? expenses.map(toLocalFinance)   : [];

    localStorage.setItem(KEYS.patients,  JSON.stringify(localPatients));
    localStorage.setItem(KEYS.visits,    JSON.stringify(localVisits));
    localStorage.setItem(KEYS.inventory, JSON.stringify(localMedicines));
    localStorage.setItem(KEYS.finance,   JSON.stringify(localFinance));

    console.log(`Synced: ${localPatients.length} patients, ${localVisits.length} visits, ${localMedicines.length} medicines`);
  } catch (err) {
    console.error('Sync failed:', err);
  }
}

// ── Intercept localStorage.setItem to save to backend ────────────────────────
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = async function(key, value) {
  _origSetItem(key, value); // Always update local first (for immediate UI)

  if (!API.getToken()) return;

  try {
    const newData = JSON.parse(value);

    if (key === KEYS.patients) {
      const backendPatients = await API.getPatients();
      const backendIds = new Set(backendPatients.map(p => String(p.id)));
      const localIds   = new Set(newData.map(p => p.id));

      // Add new patients
      for (const p of newData) {
        if (!backendIds.has(p.id)) {
          await API.addPatient({
            name: p.name, age: p.age, gender: p.gender,
            phone: p.phone, address: p.address,
            blood_group: p.bloodGroup, medical_history: p.medicalHistory,
          });
        } else {
          // Update existing
          await API.updatePatient(p.id, {
            name: p.name, age: p.age, gender: p.gender,
            phone: p.phone, address: p.address,
            blood_group: p.bloodGroup, medical_history: p.medicalHistory,
          });
        }
      }
      // Delete removed patients
      for (const bp of backendPatients) {
        if (!localIds.has(String(bp.id))) {
          await API.deletePatient(bp.id);
        }
      }
    }

    if (key === KEYS.visits) {
      const backendVisits = await API.getVisits();
      const backendIds    = new Set(backendVisits.map(v => String(v.id)));
      const localIds      = new Set(newData.map(v => v.id));

      for (const v of newData) {
        if (!backendIds.has(v.id)) {
          const createdVisit = await API.addVisit({
            patient_id:       v.patientId,
            visit_date:       v.date,
            complaints:       v.complaints,
            diagnosis:        v.diagnosis,
            notes:            v.instructions,
            consultation_fee: v.fee,
            followup_required: v.followupRequired || false,
            prescription_items: (v.medicines || []).map(m => ({
              medicine_id:   m.medicineId || null,
              medicine_name: m.name,
              dosage:        m.dosage,
              frequency:     m.frequency,
              duration:      m.duration,
              quantity_given: m.quantity || 0,
            })),
          });
          if (createdVisit?.error) throw new Error(createdVisit.error);

          // The visit screen writes optimistically to local storage. Refresh the
          // server-backed cache once the sale has been saved so stock and Finance
          // immediately show the deducted quantity and Medicine Sales income.
          await syncFromBackend();
          window.dispatchEvent(new CustomEvent('jivak:visit-saved'));
        }
      }
      for (const bv of backendVisits) {
        if (!localIds.has(String(bv.id))) {
          await API.deleteVisit(bv.id);
        }
      }
    }

    if (key === KEYS.inventory) {
      const backendMeds = await API.getMedicines();
      const backendIds  = new Set(backendMeds.map(m => String(m.id)));
      const localIds    = new Set(newData.map(m => m.id));

      for (const m of newData) {
        if (!backendIds.has(m.id)) {
          await API.addMedicine({
            name: m.name, brand: m.brand, category: m.category,
            quantity: m.quantity, low_stock_threshold: m.lowStock,
            expiry_date: m.expiry, purchase_price: m.purchasePrice,
            selling_price: m.sellingPrice,
          });
        } else {
          await API.updateMedicine(m.id, {
            name: m.name, brand: m.brand, category: m.category,
            quantity: m.quantity, low_stock_threshold: m.lowStock,
            expiry_date: m.expiry, purchase_price: m.purchasePrice,
            selling_price: m.sellingPrice,
          });
        }
      }
      for (const bm of backendMeds) {
        if (!localIds.has(String(bm.id))) {
          await API.deleteMedicine(bm.id);
        }
      }
    }

    if (key === KEYS.finance) {
      const backendExp = await API.getExpenses();
      const backendIds = new Set(backendExp.map(e => String(e.id)));

      for (const e of newData) {
        if (!backendIds.has(e.id) && !e.id.startsWith('visit-')) {
          await API.addExpense({
            type: e.type, category: e.category,
            amount: e.amount, description: e.description,
            expense_date: e.date,
          });
        }
      }
      for (const be of backendExp) {
        const stillExists = newData.find(e => String(e.id) === String(be.id));
        if (!stillExists) await API.deleteExpense(be.id);
      }
    }
  } catch (err) {
    console.error('Backend sync error:', err.message);
  }
};

// Sync on load (after auth)
window.addEventListener('load', () => {
  setTimeout(async () => {
    if (API.getToken()) {
      await syncFromBackend();
      // Re-render current view
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, 500);
});

// ── Fix: hide SP and PK views when switching to other tabs ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-view]').forEach(a => {
    a.addEventListener('click', () => {
      const view = a.dataset.view;
      if (view !== 'suvarnaprashan') {
        const sp = document.getElementById('suvarnaprashanView');
        if (sp) sp.hidden = true;
      }
      if (view !== 'panchakarma') {
        const pk = document.getElementById('panchakarmaView');
        if (pk) pk.hidden = true;
      }
    });
  });
});

// ── Global 403 handler — refresh token on any API call ───────────────────────
let _sessionExpiredHandled = false;
const _origFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _origFetch(...args);
  const url = args[0]?.toString() || '';
  // /api/auth/login is excluded: a wrong password there returns 401 with
  // "Invalid username or password", which isn't a session expiring — it's
  // someone who hasn't logged in yet. Treating it the same way falsely
  // showed "your session has expired" on every mistyped password, and
  // reloaded the page out from under the login form.
  if ((res.status === 401 || res.status === 403) && url.includes('/api/') && !url.includes('/api/auth/login')) {
    const cloned = res.clone();
    const body = await cloned.json().catch(() => ({}));
    if (body.error && (body.error.includes('expired') || body.error.includes('Invalid')) && !_sessionExpiredHandled) {
      _sessionExpiredHandled = true;
      localStorage.removeItem('jivak-api-token');
      sessionStorage.removeItem('jivak-doctor-session-v1');
      alert('Your session has expired. Please log in again.');
      location.reload();
    }
  }
  return res;
};
