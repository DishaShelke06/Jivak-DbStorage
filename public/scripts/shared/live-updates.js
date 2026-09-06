(() => {
 const refresh=()=>setTimeout(()=>window.dispatchEvent(new Event('hashchange')),0);document.querySelectorAll('#transactionForm,#saleForm,#visitForm,#medicineForm,#followupForm,#patientForm').forEach(f=>f.addEventListener('submit',refresh));document.addEventListener('click',e=>{if(e.target.closest('[data-delete-entry],[data-done],[data-delete-patient]'))refresh()});
})();
