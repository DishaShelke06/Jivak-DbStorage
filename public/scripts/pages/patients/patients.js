const $ = s => document.querySelector(s);
const patientDialog = $('#patientDialog');
const profileDialog = $('#profileDialog');
let patients = [];

const token = () => localStorage.getItem('jivak-api-token');
const safe  = v => { const d = document.createElement('div'); d.textContent = v||''; return d.innerHTML; };
const fmtDate = v => { try { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(v)); } catch { return v||''; } };
// MRD shown per visit — changes every time (monthly-resetting queue
// number), unlike the patient's permanent JIV code which never changes.
const visitMrdCode = v => v.visit_seq
  ? `MRD-${(v.visit_date || '').slice(0, 7).replace('-', '')}-${String(v.visit_seq).padStart(4, '0')}`
  : '';
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;

async function apiFetch(method, path, body) {
  const opts = { method, headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`} };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api'+path, opts);
  if (!res.ok) { const e = await res.json().catch(()=>({error:'Error'})); throw new Error(e.error); }
  return res.json();
}

async function loadPatients() {
  try {
    const data = await apiFetch('GET', '/patients');
    patients = Array.isArray(data) ? data : [];
    // Sync to localStorage for autocomplete/enhancements compatibility
    localStorage.setItem('jivak-patients-v1', JSON.stringify(patients.map(p => ({
      id: String(p.id), name: p.name, age: p.age, gender: p.gender,
      patientCode: p.patient_code,
      phone: p.phone, bloodGroup: p.blood_group, address: p.address,
      medicalHistory: p.medical_history, createdAt: p.created_at, updatedAt: p.updated_at
    }))));
  } catch(e) { console.error('Patients load error:', e); }
}

function render() {
  const query  = $('#searchInput').value.trim().toLowerCase();
  const gender = $('#genderFilter').value;
  const filtered = patients.filter(p =>
    (!query  || p.name?.toLowerCase().includes(query) || p.phone?.includes(query)) &&
    (!gender || p.gender === gender)
  );

  $('#patientTableBody').innerHTML = filtered.map(p => `
    <tr data-id="${p.id}">
      <td><span class="patient-name">${safe(p.name)}</span><span class="patient-id">${safe(p.patient_code || `JIV-${String(p.id).padStart(6, '0')}`)}</span></td>
      <td>${safe(p.phone)}</td>
      <td>${p.age||'—'} yrs · ${safe(p.gender||'—')}</td>
      <td>${p.blood_group ? `<span class="pill">${p.blood_group}</span>` : '—'}</td>
      <td>${fmtDate(p.updated_at||p.created_at)}</td>
      <td><div class="row-actions">
        <button class="link-button view" data-id="${p.id}">View</button>
        <button class="link-button edit" data-id="${p.id}">Edit</button>
        <button class="link-button danger" data-delete-patient="${p.id}">Delete</button>
      </div></td>
    </tr>`).join('');

  $('#emptyState').hidden    = patients.length !== 0 || Boolean(query || gender);
  $('#resultsText').textContent = patients.length
    ? `${filtered.length} of ${patients.length} patient${patients.length===1?'':'s'} shown`
    : 'No patients have been added yet.';
  $('#clearFiltersBtn').hidden = !(query || gender);
  $('#patientCount').textContent = patients.length;
  const now = new Date(); const ms = new Date(now.getFullYear(), now.getMonth(), 1);
  $('#newThisMonth').textContent = patients.filter(p => new Date(p.created_at) >= ms).length;
  const sd = new Date(Date.now() - 7*864e5);
  $('#recentCount').textContent  = patients.filter(p => new Date(p.updated_at) >= sd).length;

  if (filtered.length===0 && patients.length>0)
    $('#patientTableBody').innerHTML = `<tr><td colspan="6" style="text-align:center;padding:31px;color:#718078">No patients match your search.</td></tr>`;
}

function openPatientForm(patient) {
  $('#patientForm').reset();
  $('#patientId').value       = patient?.id || '';
  $('#formEyebrow').textContent = patient ? 'Edit patient' : 'New patient';
  $('#formTitle').textContent   = patient ? 'Update patient details' : 'Add patient details';
  $('#savePatientBtn').textContent = patient ? 'Save changes' : 'Save patient';
  if (patient) {
    $('#name').value          = patient.name || '';
    $('#age').value           = patient.age  || '';
    $('#gender').value        = patient.gender || '';
    $('#phone').value         = patient.phone || '';
    $('#bloodGroup').value    = patient.blood_group || '';
    $('#address').value       = patient.address || '';
    $('#medicalHistory').value= patient.medical_history || '';
  }
  patientDialog.showModal();
  setTimeout(() => $('#name').focus(), 50);
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function showProfile(id) {
  const p = patients.find(x => String(x.id) === String(id));
  if (!p) return;
  $('#profileContent').innerHTML = `
    <button class="icon-button profile-close" type="button" aria-label="Close">×</button>
    <div class="profile-title">
      <div>
        <p class="eyebrow">${safe(p.patient_code || `JIV-${String(p.id).padStart(6, '0')}`)} · ${p.created_at === p.updated_at ? 'New patient' : 'Existing patient'}</p>
        <h2>${safe(p.name)}</h2>
        <p class="profile-meta">Added ${fmtDate(p.created_at)} · Last updated ${fmtDate(p.updated_at)}</p>
      </div>
      <span class="pill">${safe(p.blood_group || 'Blood group not recorded')}</span>
    </div>
    <div class="profile-grid">
      <div><span>Age / Gender</span><strong>${p.age||'—'} yrs · ${safe(p.gender||'—')}</strong></div>
      <div><span>Phone</span><strong>${safe(p.phone)}</strong></div>
      <div><span>Address</span><strong>${safe(p.address||'Not recorded')}</strong></div>
    </div>
    <section class="notes">
      <span class="notes-title">Medical history & notes</span>
      <p>${safe(p.medical_history||'No medical history recorded.')}</p>
    </section>
    <section>
      <span class="notes-title">Visit history</span>
      <div class="visit-placeholder" id="profileVisitHistory">Loading...</div>
    </section>
    <div class="profile-actions">
      <button class="secondary" type="button" id="closeProfile">Close</button>
      <button class="primary"   type="button" id="editFromProfile">Edit patient</button>
    </div>`;

  profileDialog.showModal();
  $('.profile-close').onclick    = () => profileDialog.close();
  $('#closeProfile').onclick     = () => profileDialog.close();
  $('#editFromProfile').onclick  = () => { profileDialog.close(); openPatientForm(p); };

  // Load visit history
  apiFetch('GET', `/patients/${id}`).then(full => {
    const visits = full.visits || [];
    $('#profileVisitHistory').innerHTML = visits.length
      ? visits.map(v => `<div class="history-row">
          <span><strong>${fmtDate(v.visit_date)} · ${safe(visitMrdCode(v))} · ${safe(p.patient_code || `JIV-${String(p.id).padStart(6, '0')}`)}</strong><br>${safe(v.diagnosis||'')}</span>
           <span class="row-actions"><button class="link-button" data-profile-visit="${v.id}">View prescription</button>${(v.items || []).some(i => i.medicine_id && Number(i.quantity_given) > Number(i.quantity_returned || 0)) ? `<button class="link-button" data-return-visit="${v.id}">Return medicine</button>` : ''}</span>
        </div>`).join('')
      : 'No visits recorded yet.';
    $('#profileVisitHistory').querySelectorAll('[data-profile-visit]').forEach(button => button.onclick = () =>
      window.dispatchEvent(new CustomEvent('jivak:open-prescription', { detail: { visitId: button.dataset.profileVisit } }))
    );
    $('#profileVisitHistory').querySelectorAll('[data-return-visit]').forEach(button => button.onclick = async () => {
      const visit = visits.find(v => String(v.id) === String(button.dataset.returnVisit));
      const returnable = (visit.items || []).filter(i => i.medicine_id && Number(i.quantity_given) > Number(i.quantity_returned || 0));
      const choices = returnable.map((i, index) => `${index + 1}. ${i.medicine_name} (can return ${Number(i.quantity_given) - Number(i.quantity_returned || 0)})`).join('\n');
      const item = returnable[Number(prompt(`Select medicine to return:\n${choices}`)) - 1];
      if (!item) return;
      const quantity = Number(prompt(`Return quantity for ${item.medicine_name}:`, '1'));
      if (!Number.isInteger(quantity) || quantity < 1) return;
      try {
        await apiFetch('POST', `/prescription-items/${item.id}/return`, { quantity });
        await loadPatients(); render(); showProfile(id);
        toast('Medicine returned: inventory and Finance updated.');
      } catch (err) { alert('Could not return medicine: ' + err.message); }
    });
  }).catch(() => { $('#profileVisitHistory').textContent = 'Could not load visit history.'; });
}

// Events
$('#patientForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
  const id = $('#patientId').value;
  const data = {
    name: $('#name').value.trim(), age: Number($('#age').value),
    gender: $('#gender').value, phone: $('#phone').value.trim(),
    blood_group: $('#bloodGroup').value, address: $('#address').value.trim(),
    medical_history: $('#medicalHistory').value.trim(),
  };
  try {
    if (id) await apiFetch('PUT', `/patients/${id}`, data);
    else    await apiFetch('POST', '/patients', data);
    patientDialog.close();
    await loadPatients();
    render();
    toast(id ? 'Patient details updated.' : 'Patient added to your register.');
  } catch(err) { alert('Error: ' + err.message); }
});

$('#patientTableBody').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  const row = e.target.closest('tr');
  const id  = btn?.dataset.id || btn?.dataset.deletePatient || row?.dataset.id;
  if (!id) return;

  if (btn?.dataset.deletePatient) {
    const p = patients.find(x => String(x.id)===String(id));
    if (!p || !confirm(`Delete ${p.name} and all their records? This cannot be undone.`)) return;
    try {
      await apiFetch('DELETE', `/patients/${id}`);
      await loadPatients(); render();
      toast('Patient deleted.');
    } catch(err) { alert('Error: ' + err.message); }
    return;
  }
  if (btn?.classList.contains('edit')) openPatientForm(patients.find(p => String(p.id)===String(id)));
  else showProfile(id);
});

$('#addPatientBtn').onclick   = () => openPatientForm();
$('#emptyAddBtn').onclick     = () => openPatientForm();
$('#closeDialog').onclick     = () => patientDialog.close();
$('#cancelDialog').onclick    = () => patientDialog.close();
$('#searchInput').addEventListener('input', render);
$('#genderFilter').addEventListener('change', render);
$('#clearFiltersBtn').onclick = () => { $('#searchInput').value=''; $('#genderFilter').value=''; render(); };

patientDialog.addEventListener('click', e => { if(e.target===patientDialog) patientDialog.close(); });
profileDialog.addEventListener('click', e => { if(e.target===profileDialog) profileDialog.close(); });

$('#today').textContent = new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());

// Initial load
loadPatients().then(render);
