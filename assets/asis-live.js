(function () {
  const DATA_URL = 'data/asis_vhi_latest.json?v=' + Date.now();

  function fmt(value, digits = 3) {
    if (value === null || value === undefined || Number.isNaN(value)) return 'No data';
    return Number(value).toFixed(digits);
  }

  function stressClass(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return 'No ASIS VHI-D data';
    if (value < 0.35) return 'High vegetation stress';
    if (value < 0.50) return 'Moderate vegetation stress';
    if (value < 0.65) return 'Watch / below-normal vegetation condition';
    return 'Lower current vegetation stress';
  }

  function makeTable(rows) {
    const body = rows
      .slice()
      .sort((a, b) => (a.mean ?? 999) - (b.mean ?? 999))
      .map((r, i) => `<tr><td>${i + 1}</td><td>${r.province}</td><td>${fmt(r.mean)}</td><td>${stressClass(r.mean)}</td></tr>`)
      .join('');
    return `<div class="tablewrap"><table><thead><tr><th>Rank</th><th>Province</th><th>Mean FAO ASIS VHI-D</th><th>Vegetation stress interpretation</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function makeLiveBlock(data, mapId) {
    const updated = data.generated_utc || 'latest run';
    const dekad = data.dekad_label || 'latest available dekad';
    const rows = Array.isArray(data.provinces) ? data.provinces : [];
    const table = makeTable(rows);
    return `
      <section class="card full">
        <span class="eyebrow">Live FAO ASIS / GIEWS feed</span>
        <h2>Live FAO ASIS VHI-D vegetation health</h2>
        <p class="note"><b>Source:</b> FAO ASIS VHI-D ImageCollection on Google Earth Engine: <code>projects/UNFAO/ASIS/VHI-D</code>. The latest available dekad is displayed after masking ASIS flag values 251–254.</p>
        <div class="metric">
          <div><span class="muted">Latest dekad</span><b>${dekad}</b></div>
          <div><span class="muted">Updated UTC</span><b>${updated}</b></div>
          <div><span class="muted">Province summaries</span><b>${rows.length}</b></div>
        </div>
        <div id="${mapId}" style="height:520px;border-radius:20px;border:1px solid var(--line);margin:14px 0;background:#dbeafe"></div>
        ${table}
      </section>`;
  }

  function addLegend(map) {
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = '<b>FAO ASIS VHI-D</b><br>' +
        '<span class="swatch" style="background:#662A00"></span>0.00–0.35 high stress<br>' +
        '<span class="swatch" style="background:#D8D8D8"></span>0.35–0.50 moderate stress<br>' +
        '<span class="swatch" style="background:#E5FFCC"></span>0.50–0.65 watch<br>' +
        '<span class="swatch" style="background:#006633"></span>&gt;0.65 healthier vegetation';
      return div;
    };
    legend.addTo(map);
  }

  function drawMap(containerId, data) {
    const el = document.getElementById(containerId);
    if (!el || !data.tile_url) return;
    const map = L.map(containerId).setView([-6.3, 146.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    L.tileLayer(data.tile_url, {
      attribution: 'FAO ASIS VHI-D via Google Earth Engine',
      opacity: 0.85
    }).addTo(map);
    addLegend(map);
  }

  function install(data) {
    const asisPanel = document.getElementById('drought');
    if (asisPanel && !document.getElementById('asisLiveMapAsisTab')) {
      const grid = asisPanel.querySelector('.grid') || asisPanel;
      grid.insertAdjacentHTML('afterbegin', makeLiveBlock(data, 'asisLiveMapAsisTab'));
      setTimeout(() => drawMap('asisLiveMapAsisTab', data), 100);
    }

    const mapPanel = document.getElementById('mapPanel');
    if (mapPanel && !document.getElementById('asisLiveMapInteractiveTab')) {
      const grid = mapPanel.querySelector('.grid') || mapPanel;
      grid.insertAdjacentHTML('afterbegin', makeLiveBlock(data, 'asisLiveMapInteractiveTab'));
      setTimeout(() => drawMap('asisLiveMapInteractiveTab', data), 100);
    }
  }

  fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error('No live ASIS JSON available yet');
      return r.json();
    })
    .then(install)
    .catch(() => {
      const asisPanel = document.getElementById('drought');
      if (asisPanel && !document.getElementById('asisLivePending')) {
        const grid = asisPanel.querySelector('.grid') || asisPanel;
        grid.insertAdjacentHTML('afterbegin', '<section id="asisLivePending" class="card full"><span class="eyebrow">Live FAO ASIS / GIEWS feed</span><h2>Live FAO ASIS VHI-D setup pending</h2><p class="warn"><b>Setup required:</b> Add the repository secret <code>EARTHENGINE_SERVICE_ACCOUNT_JSON</code>, then run the <b>Update live FAO ASIS VHI-D data</b> GitHub Action to generate <code>data/asis_vhi_latest.json</code>.</p></section>');
      }
    });
})();

(function () {
  const DATA_URL = 'data/live_processing_status.json?v=' + Date.now();

  function formatNumber(value, digits = 1) {
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
