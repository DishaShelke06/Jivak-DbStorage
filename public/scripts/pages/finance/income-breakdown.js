(() => {
  const $ = s => document.querySelector(s);
  const money = v => '₹' + Number(v||0).toLocaleString('en-IN');
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let summaryData = null;
  let activePeriod = 'daily';
  const now = new Date();
  let selectedYear  = now.getFullYear();
  let selectedMonth = now.getMonth() + 1;
  let selectedDate  = now.toISOString().slice(0,10);

  function getToken() { return localStorage.getItem('jivak-api-token'); }

  async function loadSummary() {
    try {
      const m = String(selectedMonth).padStart(2,'0');
      const y = String(selectedYear);
      const res = await fetch(`/api/expenses/summary?month=${m}&year=${y}&date=${selectedDate}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      summaryData = await res.json();
      renderBreakdown();
    } catch(e) { console.error('Income breakdown error:', e); }
  }

  function renderControls() {
    const ctrl = $('#breakdownControls');
    if (!ctrl) return;

    if (activePeriod === 'daily') {
      ctrl.innerHTML = `<input type="date" id="bdDate" value="${selectedDate}" style="padding:7px 12px;border:1.5px solid var(--line);border-radius:7px;font-size:13px;font-family:inherit" />`;
      $('#bdDate').addEventListener('change', e => { selectedDate = e.target.value; loadSummary(); });
    }

    if (activePeriod === 'monthly') {
      const monthOpts = MONTH_NAMES.map((m,i) => `<option value="${i+1}" ${i+1===selectedMonth?'selected':''}>${m}</option>`).join('');
      const yearOpts = [2024,2025,2026,2027,2028].map(y => `<option value="${y}" ${y===selectedYear?'selected':''}>${y}</option>`).join('');
      ctrl.innerHTML = `
        <select id="bdMonth" style="padding:7px 12px;border:1.5px solid var(--line);border-radius:7px;font-size:13px;font-family:inherit;background:var(--white);cursor:pointer">${monthOpts}</select>
        <select id="bdYear" style="padding:7px 12px;border:1.5px solid var(--line);border-radius:7px;font-size:13px;font-family:inherit;background:var(--white);cursor:pointer">${yearOpts}</select>`;
      $('#bdMonth').addEventListener('change', e => { selectedMonth = Number(e.target.value); loadSummary(); });
      $('#bdYear').addEventListener('change',  e => { selectedYear  = Number(e.target.value); loadSummary(); });
    }

    if (activePeriod === 'yearly') {
      const yearOpts = [2024,2025,2026,2027,2028].map(y => `<option value="${y}" ${y===selectedYear?'selected':''}>${y}</option>`).join('');
      ctrl.innerHTML = `<select id="bdYear" style="padding:7px 12px;border:1.5px solid var(--line);border-radius:7px;font-size:13px;font-family:inherit;background:var(--white);cursor:pointer">${yearOpts}</select>`;
      $('#bdYear').addEventListener('change', e => { selectedYear = Number(e.target.value); loadSummary(); });
    }
  }

  function renderBreakdown() {
    if (!summaryData) return;
    const d = summaryData;
    let html = '';

    if (activePeriod === 'daily') {
      html = `
        <div class="breakdown-stats">
          <div class="breakdown-stat income-stat">
            <div class="bs-label">Income</div>
            <div class="bs-value income">${money(d.daily_income)}</div>
          </div>
          <div class="breakdown-stat expense-stat">
            <div class="bs-label">Expense</div>
            <div class="bs-value expense">${money(d.daily_expense)}</div>
          </div>
          <div class="breakdown-stat profit-stat">
            <div class="bs-label">Profit</div>
            <div class="bs-value ${d.daily_profit>=0?'income':'expense'}">${money(d.daily_profit)}</div>
          </div>
        </div>`;
    }

    if (activePeriod === 'monthly') {
      const max = Math.max(...(d.all_months||[]).map(m=>Math.max(m.income||0,m.expense||0)),1);
      const barsHTML = (d.all_months||[]).map(m=>`
        <div class="month-bar-group">
          <div class="month-bars">
            <div class="month-bar income-bar" style="height:${Math.round((m.income/max)*80)}px" title="Income: ${money(m.income)}"></div>
            <div class="month-bar expense-bar" style="height:${Math.round((m.expense/max)*80)}px" title="Expense: ${money(m.expense)}"></div>
          </div>
          <div class="month-label">${MONTH_NAMES[parseInt(m.month)-1]}</div>
        </div>`).join('');

      html = `
        <div class="breakdown-stats">
          <div class="breakdown-stat income-stat"><div class="bs-label">Income</div><div class="bs-value income">${money(d.income)}</div></div>
          <div class="breakdown-stat expense-stat"><div class="bs-label">Expense</div><div class="bs-value expense">${money(d.expense)}</div></div>
          <div class="breakdown-stat profit-stat"><div class="bs-label">Profit</div><div class="bs-value ${d.profit>=0?'income':'expense'}">${money(d.profit)}</div></div>
        </div>
        ${d.all_months?.length ? `
        <div class="month-chart">
          <div class="chart-title">Monthly Income vs Expense (${selectedYear})</div>
          <div class="chart-legend">
            <span class="legend-dot income-dot"></span> Income &nbsp;
            <span class="legend-dot expense-dot"></span> Expense
          </div>
          <div class="bars-wrap">${barsHTML}</div>
        </div>` : ''}
        ${d.top_categories?.length ? `
        <div class="top-categories">
          <div class="chart-title">Top Income Sources — ${MONTH_NAMES[selectedMonth-1]} ${selectedYear}</div>
          ${d.top_categories.map(c=>`
            <div class="category-row">
              <span class="category-name">${c.category||'Uncategorized'}</span>
              <div class="category-bar-wrap"><div class="category-bar" style="width:${Math.round((c.total/Math.max(d.income,1))*100)}%"></div></div>
              <span class="category-amount">${money(c.total)}</span>
            </div>`).join('')}
        </div>` : ''}`;
    }

    if (activePeriod === 'yearly') {
      html = `
        <div class="breakdown-stats">
          <div class="breakdown-stat income-stat"><div class="bs-label">Year Income (${selectedYear})</div><div class="bs-value income">${money(d.yearly_income)}</div></div>
          <div class="breakdown-stat expense-stat"><div class="bs-label">Year Expense</div><div class="bs-value expense">${money(d.yearly_expense)}</div></div>
          <div class="breakdown-stat profit-stat"><div class="bs-label">Year Profit</div><div class="bs-value ${d.yearly_profit>=0?'income':'expense'}">${money(d.yearly_profit)}</div></div>
        </div>
        ${d.all_months?.length ? `
        <div class="top-categories">
          <div class="chart-title">Month-wise Income — ${selectedYear}</div>
          ${d.all_months.map(m=>`
            <div class="category-row">
              <span class="category-name">${MONTH_NAMES[parseInt(m.month)-1]}</span>
              <div class="category-bar-wrap"><div class="category-bar" style="width:${Math.round(((m.income||0)/Math.max(d.yearly_income,1))*100)}%"></div></div>
              <span class="category-amount">${money(m.income)}</span>
            </div>`).join('')}
        </div>` : ''}`;
    }

    $('#breakdownContent').innerHTML = html;
  }

  // Tab switching
  document.querySelectorAll('.breakdown-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activePeriod = btn.dataset.period;
      document.querySelectorAll('.breakdown-tab').forEach(b => b.classList.toggle('active', b===btn));
      renderControls();
      loadSummary();
    });
  });

  // Load when finance tab opens
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view==='finance') a.addEventListener('click', () => setTimeout(()=>{renderControls();loadSummary();},100));
  });
  window.addEventListener('hashchange', () => {
    if (location.hash==='#finance') { renderControls(); loadSummary(); }
  });

  window.reloadIncomeBreakdown = () => { renderControls(); loadSummary(); };
  if (location.hash==='#finance') { renderControls(); loadSummary(); }
})();
