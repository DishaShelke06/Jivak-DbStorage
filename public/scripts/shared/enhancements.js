(() => {
  const $ = s => document.querySelector(s);
  const token = () => localStorage.getItem('jivak-api-token');

  async function apiFetch(method, path) {
    const res = await fetch('/api' + path, { method, headers: { 'Authorization': `Bearer ${token()}` } });
    return res.json();
  }

  // Delete patient via API when delete button is clicked
  $('#patientTableBody').addEventListener('click', async e => {
    const id = e.target.dataset.deletePatient;
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Let patients.js handle it — it already has delete logic
  }, { capture: false });

  // Medicine rows: remove required from med-name inputs so empty rows don't block submit
  const medicineObserver = new MutationObserver(entries =>
    entries.forEach(e => e.addedNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('medicine-row'))
        n.querySelectorAll('input[required]').forEach(i => i.required = false);
    }))
  );
  const medicineRows = $('#medicineRows');
  if (medicineRows) {
    medicineObserver.observe(medicineRows, { childList: true });
    medicineRows.querySelectorAll('input[required]').forEach(i => i.required = false);
  }
})();
