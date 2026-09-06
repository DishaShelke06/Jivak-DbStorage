(() => {
  const $ = s => document.querySelector(s);
  const safe = v => { const d = document.createElement('div'); d.textContent = v || ''; return d.innerHTML; };
  const fmtDate = v => { try { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v + 'T00:00:00')); } catch { return v; } };
  const today = () => new Date().toISOString().slice(0, 10);
  const token = () => localStorage.getItem('jivak-api-token');

  let visits = [];

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) }
    });
    if (!res.ok) { const e = await res.json().catch(() => ({ error: 'Request failed.' })); throw new Error(e.error || 'Request failed.'); }
    return res.status === 204 ? null : res.json();
  }

  async function loadVisits() {
    try { visits = await api('/visits'); }
    catch (e) { console.error('Follow-ups load error:', e); visits = []; }
  }

  function render() {
    const withReminder = visits.filter(v => v.followup_required);
    const scheduled = withReminder
      .filter(v => !v.followup_sent)
      .sort((a, b) => (a.followup_date || '').localeCompare(b.followup_date || ''));
    const unscheduled = visits.filter(v => !v.followup_required);

    $('#followupTableBody').innerHTML = scheduled.map(v => {
      const status = v.followup_date && v.followup_date <= today() ? 'due' : 'upcoming';
      return `<tr>
        <td><span class="patient-name">${safe(v.patient_name)}</span><span class="patient-id">${safe(v.patient_phone)}</span></td>
        <td>${fmtDate(v.visit_date)}</td>
        <td>${v.followup_date ? fmtDate(v.followup_date) : '—'}</td>
        <td><span class="status ${status}">${status === 'due' ? 'Due now' : 'Upcoming'}</span></td>
        <td><div class="row-actions">
          <button class="link-button" data-send="${v.id}">Send</button>
          <button class="link-button" data-done="${v.id}">Done</button>
          <button class="link-button" data-edit="${v.id}">Edit</button>
        </div></td>
      </tr>`;
    }).join('');
    $('#followupEmptyState').hidden = scheduled.length > 0;

    $('#unscheduledVisitBody').innerHTML = unscheduled.map(v => `
      <tr>
        <td><span class="patient-name">${safe(v.patient_name)}</span><span class="patient-id">${safe(v.patient_phone)}</span></td>
        <td>${fmtDate(v.visit_date)}</td>
        <td>${safe(v.diagnosis || '—')}</td>
        <td><div class="row-actions"><button class="link-button" data-schedule="${v.id}">Enable reminder</button></div></td>
      </tr>`).join('')
      || '<tr><td colspan="4" style="text-align:center;padding:23px;color:#718078">All recorded consultations already have a follow-up status.</td></tr>';

    $('#followupResultsText').textContent = scheduled.length
      ? `${scheduled.length} reminder${scheduled.length === 1 ? '' : 's'} scheduled`
      : 'Enable a reminder from any recorded consultation.';
    $('#followupDueCount').textContent       = scheduled.filter(v => v.followup_date <= today()).length;
    $('#followupUpcomingCount').textContent  = scheduled.filter(v => v.followup_date > today()).length;
    $('#followupCompletedCount').textContent = withReminder.filter(v => v.followup_sent).length;
  }

  function openForm(visit) {
    $('#followupForm').reset();
    $('#followupVisitId').value = visit.id;
    const base = visit.followup_date || visit.visit_date;
    const d = new Date(`${base}T00:00:00`);
    if (!visit.followup_date) d.setDate(d.getDate() + 7);
    $('#followupDate').value = d.toISOString().slice(0, 10);
    $('#followupMessage').value = `Dear ${visit.patient_name}, this is a reminder from your doctor's clinic. It has been 7 days since your visit on ${fmtDate(visit.visit_date)}. Please schedule a follow-up if needed. Contact us at ${visit.patient_phone}.`;
    $('#followupDialog').showModal();
  }

  $('#unscheduledVisitBody').addEventListener('click', e => {
    const id = e.target.dataset.schedule;
    if (id) openForm(visits.find(v => String(v.id) === id));
  });

  $('#followupTableBody').addEventListener('click', async e => {
    const sendId = e.target.dataset.send, doneId = e.target.dataset.done, editId = e.target.dataset.edit;
    if (sendId) {
      try {
        const r = await api(`/followups/send/${sendId}`, { method: 'POST' });
        alert(r.message || 'Follow-up sent.');
        await loadVisits(); render();
      } catch (err) { alert(err.message.includes('Twilio') ? 'WhatsApp/SMS is not configured for this clinic yet — use "Done" once you\'ve contacted the patient directly.' : err.message); }
    }
    if (doneId) {
      try { await api(`/followups/complete/${doneId}`, { method: 'POST' }); await loadVisits(); render(); }
      catch (err) { alert(err.message); }
    }
    if (editId) openForm(visits.find(v => String(v.id) === editId));
  });

  $('#closeFollowupDialog').onclick = () => $('#followupDialog').close();
  $('#cancelFollowupDialog').onclick = () => $('#followupDialog').close();

  $('#followupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const visitId = $('#followupVisitId').value;
    try {
      await api(`/visits/${visitId}/followup`, {
        method: 'PUT',
        body: JSON.stringify({ followup_required: true, followup_date: $('#followupDate').value })
      });
      $('#followupDialog').close();
      await loadVisits();
      render();
    } catch (err) { alert(err.message); }
  });

  async function refresh() { await loadVisits(); render(); }
  window.JivakFollowups = { render: refresh };

  if (!document.getElementById('followupsView')?.hidden) refresh();
})();
