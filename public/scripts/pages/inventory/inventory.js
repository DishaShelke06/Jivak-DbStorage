(() => {
  const $ = s => document.querySelector(s);
  let medicines = [];

  const token = () => localStorage.getItem('jivak-api-token');
  const safe  = v => { const d = document.createElement('div'); d.textContent = v||''; return d.innerHTML; };
  const money = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v||0);
  const fmtDay = v => { try { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${v}T00:00:00`)); } catch { return v||''; } };

  async function apiFetch(method, path, body) {
    const opts = { method, headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`} };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api'+path, opts);
    if (!res.ok) { const e = await res.json().catch(()=>({error:'Error'})); throw new Error(e.error); }
    return res.json();
  }

  async function loadMedicines() {
    try {
      const data = await apiFetch('GET', '/medicines');
      medicines = Array.isArray(data) ? data : [];
      // Sync to localStorage for autocomplete compatibility
      localStorage.setItem('jivak-inventory-v1', JSON.stringify(medicines.map(m => ({
        id: String(m.id), name: m.name, brand: m.brand, category: m.category,
        quantity: m.quantity, lowStock: m.low_stock_threshold,
        expiry: m.expiry_date, purchasePrice: m.purchase_price, sellingPrice: m.selling_price
      }))));
    } catch(e) { console.error('Medicines load error:', e); }
  }

  const daysToExpiry = v => Math.ceil((new Date(`${v}T00:00:00`) - new Date(new Date().toDateString())) / 864e5);
  const isExpired  = m => m.expiry_date && daysToExpiry(m.expiry_date) < 0;
  const isExpiring = m => { if (!m.expiry_date) return false; const d = daysToExpiry(m.expiry_date); return d >= 0 && d <= 30; };
  const isLow      = m => Number(m.quantity) <= Number(m.low_stock_threshold);

  function render() {
    const query    = $('#medicineSearch').value.trim().toLowerCase();
    const category = $('#categoryFilter').value;
    const cats     = [...new Set(medicines.map(m=>m.category).filter(Boolean))].sort();

    $('#categoryFilter').innerHTML = '<option value="">All categories</option>' +
      cats.map(c => `<option ${c===category?'selected':''}>${safe(c)}</option>`).join('');

    const filtered = medicines.filter(m =>
      (!query    || [m.name,m.brand,m.category].join(' ').toLowerCase().includes(query)) &&
      (!category || m.category === category)
    );

    $('#medicineTableBody').innerHTML = filtered.map(m => {
      const exp = isExpired(m) ? 'Expired' : isExpiring(m) ? `${daysToExpiry(m.expiry_date)} days left` : m.expiry_date ? fmtDay(m.expiry_date) : '—';
      const cls = isLow(m) ? 'low' : (isExpired(m)||isExpiring(m)) ? 'expiring' : '';
      return `<tr>
        <td><span class="patient-name">${safe(m.name)}</span><span class="patient-id">${safe(m.brand||'No brand')}</span></td>
        <td>${safe(m.category||'—')}</td>
        <td><span class="stock ${isLow(m)?'low':''}"><i class="stock-dot"></i>${m.quantity} <small>/ alert at ${m.low_stock_threshold}</small></span></td>
        <td><span class="stock ${cls}"><i class="stock-dot"></i>${exp}</span></td>
        <td>${money(m.purchase_price)} <span class="patient-id">/ ${money(m.selling_price)}</span></td>
        <td><div class="row-actions">
          <button class="link-button" data-restock="${m.id}">Adjust stock</button>
          <button class="link-button" data-edit-medicine="${m.id}">Edit</button>
          <button class="link-button danger" data-delete-medicine="${m.id}">Delete</button>
        </div></td>
      </tr>`;
    }).join('');

    $('#medicineEmptyState').hidden = medicines.length > 0;
    $('#medicineResultsText').textContent = medicines.length
      ? `${filtered.length} of ${medicines.length} medicine${medicines.length===1?'':'s'} shown`
      : 'No medicines have been added yet.';

    const lowItems    = medicines.filter(isLow);
    const expiryItems = medicines.filter(m => isExpiring(m)||isExpired(m));
    $('#medicineCount').textContent  = medicines.length;
    $('#lowStockCount').textContent  = lowItems.length;
    $('#expiryCount').textContent    = expiryItems.length;
    $('#inventoryAlerts').innerHTML  =
      (lowItems.length    ? `<div class="inventory-alert warning"><strong>Low stock:</strong> ${safe(lowItems.map(m=>m.name).join(', '))}</div>` : '') +
      (expiryItems.length ? `<div class="inventory-alert expiry"><strong>Expiry attention:</strong> ${safe(expiryItems.map(m=>m.name).join(', '))}</div>` : '');
  }

  function openMedicine(m) {
    $('#medicineForm').reset();
    $('#medicineId').value            = m?.id || '';
    $('#medicineFormEyebrow').textContent = m ? 'Edit medicine' : 'New medicine';
    $('#medicineFormTitle').textContent   = m ? 'Update medicine stock' : 'Add medicine to stock';
    if (m) {
      $('#medicineName').value         = m.name || '';
      $('#medicineBrand').value        = m.brand || '';
      $('#medicineQuantity').value     = m.quantity ?? '';
      $('#medicineLowStock').value     = m.low_stock_threshold ?? 10;
      $('#medicineExpiry').value       = m.expiry_date || '';
      $('#medicineCategory').value     = m.category || '';
      $('#medicinePurchasePrice').value = m.purchase_price ?? '';
      $('#medicineSellingPrice').value  = m.selling_price ?? '';
    } else {
      $('#medicineLowStock').value = 10;
    }
    $('#medicineDialog').showModal();
    setTimeout(() => $('#medicineName').focus(), 50);
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  }

  $('#medicineForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
    const id   = $('#medicineId').value;
    const data = {
      name:                $('#medicineName').value.trim(),
      brand:               $('#medicineBrand').value.trim(),
      quantity:            Number($('#medicineQuantity').value),
      low_stock_threshold: Number($('#medicineLowStock').value),
      expiry_date:         $('#medicineExpiry').value,
      category:            $('#medicineCategory').value.trim(),
      purchase_price:      Number($('#medicinePurchasePrice').value),
      selling_price:       Number($('#medicineSellingPrice').value),
    };
    try {
      if (id) await apiFetch('PUT',  `/medicines/${id}`, data);
      else    await apiFetch('POST', '/medicines', data);
      $('#medicineDialog').close();
      await loadMedicines();
      render();
      toast(id ? 'Medicine updated.' : 'Medicine added to inventory.');
    } catch(err) { alert('Error: ' + err.message); }
  });

  $('#medicineTableBody').addEventListener('click', async e => {
    const editId   = e.target.dataset.editMedicine;
    const restockId= e.target.dataset.restock;
    const deleteId = e.target.dataset.deleteMedicine;

    if (editId)   { openMedicine(medicines.find(m => String(m.id)===String(editId))); return; }
    if (deleteId) {
      const m = medicines.find(x => String(x.id)===String(deleteId));
      if (!m || !confirm(`Delete ${m.name}?`)) return;
      try { await apiFetch('DELETE', `/medicines/${deleteId}`); await loadMedicines(); render(); toast('Medicine deleted.'); }
      catch(err) { alert('Error: ' + err.message); }
      return;
    }
    if (restockId) {
      const m = medicines.find(x => String(x.id)===String(restockId));
      if (!m) return;
      const value = prompt(`Set current quantity for ${m.name}:`, m.quantity);
      if (value === null || value === '' || isNaN(Number(value))) return;
      try {
        await apiFetch('PUT', `/medicines/${restockId}`, { ...m, quantity: Number(value), expiry_date: m.expiry_date });
        await loadMedicines(); render();
        toast('Stock updated.');
      } catch(err) { alert('Error: ' + err.message); }
    }
  });

  // Expose for visits.js to deduct stock
  window.JivakInventory = {
    getMedicines: () => medicines,
    refresh: async () => { await loadMedicines(); render(); }
  };

  $('#addMedicineInventoryBtn').onclick  = () => openMedicine();
  $('#emptyAddMedicineBtn').onclick      = () => openMedicine();
  $('#closeMedicineDialog').onclick      = () => $('#medicineDialog').close();
  $('#cancelMedicineDialog').onclick     = () => $('#medicineDialog').close();
  $('#medicineDialog').addEventListener('click', e => { if(e.target===$('#medicineDialog')) $('#medicineDialog').close(); });
  $('#medicineSearch').addEventListener('input', render);
  $('#categoryFilter').addEventListener('change', render);

  // Load on nav
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view === 'inventory') a.addEventListener('click', () => setTimeout(() => { loadMedicines().then(render); }, 100));
  });
  window.addEventListener('hashchange', () => { if(location.hash==='#inventory') loadMedicines().then(render); });

  loadMedicines().then(render);
})();
