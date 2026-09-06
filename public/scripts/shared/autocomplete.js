(() => {
  const $ = s => document.querySelector(s);
  const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };

  // Common conditions this clinic treats, used as a base suggestion list for the diagnosis field.
  const COMMON_DISEASES = ['Fever', 'Frozen shoulder', 'Common cold', 'Cough', 'Migraine', 'Headache',
    'Back pain', 'Knee pain', 'Joint pain', 'Acidity', 'Indigestion', 'Constipation', 'Diarrhea',
    'Skin allergy', 'Eczema', 'Psoriasis', 'Sinusitis', 'Asthma', 'Bronchitis', 'Hypertension',
    'Diabetes', 'Thyroid disorder', 'Insomnia', 'Anxiety', 'Arthritis', 'Sciatica', 'Piles',
    'Kidney stones', 'PCOD', 'Menstrual disorder', 'Hair fall', 'Anemia', 'Urinary infection',
    'Gastritis', 'Ulcer', 'Vertigo', 'Allergic rhinitis', 'Obesity', 'Weight loss'];

  function diagnosisSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const historical = readJSON('jivak-visits-v1').map(v => v.diagnosis).filter(Boolean);
    const pool = [...new Set([...COMMON_DISEASES, ...historical])];
    return pool.filter(item => item.toLowerCase().startsWith(q)).slice(0, 7);
  }

  function medicineSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Try window.JivakInventory first (live), fallback to localStorage cache
    const stock = window.JivakInventory?.getMedicines?.() || readJSON('jivak-inventory-v1');
    const names = [...new Set(stock.map(m => m.name).filter(Boolean))];
    return names.filter(n => n.toLowerCase().startsWith(q)).slice(0, 7);
  }

  function attachAutocomplete(input, getSuggestions) {
    if (!input || input.dataset.autocompleteBound) return;
    input.dataset.autocompleteBound = 'true';
    input.setAttribute('autocomplete', 'off');

    // Wrap the field so the dropdown can be positioned under it without disturbing
    // grid/flex layouts that count on the input being a direct child.
    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const box = document.createElement('div');
    box.className = 'autocomplete-list';
    box.hidden = true;
    wrapper.appendChild(box);

    let items = [], activeIndex = -1;

    function render(matches) {
      items = matches; activeIndex = -1;
      if (!matches.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = matches.map((m, i) => `<div class="autocomplete-item" data-index="${i}">${m.replace(/</g, '&lt;')}</div>`).join('');
      box.hidden = false;
    }
    function highlight() {
      [...box.children].forEach((c, i) => c.classList.toggle('active', i === activeIndex));
    }
    function select(value) {
      input.value = value;
      box.hidden = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    input.addEventListener('input', () => render(getSuggestions(input.value)));
    input.addEventListener('focus', () => { if (input.value) render(getSuggestions(input.value)); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    input.addEventListener('keydown', e => {
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlight(); }
      else if (e.key === 'Enter') { if (activeIndex >= 0) { e.preventDefault(); select(items[activeIndex]); } }
      else if (e.key === 'Escape') { box.hidden = true; }
    });
    box.addEventListener('mousedown', e => {
      const el = e.target.closest('.autocomplete-item');
      if (!el) return;
      select(items[Number(el.dataset.index)]);
    });
  }

  window.JivakAutocomplete = { attach: attachAutocomplete, diseases: diagnosisSuggestions, medicines: medicineSuggestions };

  // Diagnosis field: one static element, present as soon as the page loads.
  function bindDiagnosis() {
    const diagnosis = $('#diagnosis');
    if (diagnosis) attachAutocomplete(diagnosis, diagnosisSuggestions);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDiagnosis);
  else bindDiagnosis();

  // Medicine name fields: rows are created dynamically, so watch for new ones.
  const rowsContainer = $('#medicineRows');
  if (rowsContainer) {
    const bindRow = row => { const nameInput = row.querySelector('.med-name'); if (nameInput) attachAutocomplete(nameInput, medicineSuggestions); };
    [...rowsContainer.querySelectorAll('.medicine-row')].forEach(bindRow);
    new MutationObserver(entries => entries.forEach(e => e.addedNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('medicine-row')) bindRow(n);
    }))).observe(rowsContainer, { childList: true });
  }
})();
