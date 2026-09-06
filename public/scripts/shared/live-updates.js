(() => {
  const refreshActiveData = () => {
    const h = location.hash.slice(1);
    if (h === 'patients' && typeof window.loadPatients === 'function') window.loadPatients();
    if (h === 'inventory') window.JivakInventory?.refresh?.();
    if (h === 'finance') window.JivakFinance?.reload?.();
    if (h === 'followups') window.JivakFollowups?.render?.();
  };

  document.querySelectorAll('#transactionForm, #saleForm, #medicineForm, #followupForm, #patientForm').forEach(f => {
    f.addEventListener('submit', () => setTimeout(refreshActiveData, 200));
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-delete-entry], [data-done], [data-delete-patient], [data-delete-medicine]')) {
      setTimeout(refreshActiveData, 200);
    }
  });
})();