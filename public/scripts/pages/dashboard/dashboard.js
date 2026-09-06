(() => {
  const $ = s => document.querySelector(s);
  const token = () => localStorage.getItem('jivak-api-token');
  const money = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v||0);
  const safe  = v => { const d = document.createElement('div'); d.textContent = v||''; return d.innerHTML; };
  const today = () => new Date().toISOString().slice(0,10);
  const fmtDate = v => { try { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short'}).format(new Date(v+'T00:00:00')); } catch { return v; } };

  const ALL_VIEWS = ['dashboard','patients','visits','inventory','followups','finance','suvarnaprashan','panchakarma'];

  async function apiFetch(path) {
    const res = await fetch('/api'+path, { headers:{'Authorization':`Bearer ${token()}`} });
    if (!res.ok) throw new Error('API error');
    return res.json();
  }

  async function loadDashboard() {
    try {
      const d = await apiFetch('/dashboard');
      const user = (() => { try { return JSON.parse(localStorage.getItem('jivak-doctor-account-v1'))?.name; } catch { return ''; } })();
      $('#dashboardGreeting').textContent = user ? `Good day, ${user}` : 'Good day, Doctor';
      $('#dashPatients').textContent    = d.total_patients || 0;
      $('#dashTodayVisits').textContent = d.today_visits   || 0;
      $('#dashFollowups').textContent   = d.pending_followups?.length || 0;
      $('#dashTodayIncome').textContent = money(d.monthly_income || 0);

      // Followups panel
      const fu = d.pending_followups || [];
      $('#dashboardFollowupList').innerHTML = fu.length
        ? fu.slice(0,4).map(v => `
            <div class="compact-item">
              <div><strong>${safe(v.patient_name)}</strong><small>Due ${fmtDate(v.followup_date)}</small></div>
              <span class="status due">Due</span>
            </div>`).join('')
        : '<p class="compact-empty">No follow-ups are due right now.</p>';

      // Inventory panel
      const el = d.expiring_list || [];
      $('#dashboardInventoryList').innerHTML = el.length
        ? el.slice(0,4).map(m => `
            <div class="compact-item">
              <div><strong>${safe(m.name)}</strong><small>Expires ${fmtDate(m.expiry_date)}</small></div>
              <span class="status due">Alert</span>
            </div>`).join('')
        : '<p class="compact-empty">No inventory alerts at the moment.</p>';
    } catch(e) { console.error('Dashboard error:', e); }
  }

  function show(view) {
    ALL_VIEWS.forEach(v => {
      const el = $(`#${v}View`);
      if (el) el.hidden = v !== view;
    });
    document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));

    const labels = {
      dashboard:      'Dashboard',
      patients:       'Patient management',
      visits:         'Visits & prescriptions',
      inventory:      'Medicine inventory',
      followups:      'Patient follow-ups',
      finance:        'Expense & income tracking',
      suvarnaprashan: 'सुवर्णप्राशन',
      panchakarma:    'पंचकर्म',
    };
    $('#pageEyebrow').textContent = '';
    $('#pageTitle').textContent   = labels[view] || '';

    if (view === 'dashboard')   loadDashboard();
    if (view === 'followups')   window.JivakFollowups?.render?.();
    if (view === 'finance')     window.JivakFinance?.reload?.();
    if (view === 'inventory')   window.JivakInventory?.refresh?.();
  }

  // Nav
  document.querySelectorAll('[data-view]').forEach(a => {
    a.addEventListener('click', e => {
      const v = a.dataset.view;
      if (!v) return;
      e.preventDefault();
      location.hash = `#${v}`;
      show(v);
    });
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    show(ALL_VIEWS.includes(h) ? h : 'dashboard');
  });

  // Dashboard buttons
  $('#dashboardAddVisit').onclick = () => { location.hash='#visits'; show('visits'); setTimeout(()=>$('#addVisitBtn')?.click(), 100); };

  // Backup / restore
  $('#exportBackupBtn').onclick = async () => {
    try {
      const [patients, visits, medicines, expenses] = await Promise.all([
        apiFetch('/patients'), apiFetch('/visits'),
        apiFetch('/medicines'), apiFetch('/expenses'),
      ]);
      const data = { version:2, exportedAt:new Date().toISOString(), patients, visits, medicines, expenses };
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jivak-backup-${today()}.json`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch(e) { alert('Backup failed: '+e.message); }
  };

  $('#importBackupBtn').onclick = () => $('#backupFile').click();
  $('#backupFile').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b = JSON.parse(reader.result);
        if (!confirm('Restore this backup? This will reload the page.')) return;
        alert('Restore from backup: Please use DB Browser to restore clinic.db directly for data safety.');
      } catch { alert('Invalid backup file.'); }
    };
    reader.readAsText(file);
  };

  // Excel backup buttons (kept for compatibility)
  $('#exportExcelBackupBtn').onclick = () => window.JivakExcelBackup?.export?.();
  $('#importExcelBackupBtn').onclick = () => window.JivakExcelBackup?.import?.();

  // Danger zone: reset all clinic data. Requires the doctor to type an exact
  // confirmation phrase so it can never be triggered by a stray click.
  $('#resetAllDataBtn').onclick = async () => {
    const typed = prompt(
      'This permanently deletes ALL patients, visits, prescriptions, finance records, follow-ups, सुवर्णप्राशन and Panchakarma data.\n\n' +
      'This cannot be undone. Download a backup first if you have not already.\n\n' +
      'Type DELETE ALL DATA to confirm:'
    );
    if (typed === null) return; // cancelled
    if (typed.trim() !== 'DELETE ALL DATA') {
      alert('Confirmation phrase did not match. Nothing was deleted.');
      return;
    }
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ confirm: 'DELETE ALL DATA' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed.');
      alert('All clinic data has been cleared.');
      location.reload();
    } catch (e) { alert('Reset failed: ' + e.message); }
  };

  // Doctor name in topbar
  const user = (() => { try { return JSON.parse(localStorage.getItem('jivak-doctor-account-v1'))?.name; } catch { return ''; } })();
  if (user && $('#doctorName')) $('#doctorName').textContent = user;

  $('#today').textContent = new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());

  // Initial view
  const h = location.hash.slice(1);
  show(ALL_VIEWS.includes(h) ? h : 'dashboard');
})();
