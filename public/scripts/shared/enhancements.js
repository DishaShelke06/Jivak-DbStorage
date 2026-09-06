(() => {
  const medicineRows = document.querySelector('#medicineRows');
  if (medicineRows) {
    const relaxRequired = row => {
      row.querySelectorAll('input[required]').forEach(i => (i.required = false));
    };

    new MutationObserver(entries =>
      entries.forEach(e =>
        e.addedNodes.forEach(n => {
          if (n.nodeType === 1 && n.classList.contains('medicine-row')) {
            relaxRequired(n);
          }
        })
      )
    ).observe(medicineRows, { childList: true });

    relaxRequired(medicineRows);
  }
})();