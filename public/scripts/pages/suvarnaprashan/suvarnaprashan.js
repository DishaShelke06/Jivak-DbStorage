(() => {
  const $ = s => document.querySelector(s);
  const safe = v => { const d = document.createElement('div'); d.textContent = v||''; return d.innerHTML; };
  const money = v => '₹' + Number(v||0).toLocaleString('en-IN');
  const fmtDate = v => { try { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(v+'T00:00:00')); } catch { return v; } };
  const today = () => new Date().toISOString().slice(0,10);

  let children = []; // each: { id, name, dob, age_at_registration, registration_date, parent_name, phone, status, doses, dose_count, last_dose_date, total_paid }
  let activeChildId = null;

  function authHeaders(json) {
    const token = localStorage.getItem('jivak-api-token');
    return json ? { 'Content-Type':'application/json', Authorization:`Bearer ${token}` } : { Authorization:`Bearer ${token}` };
  }

  async function api(path, opts) {
    const res = await fetch(`/api/suvarnaprashan${path}`, opts);
    if (res.status === 401 || res.status === 403) {
      // The global fetch interceptor in api-bridge.js already shows the
      // "session expired" alert and reloads the page once — don't duplicate
      // that here, it just stacks multiple alerts on top of each other.
      throw new Error('unauthorized');
    }
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Request failed.'})); throw new Error(e.error || 'Request failed.'); }
    return res.status === 204 ? null : res.json();
  }

  // Age from DOB if known, else from age recorded at registration + years elapsed since.
  function computeAge(child) {
    if (child.dob) {
      const dob = new Date(child.dob + 'T00:00:00');
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
      const months = (now.getFullYear()-dob.getFullYear())*12 + (now.getMonth()-dob.getMonth()) - (now.getDate()<dob.getDate()?1:0);
      if (years >= 1) return `${years} yr`;
      const clampedMonths = Math.max(0, months);
      if (clampedMonths >= 1) return `${clampedMonths} mo`;
      const days = Math.max(0, Math.round((now - dob) / 86400000));
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (child.age_at_registration != null && child.registration_date) {
      const reg = new Date(child.registration_date + 'T00:00:00');
      const now = new Date();
      const yearsElapsed = now.getFullYear() - reg.getFullYear() - (now < new Date(reg.getFullYear()+  (now.getFullYear()-reg.getFullYear()), reg.getMonth(), reg.getDate()) ? 1 : 0);
      return `${Number(child.age_at_registration) + Math.max(0, yearsElapsed)} yr (approx)`;
    }
    return '—';
  }

  async function loadChildren() {
    const search = $('#spSearch')?.value.trim() || '';
    const status = $('#spStatusFilter')?.value || '';
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    try { children = await api(`/children${qs}`, { headers: authHeaders() }); }
    catch (e) { console.error('SP load error:', e); children = []; }
  }

  function toast(msg) { const t = $('#toast'); if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);} }

  function render() {
    const currentMonth = today().slice(0,7);
    const dosesThisMonth = children.flatMap(c => c.doses||[]).filter(d => d.dose_date.startsWith(currentMonth));

    $('#spTotalChildren').textContent = children.length;
    $('#spActiveChildren').textContent = children.filter(c => c.status !== 'completed').length;
    $('#spThisMonth').textContent = dosesThisMonth.length;
    $('#spMonthIncome').textContent = money(dosesThisMonth.reduce((s,d) => s+Number(d.amount),0));

    const sorted = [...children].sort((a,b) => (b.last_dose_date||b.registration_date||'').localeCompare(a.last_dose_date||a.registration_date||''));
    $('#spTableBody').innerHTML = sorted.map(c => `
      <tr data-sp-row="${c.id}" style="cursor:pointer">
        <td><span class="patient-name">${safe(c.name)}</span></td>
        <td>${computeAge(c)}</td>
        <td>${safe(c.parent_name||'—')}</td>
        <td>${safe(c.phone)}</td>
        <td>${c.dose_count}</td>
        <td>${c.last_dose_date ? fmtDate(c.last_dose_date) : '—'}</td>
        <td><strong>${money(c.total_paid)}</strong></td>
        <td><span class="status ${c.status==='completed'?'completed':'due'}">${c.status==='completed'?'Completed':'Active'}</span></td>
        <td><div class="row-actions">
          <button class="link-button" data-sp-open="${c.id}">Open</button>
        </div></td>
      </tr>`).join('');
    $('#spEmptyState').hidden = children.length > 0;
  }

  // ── Register / edit child ──────────────────────────────────────────────────
  function openChildForm(child) {
    $('#spForm').reset();
    $('#spRecordId').value = child?.id || '';
    $('#spFormTitle').textContent = child ? 'Edit Child Details' : 'Register Child';
    $('#spSaveBtn').textContent   = child ? 'Save changes' : 'Register child';
    $('#spStatusField').hidden = !child;
    $('#spFirstDoseFields').style.display = child ? 'none' : '';
    if (child) {
      $('#spChildName').value   = child.name;
      $('#spDob').value         = child.dob || '';
      $('#spChildAge').value    = child.age_at_registration || '';
      $('#spParentName').value  = child.parent_name || '';
      $('#spPhone').value       = child.phone;
      $('#spStatus').value      = child.status || 'active';
    } else {
      $('#spFirstDoseDate').value = today();
    }
    $('#spDialog').showModal();
    setTimeout(() => $('#spChildName').focus(), 50);
  }

  $('#spForm').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('#spRecordId').value;
    try {
      if (id) {
        await api(`/children/${id}`, {
          method:'PUT', headers: authHeaders(true),
          body: JSON.stringify({
            name: $('#spChildName').value.trim(), dob: $('#spDob').value || null,
            age_at_registration: $('#spChildAge').value ? Number($('#spChildAge').value) : null,
            parent_name: $('#spParentName').value.trim(), phone: $('#spPhone').value.trim(),
            status: $('#spStatus').value
          })
        });
        toast('Child details updated.');
      } else {
        await api('/children', {
          method:'POST', headers: authHeaders(true),
          body: JSON.stringify({
            name: $('#spChildName').value.trim(), dob: $('#spDob').value || null,
            age_at_registration: $('#spChildAge').value ? Number($('#spChildAge').value) : null,
            parent_name: $('#spParentName').value.trim(), phone: $('#spPhone').value.trim(),
            first_dose_date: $('#spFirstDoseDate').value || null,
            first_dose_amount: $('#spFirstDoseAmount').value ? Number($('#spFirstDoseAmount').value) : 0
          })
        });
        toast('Child registered.');
      }
      $('#spDialog').close();
      await loadChildren();
      render();
    } catch (err) { alert(err.message); }
  });

  // ── Child detail: dose history + add dose ──────────────────────────────────
  async function openDetail(id) {
    activeChildId = id;
    let child;
    try { child = await api(`/children/${id}`, { headers: authHeaders() }); }
    catch (e) { return alert(e.message); }
    $('#spDetailTitle').textContent = child.name;
    $('#spDetailMeta').textContent = `${computeAge(child)} · ${child.parent_name||'—'} · ${child.phone} · ${child.status==='completed'?'Completed':'Active'}`;
    $('#spDoseChildId').value = id;
    $('#spDoseDate').value = today();
    $('#spDoseAmount').value = '';
    $('#spDoseTableBody').innerHTML = (child.doses||[]).map(d => `
      <tr>
        <td>${fmtDate(d.dose_date)}</td>
        <td>${money(d.amount)}</td>
        <td><div class="row-actions"><button class="link-button danger" data-sp-dose-delete="${d.id}">Delete</button></div></td>
      </tr>`).join('') || '<tr><td colspan="3" style="color:var(--muted)">No doses recorded yet.</td></tr>';
    $('#spDetailDialog').showModal();
  }

  $('#spDoseForm').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('#spDoseChildId').value;
    try {
      await api(`/children/${id}/doses`, {
        method:'POST', headers: authHeaders(true),
        body: JSON.stringify({ dose_date: $('#spDoseDate').value, amount: Number($('#spDoseAmount').value||0) })
      });
      toast('Dose added.');
      await loadChildren();
      render();
      openDetail(id);
    } catch (err) { alert(err.message); }
  });

  $('#spDoseTableBody').addEventListener('click', async e => {
    const doseId = e.target.dataset.spDoseDelete;
    if (!doseId) return;
    if (!confirm('Delete this dose record?')) return;
    try {
      await api(`/doses/${doseId}`, { method:'DELETE', headers: authHeaders() });
      toast('Dose deleted.');
      await loadChildren();
      render();
      openDetail(activeChildId);
    } catch (err) { alert(err.message); }
  });

  $('#spDetailEditChild').onclick = () => {
    const child = children.find(c => c.id === activeChildId);
    $('#spDetailDialog').close();
    openChildForm(child);
  };

  $('#spDetailDeleteChild').onclick = async () => {
    if (!confirm('Delete this child and their entire dose history? This cannot be undone.')) return;
    try {
      await api(`/children/${activeChildId}`, { method:'DELETE', headers: authHeaders() });
      toast('Child deleted.');
      $('#spDetailDialog').close();
      await loadChildren();
      render();
    } catch (err) { alert(err.message); }
  };

  $('#spTableBody').addEventListener('click', e => {
    const openId = e.target.dataset.spOpen || e.target.closest('tr')?.dataset.spRow;
    if (openId) openDetail(openId);
  });

  // ── Bulk "Record Clinic Day" ────────────────────────────────────────────────
  function renderBulkList() {
    const q = $('#spBulkSearch').value.trim().toLowerCase();
    const pool = children.filter(c => c.status !== 'completed' &&
      (!q || c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)));
    $('#spBulkList').innerHTML = pool.map(c => `
      <label>
        <input type="checkbox" class="sp-bulk-check" value="${c.id}" />
        <span class="sp-bulk-name">${safe(c.name)} <small>(${computeAge(c)} · ${safe(c.phone)})</small></span>
        <input type="number" min="0" placeholder="₹ amount" class="sp-bulk-amount" data-for="${c.id}" />
      </label>`).join('') || '<p>No active children match.</p>';
  }

  $('#spBulkDayBtn').onclick = async () => {
    await loadChildren();
    $('#spBulkDate').value = today();
    $('#spBulkSearch').value = '';
    renderBulkList();
    $('#spBulkDialog').showModal();
  };
  $('#spBulkSearch').addEventListener('input', renderBulkList);
  $('#spBulkClose').onclick = () => $('#spBulkDialog').close();
  $('#spBulkCancel').onclick = () => $('#spBulkDialog').close();

  $('#spBulkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const checks = [...document.querySelectorAll('.sp-bulk-check:checked')];
    if (!checks.length) return alert('Tick at least one child.');
    const entries = checks.map(chk => ({
      child_id: chk.value,
      amount: Number(document.querySelector(`.sp-bulk-amount[data-for="${chk.value}"]`)?.value || 0)
    }));
    try {
      await api('/doses/bulk', {
        method:'POST', headers: authHeaders(true),
        body: JSON.stringify({ dose_date: $('#spBulkDate').value, entries })
      });
      toast(`Recorded doses for ${entries.length} child(ren).`);
      $('#spBulkDialog').close();
      await loadChildren();
      render();
    } catch (err) { alert(err.message); }
  });

  // ── Misc: add, close, filters, export ───────────────────────────────────────
  $('#spAddBtn').onclick        = () => openChildForm();
  $('#spCloseDialog').onclick   = () => $('#spDialog').close();
  $('#spCancelDialog').onclick  = () => $('#spDialog').close();
  $('#spDetailClose').onclick   = () => $('#spDetailDialog').close();
  $('#spSearch').addEventListener('input', async () => { await loadChildren(); render(); });
  $('#spStatusFilter').addEventListener('change', async () => { await loadChildren(); render(); });

  $('#spExportBtn').addEventListener('click', () => {
    const rows = [['Child Name','Age','Parent Name','Phone','Dose Date','Amount']];
    children.forEach(c => (c.doses||[]).forEach(d => rows.push([c.name, computeAge(c), c.parent_name||'', c.phone, d.dose_date, d.amount])));
    const blob = new Blob([rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`suvarnaprashan-${today()}.csv`; a.click();
  });

  async function init() { await loadChildren(); render(); }

  // Hook into nav
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view === 'suvarnaprashan') {
      a.addEventListener('click', async e => {
        e.preventDefault();
        location.hash = '#suvarnaprashan';
        document.querySelectorAll('main > *').forEach(v => v.hidden = true);
        $('#suvarnaprashanView').hidden = false;
        document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view==='suvarnaprashan'));
        if ($('#pageEyebrow')) $('#pageEyebrow').textContent = '';
        if ($('#pageTitle'))   $('#pageTitle').textContent   = 'सुवर्णप्राशन';
        await init();
      });
    }
  });

  window.addEventListener('hashchange', async () => {
    if (location.hash === '#suvarnaprashan') {
      document.querySelectorAll('main > *').forEach(v => v.hidden = true);
      $('#suvarnaprashanView').hidden = false;
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view==='suvarnaprashan'));
      if ($('#pageTitle')) $('#pageTitle').textContent = 'सुवर्णप्राशन';
      await init();
    }
  });

  if (location.hash === '#suvarnaprashan') init();
})();
