// @ts-nocheck
(() => {
  const PATIENTS_KEY = 'jivak-patients-v1';
  const VISITS_KEY   = 'jivak-visits-v1';
  const ACCOUNT_KEY  = 'jivak-doctor-account-v1';
  const $ = s => document.querySelector(s);
  let visits = loadVisits();
  const patientList    = () => { try { return JSON.parse(localStorage.getItem(PATIENTS_KEY)) || []; } catch { return []; } };
  const doctorAccount  = () => { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY))  || {}; } catch { return {}; } };
  function loadVisits() { try { return JSON.parse(localStorage.getItem(VISITS_KEY)) || []; } catch { return []; } }
  function save() { localStorage.setItem(VISITS_KEY, JSON.stringify(visits)); }
  const safe = v => { const d = document.createElement('div'); d.textContent = v || ''; return d.innerHTML; };
  const fmtDate = v => new Intl.DateTimeFormat('en-IN', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${v}T00:00:00`));
  const currency = n => new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(n || 0);
  // MRD shown per visit — changes every time (monthly-resetting queue
  // number), unlike the patient's permanent JIV code which never changes.
  const visitMrdCode = v => v.visitSeq
    ? `MRD-${(v.date || '').slice(0, 7).replace('-', '')}-${String(v.visitSeq).padStart(4, '0')}`
    : (v.mrdNumber || '');

  // ── Medicine row with Morning/Afternoon/Evening/Night ────────────────────
  function medicineRow(m = {}) {
    const row = document.createElement('div');
    row.className = 'medicine-row';

    const dosageOpts = ['1 tab','2 tabs','1/2 tab','5 ml','10 ml','15 ml','1 tsp','2 tsp','1 sachet','1 capsule','2 capsules'];
    const durationOpts = ['3 days','5 days','7 days','10 days','14 days','1 month','2 months','3 months','As needed','Ongoing'];
    const freqOpts = ['Before meals','After meals','With meals','Empty stomach','Before sleep','With warm water','With milk','With honey','With ghee'];

    const dosageSel = (v) => dosageOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('') + `<option value="custom">Other...</option>`;
    const durSel    = (v) => durationOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('') + `<option value="custom">Other...</option>`;
    const frqSel    = (v) => freqOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('');

    row.innerHTML = `
      <input class="med-name" required maxlength="100" placeholder="Medicine name" value="${safe(m.name||'')}">
      <input class="med-quantity" type="number" min="1" step="1" value="${m.quantity || 1}" aria-label="Quantity sold" title="Quantity supplied from inventory">
      <select class="med-dosage"><option value="">Dosage</option>${dosageSel(m.dosage||'')}</select>
      <select class="med-duration"><option value="">Duration</option>${durSel(m.duration||'')}</select>
      <select class="med-frequency"><option value="">Meals / When</option>${frqSel(m.frequency||'')}</select>
      <div class="med-timing-group">
        <label class="med-timing-check ${m.morning  ?'checked':''}" title="Morning"><input type="checkbox" class="med-morning"   ${m.morning  ?'checked':''}>M</label>
        <label class="med-timing-check ${m.afternoon?'checked':''}" title="Afternoon"><input type="checkbox" class="med-afternoon" ${m.afternoon?'checked':''}>A</label>
        <label class="med-timing-check ${m.evening  ?'checked':''}" title="Evening"><input type="checkbox" class="med-evening"   ${m.evening  ?'checked':''}>E</label>
        <label class="med-timing-check ${m.night    ?'checked':''}" title="Night"><input type="checkbox" class="med-night"     ${m.night    ?'checked':''}>N</label>
      </div>
      <button class="remove-medicine" type="button" aria-label="Remove">×</button>`;

    const ds = row.querySelector('.med-dosage');
    const dr = row.querySelector('.med-duration');

    // Add custom existing values
    if (m.dosage && !dosageOpts.includes(m.dosage)) {
      const o = new Option(m.dosage, m.dosage, true, true);
      ds.insertBefore(o, ds.lastElementChild);
    }
    if (m.duration && !durationOpts.includes(m.duration)) {
      const o = new Option(m.duration, m.duration, true, true);
      dr.insertBefore(o, dr.lastElementChild);
    }

    ds.addEventListener('change', () => {
      if (ds.value !== 'custom') return;
      const v = prompt('Enter dosage:');
      if (v) { const o = new Option(v,v,true,true); ds.insertBefore(o, ds.lastElementChild); ds.value = v; }
      else ds.value = '';
    });
    dr.addEventListener('change', () => {
      if (dr.value !== 'custom') return;
      const v = prompt('Enter duration:');
      if (v) { const o = new Option(v,v,true,true); dr.insertBefore(o, dr.lastElementChild); dr.value = v; }
      else dr.value = '';
    });

    row.querySelectorAll('.med-timing-check').forEach(label => {
      label.querySelector('input').addEventListener('change', e => label.classList.toggle('checked', e.target.checked));
    });

    row.querySelector('.remove-medicine').onclick = () => {
      if (document.querySelectorAll('.medicine-row').length > 1) row.remove();
      else {
        row.querySelector('.med-name').value = '';
        row.querySelectorAll('select').forEach(x => x.selectedIndex = 0);
        row.querySelectorAll('input[type=checkbox]').forEach(x => { x.checked = false; x.closest('.med-timing-check').classList.remove('checked'); });
      }
    };
    $('#medicineRows').append(row);
  }

  function renderVisits() {
    const rows = [...visits].sort((a, b) => b.date.localeCompare(a.date));
    $('#visitTableBody').innerHTML = rows.map(v => `
      <tr data-visit-id="${v.id}">
        <td>${fmtDate(v.date)}</td>
        <td><span class="patient-name">${safe(v.patientName)}</span><span class="patient-id">${safe(visitMrdCode(v))} · ${safe(v.patientCode || `JIV-${v.id}`)}</span></td>
        <td><span class="patient-name">${safe(v.diagnosis)}</span><span class="patient-id">${safe(v.complaints)}</span></td>
        <td>${currency(v.fee)}</td>
        <td><div class="row-actions"><button class="link-button" data-view-visit="${v.id}">View prescription</button></div></td>
      </tr>`).join('');
    $('#visitEmptyState').hidden = visits.length > 0;
    $('#visitResultsText').textContent = visits.length ? `${visits.length} consultation${visits.length===1?'':'s'} recorded` : 'No visits have been recorded yet.';
    $('#visitCount').textContent = visits.length;
    const prefix = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const thisMonth = visits.filter(v => v.date.startsWith(prefix));
    $('#visitMonthCount').textContent = thisMonth.length;
    $('#feeThisMonth').textContent = currency(thisMonth.reduce((s,v) => s+Number(v.fee),0));
  }

  function openVisit() {
    const patients = patientList();
    if (!patients.length) { alert('Please add a patient first.'); location.hash='#patients'; return; }
    $('#visitForm').reset();
    $('#visitDate').value = new Date().toISOString().slice(0,10);
    $('#visitPatient').innerHTML = '<option value="" disabled selected>Select a patient</option>' +
      patients.map(p => `<option value="${p.id}">${safe(p.name)} — ${safe(p.phone)}</option>`).join('');
    $('#medicineRows').innerHTML = '';
    medicineRow();
    $('#visitDialog').showModal();
  }

  const RX_FACILITIES  = ['आमवात','सायटिका','संधीवात','मुळव्याध','मुतखडा','बद्धकोष्ठता','शितपित्त','आम्लपित्त','जुनाट सर्दी व खोकला','निद्रानाश','थायरॉईडचे विकार','मासीक पाळीचे आजार','PCOD','त्वचाविकार','दमा, बालदमा','सौंदर्य','उच्चरक्तदाब'];
  const RX_HIGHLIGHTS  = ['सर्व सुविधायुक्त पंचकर्म सेंटर','लहान मुलांसाठी पुष्य नक्षत्रावर सुवर्ण प्राशन','महिलांसाठी स्वतंत्र व्यवस्था','इतर सर्व व्याधीवर शास्त्रोक्त आयुर्वेदिक चिकित्सालय'];

  function timingLabel(m) {
    const parts = [];
    if (m.morning)   parts.push('Morning');
    if (m.afternoon) parts.push('Afternoon');
    if (m.evening)   parts.push('Evening');
    if (m.night)     parts.push('Night');
    return parts.length ? parts.join(' + ') : (m.frequency || '—');
  }

  function prescription(v) {
    const p = patientList().find(x => String(x.id) === String(v.patientId));
    const safe2 = s => s || '';
    const blank = '';

    $('#prescriptionContent').innerHTML = `
    <div class="rx-sheet">

      <!-- Background letterhead -->
      <div class="rx-bg"></div>

      <!-- Overlay fields -->
      <div class="rx-overlay">

        <!-- Patient Name + Date -->
        <div class="rx-field rx-field-underline" style="top:25.3%;left:26.5%;width:46%">
          <span class="rx-label">Patient Name:</span>
          <span class="rx-data">${safe(v.patientName)}</span>
        </div>
        <div class="rx-field rx-field-underline" style="top:25.3%;left:75%;width:21%">
          <span class="rx-label">Date:</span>
          <span class="rx-data">${fmtDate(v.date)}</span>
        </div>

        <!-- Row 2: BP BSL Temp -->
        <div class="rx-field" style="top:28.3%;left:26.5%;width:21%">
          <span class="rx-label">BP:</span>
          <span class="rx-data">${safe2(v.bp)}</span>
        </div>
        <div class="rx-field" style="top:28.3%;left:48.7%;width:21%">
          <span class="rx-label">BSL:</span>
          <span class="rx-data">${safe2(v.bsl)}</span>
        </div>
        <div class="rx-field" style="top:28.3%;left:71%;width:25%">
          <span class="rx-label">Temp:</span>
          <span class="rx-data">${safe2(v.temp)}</span>
        </div>

        <!-- Row 3: Age Wt -->
        <div class="rx-field" style="top:30.9%;left:26.5%;width:21%">
          <span class="rx-label">Age:</span>
          <span class="rx-data">${p ? safe(String(p.age)) : ''}</span>
        </div>
        <div class="rx-field" style="top:30.9%;left:48.7%;width:21%">
          <span class="rx-label">Wt:</span>
          <span class="rx-data">${safe2(v.weight)}</span>
        </div>

        <!-- Rx symbol -->
        <div class="rx-print-symbol" style="top:33.4%;left:26.5%">℞</div>

        <!-- Rx content area -->
        <div class="rx-content-area" style="top:38%;left:26.5%;width:69%">
          ${v.complaints ? `<div class="rx-content-section"><div class="rx-content-label">Complaints / Symptoms</div><div class="rx-content-val">${safe(v.complaints)}</div></div>` : ''}
          ${v.diagnosis  ? `<div class="rx-content-section"><div class="rx-content-label">Diagnosis</div><div class="rx-content-val">${safe(v.diagnosis)}</div></div>` : ''}

          ${v.medicines && v.medicines.length ? `
          <div class="rx-content-section">
            <div class="rx-content-label">Medicines Prescribed</div>
            <table class="rx-med-table">
              <thead><tr>
                <th>Medicine</th><th>Dosage</th>
                <th>M</th><th>A</th><th>E</th><th>N</th>
                <th>When</th><th>Duration</th>
              </tr></thead>
              <tbody>
                ${v.medicines.map(m=>`<tr>
                  <td>${safe(m.name)}</td>
                  <td>${safe(m.dosage)||'—'}</td>
                  <td class="rx-tick">${m.morning  ?'✓':''}</td>
                  <td class="rx-tick">${m.afternoon?'✓':''}</td>
                  <td class="rx-tick">${m.evening  ?'✓':''}</td>
                  <td class="rx-tick">${m.night    ?'✓':''}</td>
                  <td>${safe(m.frequency)||'—'}</td>
                  <td>${safe(m.duration)||'—'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}

          ${v.instructions ? `<div class="rx-content-section"><div class="rx-content-label">Instructions</div><div class="rx-content-val">${safe(v.instructions)}</div></div>` : ''}

          <div class="rx-fee-line">Consultation fee: ${currency(v.fee)} &nbsp;·&nbsp; Ph: ${safe(v.patientPhone)}</div>
        </div>

      </div>

      <div class="prescription-actions">
        <button class="secondary" id="closePrescription">Close</button>
        <button class="primary" id="printPrescription">🖨️ Print / Save PDF</button>
      </div>
    </div>`;
    $('#prescriptionDialog').showModal();
    $('#closePrescription').onclick = () => $('#prescriptionDialog').close();
    $('#printPrescription').onclick = () => {
      // Open prescription in new window for clean printing
      const sheet = document.querySelector('.rx-sheet').cloneNode(true);
      // Remove actions bar from clone
      sheet.querySelector('.prescription-actions')?.remove();
      const win = window.open('', '_blank', 'width=900,height=1100');
      win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Prescription - ${v.patientName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background: white; }
  .rx-sheet { position:relative; width:210mm; height:297mm; }
  .rx-bg {
    width:210mm; height:297mm;
    background-image:url('${location.origin}/assets/letterhead.jpg');
    background-size:210mm 297mm;
    background-repeat:no-repeat;
    print-color-adjust:exact;
    -webkit-print-color-adjust:exact;
  }
  .rx-overlay { position:absolute; top:0; left:0; width:100%; height:100%; }
  .rx-field { position:absolute; display:flex; align-items:flex-end; gap:1.5mm; padding-bottom:1px; }
  .rx-label { font-size:3mm; font-weight:700; color:#1a5c2a; white-space:nowrap; font-family:'Nunito','Segoe UI',Arial,sans-serif; }
  .rx-data { font-size:3.5mm; font-weight:600; color:#111; font-family:'Nunito','Segoe UI',Arial,sans-serif; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .rx-field-underline { border-bottom:.3mm solid #b8c9b8; padding-bottom:1mm; }
  .rx-print-symbol { position:absolute; font-size:7mm; line-height:1; font-weight:700; color:#1a5c2a; font-family:Georgia,serif; }
  .rx-content-area { position:absolute; font-family:'Nunito','Segoe UI',Arial,sans-serif; }
  .rx-content-section { margin-bottom:3mm; }
  .rx-content-label { font-size:2.5mm; font-weight:700; text-transform:uppercase; letter-spacing:.8px; color:#1a5c2a; margin-bottom:1mm; }
  .rx-content-val { font-size:3.2mm; color:#111; line-height:1.4; }
  .rx-med-table { width:100%; border-collapse:collapse; }
  .rx-med-table th { background:#e8f5e9; color:#1a5c2a; font-weight:700; padding:.8mm 1mm; border:1px solid #c8e6c8; font-size:2.3mm; text-transform:uppercase; text-align:left; }
  .rx-med-table td { padding:.8mm 1mm; border:1px solid #e0e0e0; font-size:2.6mm; }
  .rx-med-table tr:nth-child(even) td { background:#f9fdf9; }
  .rx-tick { text-align:center; color:#1a5c2a; font-weight:700; }
  .rx-fee-line { margin-top:3mm; font-size:3mm; font-weight:600; color:#1a5c2a; }
  .rx-blank { display:inline-block; width:15mm; border-bottom:1px solid #333; vertical-align:bottom; }
  @page { size:A4; margin:0; }
  @media print { body { margin:0; } }
</style>
</head><body>${sheet.outerHTML}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
      win.document.close();
    };
  }


  function addHistoryToProfile() {
    const content = $('#profileContent');
    const code = content.querySelector('.eyebrow')?.textContent.replace('PT-','');
    if (!code) return;
    const p = patientList().find(x => x.id.slice(-5).toUpperCase() === code);
    if (!p) return;
    const holder = content.querySelector('.visit-placeholder');
    if (!holder) return;
    const patientVisits = visits.filter(v => v.patientId === p.id).sort((a,b) => b.date.localeCompare(a.date));
    holder.innerHTML = patientVisits.length
      ? patientVisits.map(v => `<div class="history-row"><span><strong>${fmtDate(v.date)}</strong><br>${safe(v.diagnosis)}</span><button class="link-button" data-profile-visit="${v.id}">View prescription</button></div>`).join('')
      : 'No visits recorded yet.';
    holder.querySelectorAll('[data-profile-visit]').forEach(b => b.onclick = () => prescription(visits.find(v => v.id===b.dataset.profileVisit)));
  }

  // ── Events ───────────────────────────────────────────────────────────────
  $('#addVisitBtn').onclick      = openVisit;
  $('#emptyAddVisitBtn').onclick = openVisit;
  $('#closeVisitDialog').onclick  = () => $('#visitDialog').close();
  $('#cancelVisitDialog').onclick = () => $('#visitDialog').close();
  $('#addMedicineBtn').onclick    = () => medicineRow();
  $('#visitDialog').addEventListener('click', e => { if(e.target===$('#visitDialog')) $('#visitDialog').close(); });
  $('#prescriptionDialog').addEventListener('click', e => { if(e.target===$('#prescriptionDialog')) $('#prescriptionDialog').close(); });

  $('#visitForm').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const patient = patientList().find(p => p.id === $('#visitPatient').value);
    const liveInventory = window.JivakInventory?.getMedicines?.() || [];
    let cachedInventory = [];
    try { cachedInventory = JSON.parse(localStorage.getItem('jivak-inventory-v1')) || []; } catch {}
    const inventory = liveInventory.length ? liveInventory : cachedInventory;
    const meds = [...document.querySelectorAll('.medicine-row')].map(r => {
      const name = r.querySelector('.med-name').value.trim();
      const stockMedicine = inventory.find(m => m.name.toLowerCase() === name.toLowerCase());
      return {
      name,
      medicineId: stockMedicine ? String(stockMedicine.id) : null,
      quantity:  Number(r.querySelector('.med-quantity').value) || 0,
      dosage:    r.querySelector('.med-dosage').value,
      duration:  r.querySelector('.med-duration').value,
      frequency: r.querySelector('.med-frequency').value,
      morning:   r.querySelector('.med-morning').checked,
      afternoon: r.querySelector('.med-afternoon').checked,
      evening:   r.querySelector('.med-evening').checked,
      night:     r.querySelector('.med-night').checked,
    }; }).filter(m => m.name);

    const requested = new Map();
    meds.forEach(m => {
      if (m.medicineId && m.quantity > 0)
        requested.set(m.medicineId, (requested.get(m.medicineId) || 0) + m.quantity);
    });
    for (const [medicineId, quantity] of requested) {
      const medicine = inventory.find(m => String(m.id) === medicineId);
      if (medicine && quantity > Number(medicine.quantity || 0)) {
        alert(`Only ${medicine.quantity} unit(s) of ${medicine.name} are currently in stock.`);
        return;
      }
    }

    const visit = {
      id:          `v${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
      patientId:   patient.id,
      patientName: patient.name,
      patientPhone:patient.phone,
      patientCode: patient.patientCode || '',
      date:        $('#visitDate').value,
      fee:         Number($('#visitFee').value),
      bp:          $('#visitBP').value.trim(),
      bsl:         $('#visitBSL').value.trim(),
      temp:        $('#visitTemp').value.trim(),
      weight:      $('#visitWeight').value.trim(),
      complaints:  $('#complaints').value.trim(),
      diagnosis:   $('#diagnosis').value.trim(),
      medicines:   meds,
      instructions:$('#instructions').value.trim(),
      createdAt:   new Date().toISOString(),
    };
    visits.unshift(visit);
    save();
    $('#visitDialog').close();
    renderVisits();
    prescription(visit);
  });

  $('#visitTableBody').onclick = e => {
    const id = e.target.dataset.viewVisit;
    if (id) prescription(visits.find(v => v.id===id));
  };

  $('#profileDialog').addEventListener('toggle', () => { if($('#profileDialog').open) addHistoryToProfile(); });
  window.addEventListener('jivak:open-prescription', e => {
    const visit = visits.find(v => String(v.id) === String(e.detail.visitId));
    if (visit) prescription(visit);
    else alert('This prescription is still loading. Please close the profile and try again.');
  });
  window.addEventListener('jivak:visit-saved', () => {
    if (location.hash === '#visits') {
      visits = loadVisits();
      renderVisits();
    }
    window.JivakInventory?.refresh?.();
    window.JivakFinance?.reload?.();
  });

  // Data loads once here regardless of which page is currently shown (so
  // it's ready the moment the user navigates to Visits); the global router
  // in dashboard.js owns actually showing/hiding this view and calls back
  // in here to refresh the table whenever it switches to it.
  window.JivakVisits = { render: renderVisits };
  renderVisits();
})();
