(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const safe = v => { const d=document.createElement('div');d.textContent=v||'';return d.innerHTML; };
  const money = v => '₹'+Number(v||0).toLocaleString('en-IN');
  const fmtDate = v => { try{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(v+'T00:00:00'));}catch{return v;} };
  const today = () => new Date().toISOString().slice(0,10);
  const newId = () => `pk${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;

  const THERAPIES = [
    { name: 'जानुबस्ती (Janu Basti)',          price: 700,  unit: 'per day' },
    { name: 'सौंदर्य चिकित्सा (Saundarya)',     price: 700,  unit: 'per day' },
    { name: 'हृदयबस्ती (Hruday Basti)',          price: 700,  unit: 'per day' },
    { name: 'मान्याबस्ती (Manya Basti)',         price: 700,  unit: 'per day' },
    { name: 'कटिबस्ती (Kati Basti)',             price: 700,  unit: 'per day' },
    { name: 'स्नेहन / अभ्यंगस्नान (Snehan)',    price: 700,  unit: 'per day' },
    { name: 'स्वेदन (Swedan)',                   price: 700,  unit: 'per day' },
    { name: 'उद्वर्तन (Udvartan)',               price: 500,  unit: 'per day' },
    { name: 'वमन (Vaman)',                       price: 7000, unit: 'entire therapy' },
    { name: 'विरेचन (Virechan)',                 price: 7000, unit: 'entire therapy' },
    { name: 'बस्ती (Basti)',                     price: 700,  unit: 'per day' },
    { name: 'नस्य (Nasya)',                      price: 300,  unit: 'per day' },
    { name: 'रक्तमोक्षण / जलोका (Raktamoksha)', price: 450,  unit: 'per leech' },
    { name: 'शिरोधारा (Shirodhara)',             price: 1100, unit: 'per day' },
    { name: 'नेत्रतर्पण (Netra Tarpan)',         price: 650,  unit: 'per day' },
    { name: 'Other', price: 0, unit: '' },
  ];
  const THERAPY_NAMES = THERAPIES.map(t => t.name);
  const THERAPY_PRICE = Object.fromEntries(THERAPIES.map(t => [t.name, t.price]));
  const THERAPY_UNIT  = Object.fromEntries(THERAPIES.map(t => [t.name, t.unit]));

  let courses = [];
  let activeCourseId = null;
  let editingDayId = null;

  function getToken() { return localStorage.getItem('jivak-api-token'); }
  function getPatients() { try{return JSON.parse(localStorage.getItem('jivak-patients-v1'))||[];}catch{return[];} }

  async function apiFetch(method, path, body) {
    const opts = { method, headers:{'Content-Type':'application/json','Authorization':`Bearer ${getToken()}`} };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api'+path, opts);

    if (res.status === 403 || res.status === 401) {
      localStorage.removeItem('jivak-api-token');
      sessionStorage.removeItem('jivak-doctor-session-v1');
      return {};
    }

    return res.json();
  }

  async function loadCourses() {
    try { courses = await apiFetch('GET','/panchakarma'); if(!Array.isArray(courses)) courses=[]; }
    catch(e){ console.error('PK load:',e); courses=[]; }
  }

  function toast(msg){ const t=$('#toast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);} }

  // ── Render course list ────────────────────────────────────────────────────
  function render() {
    const filter = $('#pkStatusFilter').value;
    const search = $('#pkSearch').value.trim().toLowerCase();
    const filtered = courses.filter(c => {
      const ms = !filter||c.status===filter;
      const ms2 = !search||c.patient_name?.toLowerCase().includes(search)||c.phone?.includes(search);
      return ms&&ms2;
    }).sort((a,b)=>b.start_date.localeCompare(a.start_date));

    const active = courses.filter(c=>c.status==='active');
    const todaySessions = courses.flatMap(c=>c.days||[]).filter(d=>d.date===today());
    const totalCollected = courses.flatMap(c=>c.days||[]).reduce((s,d)=>s+Number(d.payment||0),0);

    $('#pkActiveCount').textContent = active.length;
    $('#pkTodayCount').textContent  = todaySessions.length;
    $('#pkTotalIncome').textContent = money(totalCollected);

    $('#pkTableBody').innerHTML = filtered.map(c => {
      const therapies = Array.isArray(c.therapies) ? c.therapies : [];
      const days = c.days||[];
      const done = days.filter(d=>d.done).length;
      const paid = days.reduce((s,d)=>s+Number(d.payment||0),0);
      const statusClass = c.status==='active'?'completed':c.status==='completed'?'due':'upcoming';
      const statusLabel = c.status==='active'?'Active':c.status==='completed'?'Completed':'Paused';
      return `<tr>
        <td><span class="patient-name">${safe(c.patient_name)}</span><span class="patient-id">${safe(c.phone)}</span></td>
        <td>${safe(therapies.join(', '))}</td>
        <td>${fmtDate(c.start_date)}</td>
        <td><span class="patient-name">${done}/${c.total_days} days</span><span class="patient-id">${Math.round((done/Math.max(c.total_days,1))*100)}%</span></td>
        <td><strong>${money(paid)}</strong></td>
        <td><span class="status ${statusClass}">${statusLabel}</span></td>
        <td><div class="row-actions">
          <button class="link-button" data-pk-open="${c.id}">View / Add Day</button>
          <button class="link-button" data-pk-edit="${c.id}">Edit</button>
          <button class="link-button danger" data-pk-delete="${c.id}">Delete</button>
        </div></td>
      </tr>`;
    }).join('');
    $('#pkEmptyState').hidden = courses.length > 0;
    const tw = document.querySelector('#pkListView .table-wrap');
    if (tw) tw.style.display = '';
  }

  // ── Course day view ────────────────────────────────────────────────────────
  function openCourseView(courseId) {
    const course = courses.find(c=>c.id===courseId);
    if (!course) return;
    activeCourseId = courseId;
    const therapies = Array.isArray(course.therapies)?course.therapies:[];
    const days = course.days||[];
    const paid = days.reduce((s,d)=>s+Number(d.payment||0),0);
    const done = days.filter(d=>d.done).length;

    $('#pkCourseTitle').textContent    = course.patient_name;
    $('#pkCourseTherapies').textContent = therapies.join(' · ');
    $('#pkCourseMeta').textContent     = `Started ${fmtDate(course.start_date)} · ${done}/${course.total_days} days · ${money(paid)} collected`;

    // Per-therapy summary
    const therapySummary = {};
    days.forEach(d => {
      const t = d.therapy || 'Other';
      if (!therapySummary[t]) therapySummary[t] = { sessions: 0, total: 0 };
      therapySummary[t].sessions++;
      therapySummary[t].total += Number(d.payment || 0);
    });

    const summaryHTML = Object.keys(therapySummary).length
      ? `<div class="pk-therapy-summary">
          <div class="pk-summary-title">Therapy Breakdown</div>
          <div class="pk-summary-grid">
            ${Object.entries(therapySummary).map(([t, s]) => `
              <div class="pk-summary-card">
                <div class="pk-summary-therapy">${safe(t)}</div>
                <div class="pk-summary-stats">
                  <span>${s.sessions} session${s.sessions !== 1 ? 's' : ''}</span>
                  <strong>${money(s.total)}</strong>
                </div>
              </div>`).join('')}
          </div>
        </div>` : '';

    $('#pkTherapySummary').innerHTML = summaryHTML;

    $('#pkDayList').innerHTML = days.length
      ? [...days].sort((a,b)=>a.day_number-b.day_number).map(d=>`
          <div class="pk-day-row ${d.done?'pk-day-done':''}">
            <div class="pk-day-num">Day ${d.day_number}</div>
            <div class="pk-day-info">
              <strong>${fmtDate(d.date)}</strong>
              <span class="pk-therapy-tag">${safe(d.therapy||'')}</span>
              ${d.notes?`<span class="patient-id">${safe(d.notes)}</span>`:''}
            </div>
            <div class="pk-day-payment">${money(d.payment)}</div>
            <div><span class="status ${d.done?'completed':'upcoming'}">${d.done?'Done':'Pending'}</span></div>
            <div class="row-actions">
              <button class="link-button" data-pk-day-edit="${d.id}">Edit</button>
              <button class="link-button danger" data-pk-day-delete="${d.id}">Delete</button>
            </div>
          </div>`).join('')
      : '<p style="color:var(--muted);padding:20px 0">No days recorded yet. Add Day 1 to start.</p>';

    $('#pkCourseStatusBtn').textContent = course.status==='active'?'Mark as Completed':'Mark as Active';
    $('#pkCourseStatusBtn').onclick = async () => {
      course.status = course.status==='active'?'completed':'active';
      await apiFetch('PUT',`/panchakarma/course/${course.id}`, {
        patient_name:course.patient_name, phone:course.phone,
        therapies:course.therapies, start_date:course.start_date,
        total_days:course.total_days, status:course.status
      });
      await loadCourses();
      openCourseView(courseId);
      render();
    };

    const nextDay = days.length+1;
    $('#pkDayForm').reset();
    $('#pkDayNumber').value = nextDay;
    $('#pkDayDate').value   = today();
    $('#pkDayTherapy').innerHTML = therapies.map(t=>`<option value="${safe(t)}">${safe(t)} — ₹${(THERAPY_PRICE[t]||0).toLocaleString('en-IN')}</option>`).join('');
    // Auto-fill price when therapy changes
    $('#pkDayTherapy').onchange = () => {
      const selectedTherapy = $('#pkDayTherapy').value.split(' —')[0];
      const price = THERAPY_PRICE[selectedTherapy] || 0;
      if (price > 0 && !$('#pkDayPayment').value) $('#pkDayPayment').value = price;
    };
    // Trigger for first option
    const firstTherapy = therapies[0];
    if (firstTherapy && !$('#pkDayPayment').value) {
      $('#pkDayPayment').value = THERAPY_PRICE[firstTherapy] || '';
    }
    $('#pkDayForm').querySelector('button[type=submit]').textContent = 'Save Day';
    editingDayId = null;

    $('#pkCourseView').hidden = false;
    $('#pkListView').hidden   = true;
  }

  function closeCourseView() {
    $('#pkCourseView').hidden = true;
    $('#pkListView').hidden   = false;
    activeCourseId = null;
    render();
  }

  // ── Course form ────────────────────────────────────────────────────────────
  function openCourseForm(course) {
    $('#pkCourseForm').reset();
    $('#pkCourseId').value = course?.id||'';
    $('#pkFormTitle').textContent = course?'Edit Course':'New Panchakarma Course';
    $('#pkSaveBtn').textContent   = course?'Save changes':'Start course';
    $('#pkStartDate').value = course?.start_date||today();
    $('#pkTotalDays').value = course?.total_days||7;
    $('#pkPatientName').value  = course?.patient_name||'';
    $('#pkPatientPhone').value = course?.phone||'';
    $('#pkLinkedPatientId').value = course?.linked_patient_id||'';
    const therapies = Array.isArray(course?.therapies)?course.therapies:[];
    $('#pkTherapyCheckboxes').innerHTML = THERAPIES.map(t=>`
      <label class="pk-therapy-check">
        <input type="checkbox" name="therapy" value="${safe(t.name)}" ${therapies.includes(t.name)?'checked':''}>
        <span class="therapy-name">${safe(t.name)}</span>
        ${t.price ? `<span class="therapy-price">₹${t.price.toLocaleString('en-IN')} ${t.unit}</span>` : ''}
      </label>`).join('');
    $('#pkDialog').showModal();
  }

  // Patient autocomplete
  $('#pkPatientName').addEventListener('input', () => {
    const q = $('#pkPatientName').value.trim().toLowerCase();
    $('#pkLinkedPatientId').value = '';
    if (!q) { $('#pkPatientDropdown').innerHTML=''; return; }
    const matches = getPatients().filter(p=>p.name.toLowerCase().includes(q)||p.phone.includes(q)).slice(0,6);
    $('#pkPatientDropdown').innerHTML = matches.map(p=>
      `<div class="autocomplete-item" data-pid="${p.id}" data-name="${safe(p.name)}" data-phone="${safe(p.phone)}">
        <strong>${safe(p.name)}</strong> · ${safe(p.phone)}
      </div>`).join('');
  });

  $('#pkPatientDropdown').addEventListener('click', e => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    $('#pkPatientName').value     = item.dataset.name;
    $('#pkPatientPhone').value    = item.dataset.phone;
    $('#pkLinkedPatientId').value = item.dataset.pid;
    $('#pkPatientDropdown').innerHTML = '';
  });

  $('#pkCourseForm').addEventListener('submit', async e => {
    e.preventDefault();
    const therapies = $$('#pkTherapyCheckboxes input:checked').map(cb=>cb.value);
    if (!therapies.length) { alert('Please select at least one therapy.'); return; }
    const id = $('#pkCourseId').value;
    const data = { id:id||newId(), patient_name:$('#pkPatientName').value.trim(),
      phone:$('#pkPatientPhone').value.trim(), linked_patient_id:$('#pkLinkedPatientId').value||null,
      therapies, start_date:$('#pkStartDate').value, total_days:Number($('#pkTotalDays').value), status:'active' };
    if (!data.patient_name||!data.phone) { alert('Patient name and phone are required.'); return; }
    if (id) await apiFetch('PUT',`/panchakarma/course/${id}`,data);
    else    await apiFetch('POST','/panchakarma/course',data);
    $('#pkDialog').close();
    await loadCourses();
    $('#pkListView').hidden   = false;
    $('#pkCourseView').hidden = true;
    render();
    toast(id?'Course updated.':'Panchakarma course started!');
  });

  // Day form
  $('#pkDayForm').addEventListener('submit', async e => {
    e.preventDefault();
    const dayData = { id:editingDayId||newId(), course_id:activeCourseId,
      day_number:Number($('#pkDayNumber').value), date:$('#pkDayDate').value,
      therapy:$('#pkDayTherapy').value, payment:Number($('#pkDayPayment').value||0),
      notes:$('#pkDayNotes').value.trim(), done:true };
    if (editingDayId) await apiFetch('PUT',`/panchakarma/day/${editingDayId}`,dayData);
    else              await apiFetch('POST','/panchakarma/day',dayData);
    editingDayId = null;
    await loadCourses();
    openCourseView(activeCourseId);
    toast('Day recorded!');
  });

  // Day list actions
  $('#pkDayList').addEventListener('click', async e => {
    const course = courses.find(c=>c.id===activeCourseId);
    if (!course) return;
    const editId   = e.target.dataset.pkDayEdit;
    const deleteId = e.target.dataset.pkDayDelete;
    if (deleteId) {
      if (!confirm('Delete this day record?')) return;
      await apiFetch('DELETE',`/panchakarma/day/${deleteId}`);
      await loadCourses();
      openCourseView(activeCourseId);
      return;
    }
    if (editId) {
      const day = (course.days||[]).find(d=>d.id===editId);
      if (!day) return;
      editingDayId = editId;
      $('#pkDayNumber').value = day.day_number;
      $('#pkDayDate').value   = day.date;
      $('#pkDayTherapy').value= day.therapy;
      $('#pkDayPayment').value= day.payment;
      $('#pkDayNotes').value  = day.notes||'';
      $('#pkDayForm').querySelector('button[type=submit]').textContent = 'Update Day';
    }
  });

  // Course list actions
  $('#pkTableBody').addEventListener('click', async e => {
    const openId   = e.target.dataset.pkOpen;
    const editId   = e.target.dataset.pkEdit;
    const deleteId = e.target.dataset.pkDelete;
    if (openId)   openCourseView(openId);
    if (editId)   openCourseForm(courses.find(c=>c.id===editId));
    if (deleteId) {
      if (!confirm('Delete this course and all day records?')) return;
      await apiFetch('DELETE',`/panchakarma/course/${deleteId}`);
      await loadCourses();
      render();
      toast('Course deleted.');
    }
  });

  // Export
  $('#pkExportBtn').addEventListener('click', () => {
    const rows = [['Patient','Phone','Therapies','Start Date','Total Days','Days Done','Total Paid','Status']];
    courses.forEach(c => {
      const done = (c.days||[]).filter(d=>d.done).length;
      const paid = (c.days||[]).reduce((s,d)=>s+Number(d.payment||0),0);
      rows.push([c.patient_name,c.phone,(c.therapies||[]).join('+'),c.start_date,c.total_days,done,paid,c.status]);
    });
    const blob = new Blob([rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`panchakarma-${today()}.csv`;a.click();
  });

  $('#pkAddBtn').onclick       = () => openCourseForm();
  $('#pkBackBtn').onclick      = closeCourseView;
  $('#pkSearch').addEventListener('input', render);
  $('#pkStatusFilter').addEventListener('change', render);
  $('#pkCloseDialog').onclick  = () => $('#pkDialog').close();
  $('#pkCancelDialog').onclick = () => $('#pkDialog').close();
  $('#pkDialog').addEventListener('click', e=>{if(e.target===$('#pkDialog'))$('#pkDialog').close();});

  async function showView() {
    document.querySelectorAll('main > *').forEach(v=>v.hidden=true);
    $('#panchakarmaView').hidden = false;
    $('#pkListView').hidden      = false;
    $('#pkCourseView').hidden    = true;
    document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='panchakarma'));
    if ($('#pageEyebrow')) $('#pageEyebrow').textContent = '';
    if ($('#pageTitle'))   $('#pageTitle').textContent   = 'पंचकर्म';
    await loadCourses();
    render();
  }

  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view==='panchakarma') {
      a.addEventListener('click', e => { e.preventDefault(); location.hash='#panchakarma'; showView(); });
    }
  });

  window.addEventListener('hashchange', () => {
    if (location.hash==='#panchakarma') showView();
  });

  if (location.hash==='#panchakarma') showView();
})();
