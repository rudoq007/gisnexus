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
