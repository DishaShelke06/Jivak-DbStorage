(() => {
  const $ = s => document.querySelector(s);
  const token = () => localStorage.getItem('jivak-api-token');
  const money = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v||0);
  const today = () => new Date().toISOString().slice(0,10);

  async function apiFetch(method, path, body) {
    const opts = { method, headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`} };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api'+path, opts);
    if (!res.ok) throw new Error('API error');
    return res.json();
  }

  function getMedicines() {
    return window.JivakInventory?.getMedicines?.() || [];
  }

  function selected() {
    const id = $('#saleMedicine').value;
    return getMedicines().find(m => String(m.id) === String(id));
  }

  function update() {
    const m = selected();
    const q = Number($('#saleQuantity').value) || 1;
    if (!m) { $('#saleTotal').textContent = 'Select a medicine to calculate total.'; return; }
    const total = q * Number(m.selling_price);
    $('#saleTotal').textContent = `Total: ${money(total)} (${m.quantity} units in stock)`;
  }

  function open() {
    const meds = getMedicines().filter(m => m.quantity > 0);
    if (!meds.length) { alert('No medicines in stock.'); return; }
    $('#saleForm').reset();
    $('#saleDate').value = today();
    $('#saleMedicine').innerHTML = '<option value="" disabled selected>Select medicine</option>' +
      meds.map(m => `<option value="${m.id}">${m.name} — ${money(m.selling_price)} (${m.quantity} left)</option>`).join('');
    update();
    $('#saleDialog').showModal();
  }

  $('#recordSaleBtn').onclick  = open;
  $('#saleMedicine').onchange  = update;
  $('#saleQuantity').oninput   = update;
  $('#closeSaleDialog').onclick  = () => $('#saleDialog').close();
  $('#cancelSaleDialog').onclick = () => $('#saleDialog').close();

  $('#saleForm').onsubmit = async e => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
    const m = selected();
    const q = Number($('#saleQuantity').value);
    if (!m) { alert('Select a medicine.'); return; }
    if (q > m.quantity) { alert(`Only ${m.quantity} units in stock.`); return; }

    try {
      // Record income
      await apiFetch('POST', '/expenses', {
        type: 'income', category: 'Medicine sale',
        amount: q * Number(m.selling_price),
        description: `Medicine sale — ${m.name} × ${q}`,
        expense_date: $('#saleDate').value,
      });
      // Deduct stock
      await apiFetch('PUT', `/medicines/${m.id}`, {
        name: m.name, brand: m.brand, category: m.category,
        quantity: m.quantity - q,
        low_stock_threshold: m.low_stock_threshold,
        expiry_date: m.expiry_date,
        purchase_price: m.purchase_price,
        selling_price: m.selling_price,
      });
      $('#saleDialog').close();
      if (window.JivakInventory?.refresh) await window.JivakInventory.refresh();
      if (window.JivakFinance?.reload) await window.JivakFinance.reload();
      // Toast
      const t = $('#toast'); if(t){t.textContent='Sale recorded!';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
    } catch(err) { alert('Error recording sale: ' + err.message); }
  };
})();
