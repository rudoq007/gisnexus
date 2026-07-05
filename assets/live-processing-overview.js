(function () {
  const DATA_URL = 'data/live_processing_status.json?v=' + Date.now();

  function formatNumber(value, digits) {
    if (value === null || value === undefined || value === '') return 'No data';
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : String(value);
  }

  function rowsFromData(data) {
    if (!data) return [];
    if (Array.isArray(data.province_summary)) return data.province_summary;
    if (Array.isArray(data.provincial_summary)) return data.provincial_summary;
    return [];
  }

  function ensureSection() {
    let section = document.getElementById('liveProcessingProvinceSummaryCard');
    if (section) return section;

    const anchor = document.getElementById('liveWorkspaceOverviewCard');
    if (!anchor || !anchor.parentElement) return null;

    section = document.createElement('section');
    section.id = 'liveProcessingProvinceSummaryCard';
    section.className = 'card full';
    section.innerHTML = [
      '<span class="eyebrow">PNG live processing workspace</span>',
      '<h2>Provincial drought and frost screening summary</h2>',
      '<p class="note"><b>Source:</b> This table is read from the <code>province_summary</code> array in <code>data/live_processing_status.json</code>. It is intended to mirror the by-province screening summary generated in the separate Streamlit live processing workspace.</p>',
      '<div class="tablewrap">',
      '<table id="liveProcessingProvinceTable">',
      '<thead><tr><th>Province</th><th>Rainfall % normal</th><th>Drought interpretation</th><th>Mean night LST °C</th><th>Frost interpretation</th></tr></thead>',
      '<tbody><tr><td colspan="5">Waiting for provincial summary data.</td></tr></tbody>',
      '</table>',
      '</div>'
    ].join('');

    anchor.insertAdjacentElement('afterend', section);
    return section;
  }

  function renderTable(data) {
    ensureSection();
    const tableBody = document.querySelector('#liveProcessingProvinceTable tbody');
    if (!tableBody) return;

    const rows = rowsFromData(data);
    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="5">No province summary found yet. Add a <code>province_summary</code> array to <code>data/live_processing_status.json</code> to mirror the Streamlit by-province table.</td></tr>';
      return;
    }

    tableBody.innerHTML = rows.map((row) => {
      const province = row.province || row.Province || 'Unknown';
      const rainfall = row.rainfall_pct_normal ?? row.rainfall_percent_normal ?? row.rainfall_percentage_of_normal ?? row.rainfall;
      const drought = row.drought_interpretation || row.drought_class || row.drought_status || 'No data';
      const frostVal = row.mean_night_lst_c ?? row.mean_night_lst ?? row.mean_lst_c ?? row.lst_c;
      const frost = row.frost_interpretation || row.frost_class || row.frost_status || 'No data';
      return '<tr>' +
        '<td><b>' + province + '</b></td>' +
        '<td>' + formatNumber(rainfall, 1) + '</td>' +
        '<td>' + drought + '</td>' +
        '<td>' + (frostVal === null || frostVal === undefined || frostVal === '' ? 'No data' : formatNumber(frostVal, 1)) + '</td>' +
        '<td>' + frost + '</td>' +
        '</tr>';
    }).join('');
  }

  fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error('live processing status JSON unavailable');
      return r.json();
    })
    .then(renderTable)
    .catch(() => renderTable(null));
})();
