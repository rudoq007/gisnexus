/* ADAPt -- on-demand CDI report generator (Report tab)
 * Fetches the dashboard's published CDI files at click time and compiles a
 * self-contained briefing: national summary, provinces, districts, LLGs,
 * people by phase, climate drivers, trend, response guidance and links.
 * Runs entirely in the browser; nothing is uploaded or stored.
 */
(function () {
  'use strict';

  var BASE_URL = new URL('.', window.location.href).href;
  var FILES = {
    example: 'data/cdi_example_latest.json',
    archive: 'data/cdi_archive.json',
    admin: 'data/cdi_admin_latest.json',
    integrated: 'data/integrated_priority_latest.json',
    fire: 'https://rudoq007.github.io/PNGFireWatch/data/stats.json'
  };
  var LINKS = {
    example: BASE_URL + 'data/cdi_example_latest.json',
    archive: BASE_URL + 'data/cdi_archive.json',
    admin: BASE_URL + 'data/cdi_admin_latest.json',
    districtCsv: BASE_URL + 'data/cdi_district_latest.csv',
    llgCsv: BASE_URL + 'data/cdi_llg_latest.csv',
    pixelTif: BASE_URL + 'data/cdi_pixel_latest.tif',
    pngnws3mo: 'https://www.pngmet.gov.pg/nwp/three-months-forecasts/',
    pngnws31d: 'https://www.pngmet.gov.pg/nwp/thirty-one-days-forecasts/',
    earthmap: 'https://png.earthmap.org'
  };
  var PALETTE = { Response: '#a50026', AA: '#fdae61', Readiness: '#abd9e9', Monitoring: '#cbd5e1', NoData: '#e2e8f0' };
  var MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var chartInstances = {};
  var HR = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f2(n) { return n == null || isNaN(n) ? '--' : Number(n).toFixed(2); }
  function fi(n) { return n == null || isNaN(n) ? '--' : Math.round(n).toLocaleString('en-US'); }
  function pc(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : '--'; }
  function phase(v) {
    if (v == null || isNaN(v)) return { label: 'No data', cls: 'NoData' };
    if (v >= 0.8) return { label: 'Response', cls: 'Response' };
    if (v >= 0.6) return { label: 'Anticipatory Action', cls: 'AA' };
    if (v >= 0.4) return { label: 'Readiness', cls: 'Readiness' };
    return { label: 'Monitoring', cls: 'Monitoring' };
  }
  function pill(v) { var p = phase(v); return '<span class="pill ' + p.cls + '">' + p.label + '</span>'; }
  function pillLabel(l) { var cls = l === 'Response' ? 'Response' : l === 'Anticipatory Action' ? 'AA' : l === 'Readiness' ? 'Readiness' : l === 'Monitoring' ? 'Monitoring' : 'NoData'; return '<span class="pill ' + cls + '">' + esc(l) + '</span>'; }
  function mlabel(m) { return m ? MONTHS[m[1]] + ' ' + m[0] : ''; }
  function flagLabel(f) { return f >= 1 ? 'Declared' : f >= 0.5 ? 'Alert' : 'OK'; }

  function fetchJson(url, optional) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    }).catch(function (e) { if (optional) return null; throw e; });
  }
  function fetchAll() {
    return Promise.all([fetchJson(FILES.example), fetchJson(FILES.archive), fetchJson(FILES.admin, true), fetchJson(FILES.integrated, true), fetchJson(FILES.fire, true)])
      .then(function (r) { return { example: r[0], archive: r[1], admin: r[2], integrated: r[3], fire: r[4] }; });
  }

  function provinces(data) {
    var ex = data.example.provinces || {}, hist = data.archive.cdi_history || {}, adm = {};
    ((data.admin && data.admin.provinces) || []).forEach(function (p) { adm[p.name] = p; });
    return Object.keys(ex).map(function (n) {
      var h = hist[n] || [], a = adm[n] || {};
      return { name: n, cdi: ex[n].cdi, prev: h.length > 1 ? h[h.length - 2] : null, ind: ex[n], adm: a };
    }).sort(function (a, b) { return b.cdi - a.cdi; });
  }
  function national(data) {
    var tl = data.archive.timeline, hist = data.archive.cdi_history, names = Object.keys(hist);
    return tl.map(function (m, i) {
      var v = names.map(function (n) { return hist[n][i]; }).filter(function (x) { return x != null; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    });
  }

  function fv(a) { return Array.isArray(a) ? a[0] : a; }
  var FALIAS = { 'Chimbu (Simbu)': 'Chimbu', 'Northern (Oro)': 'Oro', 'West Sepik (Sandaun)': 'Sandaun', 'Autonomous Region of Bougainville': 'Bougainville' };
  function fname(x) { x = String(x).replace(/ Province$/, ''); return FALIAS[x] || x; }
  function fnorm(x) { return String(x || '').toLowerCase().replace(/\b(district|province)\b/g, '').replace(/[^a-z]/g, ''); }
  function fx(r) { return r == null ? 'new' : Number(r).toFixed(1) + '×'; }
  function buildHeader(data) {
    var ex = data.example, f = data.fire;
    return '<span class="eyebrow">ADAPt briefing</span><h2>Drought and fire in Papua New Guinea: ' + esc(ex.reporting_month_label || '') + '</h2>' +
      '<p class="small">Drought: CDI ' + esc(ex.reporting_month_label || '--') + ' report (' + esc(ex.observation_month_label || '--') + ' observations; forecast window ' + esc(ex.forecast_window_label || '--') + ')' +
      (f ? ' · Fire: PNG Fire Watch, ' + esc(f.season.label) + ' (updated ' + esc(f.season.updated) + ')' : '') +
      ' · Generated ' + esc(new Date().toISOString().slice(0, 16).replace('T', ' ')) + ' UTC from ' + esc(BASE_URL) + '</p>';
  }
  function buildSummary(data, rows) {
    var nat = rows.reduce(function (a, r) { return a + r.cdi; }, 0) / rows.length;
    var ns = national(data), prev = ns.length > 1 ? ns[ns.length - 2] : null;
    var c = function (l) { return rows.filter(function (r) { return phase(r.cdi).label === l; }).length; };
    var adm = data.admin, s = '';
    s += '<h3>Summary</h3><h4>Drought (CDI)</h4><ul>';
    s += '<li>National average CDI <b>' + f2(nat) + '</b> ' + pill(nat) + (prev != null ? ' (last month ' + f2(prev) + ')' : '') + '.</li>';
    s += '<li><b>' + c('Response') + '</b> of ' + rows.length + ' provinces at the Response threshold, <b>' + c('Anticipatory Action') + '</b> in Anticipatory Action, <b>' + c('Readiness') + '</b> in Readiness.</li>';
    if (adm) {
      var sd = adm.summary.districts, sl = adm.summary.llgs;
      s += '<li><b>' + sd.Response.units + '</b> of ' + adm.districts.length + ' districts and <b>' + sl.Response.units + '</b> of ' + adm.llgs.length + ' LLGs have an average CDI at Response level.</li>';
      s += '<li>About <b>' + fi(sl.Response.population_2024) + '</b> people (NSO 2024) live in Response-level LLGs and <b>' + fi(sl['Anticipatory Action'].population_2024) + '</b> in Anticipatory Action LLGs.</li>';
    }
    var top = rows.slice(0, 5).map(function (r) { return esc(r.name) + ' (' + f2(r.cdi) + ')'; }).join(', ');
    s += '<li>Highest provinces: ' + top + '.</li></ul>';
    var f = data.fire;
    if (f) {
      var n = f.national, tp = f.provinces.slice().sort(function (a, b) { return fv(b.now) - fv(a.now); }).slice(0, 3);
      s += '<h4>Fire (' + esc(f.season.label) + ')</h4><ul>';
      s += '<li><b>' + fi(fv(n.now)) + '</b> satellite fire alerts: <b>' + fx(fv(n.ratio)) + '</b> the 2012–2025 average for the same weeks.</li>';
      s += '<li>' + (fv(n.rank) === 1 ? 'The <b>highest</b> season' : 'Ranked <b>' + fv(n.rank) + '</b>') + ' since 2012, compared with ' + fi(fv(n.years['2015'])) + ' alerts in the 2015 El Niño season.</li>';
      s += '<li>Most alerts: ' + tp.map(function (p) { return esc(fname(p.name)) + ' (' + fi(fv(p.now)) + ')'; }).join(', ') + '.</li>';
      var fl = n.flags || {}, base = fv(fl._base) || fv(n.now);
      s += '<li>' + pc(fv(fl.tcd30), base) + ' of alerts fell in tree cover and ' + pc(fv(fl.primary), base) + ' in primary forest.</li></ul>';
    } else {
      s += '<p class="small">Fire data from PNG Fire Watch could not be loaded when this report was generated.</p>';
    }
    return s;
  }
  function buildProvinces(data, rows) {
    var s = '<h3>Provinces</h3><div style="height:520px"><canvas id="reportCdiChart"></canvas></div>';
    s += '<table><thead><tr><th>Province</th><th>CDI</th><th>Phase</th><th>Last month</th><th>Districts at Response</th><th>LLGs at Response</th><th>Population 2024</th><th>People in Response LLGs</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var a = r.adm;
      s += '<tr><td><b>' + esc(r.name) + '</b></td><td>' + f2(r.cdi) + '</td><td>' + pill(r.cdi) + '</td><td>' + f2(r.prev) + '</td><td>' +
        (a.district_count != null ? a.districts_in_response + ' of ' + a.district_count : '--') + '</td><td>' +
        (a.llg_count != null ? a.llgs_in_response + ' of ' + a.llg_count : '--') + '</td><td>' + fi(a.population_2024) + '</td><td>' +
        fi(a.population_by_llg_phase && a.population_by_llg_phase.Response) + '</td></tr>';
    });
    return s + '</tbody></table>';
  }
  function topTable(list, level, n, asc) {
    var l = list.filter(function (r) { return r.cdi_mean != null; }).sort(function (a, b) { return asc ? a.cdi_mean - b.cdi_mean : b.cdi_mean - a.cdi_mean; }).slice(0, n);
    return '<table><thead><tr><th>' + (level === 'llg' ? 'LLG' : 'District') + '</th>' + (level === 'llg' ? '<th>District</th>' : '') + '<th>Province</th><th>Mean CDI</th><th>Phase</th><th>Population 2024</th></tr></thead><tbody>' +
      l.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td>' + (level === 'llg' ? '<td>' + esc(r.district) + '</td>' : '') + '<td>' + esc(r.province) + '</td><td>' + f2(r.cdi_mean) + '</td><td>' + pillLabel(r.phase) + '</td><td>' + fi(r.population_2024) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function buildSubnational(data) {
    var adm = data.admin;
    if (!adm) return '<h3>Districts and LLGs</h3><p class="small">District and LLG figures are not published yet.</p>';
    var s = '<h3>Districts</h3><p class="small">Average of the ~5 km CDI pixels inside each NSO district. Half of the CDI (El Niño, Indian Ocean, rainfall forecast) is the same across a province, so district differences come from rainfall, soil moisture and vegetation.</p>';
    s += '<h4>15 highest districts</h4>' + topTable(adm.districts, 'district', 15, false);
    s += '<h4>10 lowest districts</h4>' + topTable(adm.districts, 'district', 10, true);
    s += '<h3>LLGs</h3><h4>20 highest LLGs</h4>' + topTable(adm.llgs, 'llg', 20, false);
    s += '<p class="small">Full tables: <a href="' + LINKS.districtCsv + '">districts (CSV)</a> · <a href="' + LINKS.llgCsv + '">LLGs (CSV)</a>, or the District and LLG tabs of the live dashboard.</p>';
    return s;
  }
  function buildPeople(data) {
    var adm = data.admin; if (!adm) return '';
    var sl = adm.summary.llgs, ph = ['Response', 'Anticipatory Action', 'Readiness', 'Monitoring', 'No data'];
    var tot = ph.reduce(function (a, p) { return a + ((sl[p] && sl[p].population_2024) || 0); }, 0);
    var s = '<h3>People by CDI phase</h3><p class="small">NSO 2024 census population, grouped by the phase of the LLG each person lives in.</p><div style="height:220px"><canvas id="reportPopPhaseChart" data-values="' + esc(JSON.stringify(ph.map(function (p) { return (sl[p] && sl[p].population_2024) || 0; }))) + '"></canvas></div>';
    s += '<table><thead><tr><th>Phase</th><th>LLGs</th><th>People</th><th>Share</th></tr></thead><tbody>' + ph.filter(function (p) { return sl[p] && sl[p].units; }).map(function (p) {
      return '<tr><td>' + pillLabel(p) + '</td><td>' + sl[p].units + '</td><td>' + fi(sl[p].population_2024) + '</td><td>' + pc(sl[p].population_2024, tot) + '</td></tr>';
    }).join('') + '</tbody></table>';
    return s;
  }
  function buildDrivers(data, rows) {
    var ctx = data.integrated && data.integrated.enso_iod_context, i = rows[0] ? rows[0].ind : {};
    var s = '<h3>Climate drivers</h3><div class="metric">';
    s += '<div><span class="small">El Niño (ENSO)</span><br><b>' + esc(ctx ? ctx.enso_phase : '--') + '</b><br><span class="small">' + (ctx ? 'ONI ' + f2(ctx.oni_value) + ' (' + esc(ctx.oni_period) + ')' : '') + ' · CDI flag ' + flagLabel(i.enso) + '</span></div>';
    s += '<div><span class="small">Indian Ocean Dipole</span><br><b>' + esc(ctx ? ctx.iod_phase : '--') + '</b><br><span class="small">' + (ctx ? 'DMI ' + f2(ctx.dmi_value) + ' (' + esc(ctx.dmi_period) + ')' : '') + ' · CDI flag ' + flagLabel(i.iod) + '</span></div>';
    s += '<div><span class="small">Added to every province</span><br><b>' + f2(0.2 * (i.enso || 0) + 0.1 * (i.iod || 0)) + '</b><br><span class="small">of a maximum 0.30</span></div></div>';
    return s;
  }
  function buildTrend(data) {
    var ns = national(data), tl = data.archive.timeline, n = Math.min(60, ns.length);
    return '<h3>National average CDI, last 5 years</h3><div style="height:260px"><canvas id="reportCdiTrendChart" data-labels="' + esc(JSON.stringify(tl.slice(-n).map(mlabel))) + '" data-values="' + esc(JSON.stringify(ns.slice(-n).map(function (v) { return v == null ? null : +v.toFixed(3); }))) + '"></canvas></div>';
  }
  function buildFire(data) {
    var f = data.fire; if (!f) return '<h3>Fire</h3><p class="small">PNG Fire Watch data could not be loaded when this report was generated. Try again, or see https://rudoq007.github.io/PNGFireWatch/.</p>';
    var n = f.national, ex = data.example.provinces || {}, adm = data.admin;
    var top = f.provinces.slice().sort(function (a, b) { return fv(b.now) - fv(a.now); });
    var pid = {}; f.provinces.forEach(function (p) { pid[p.id] = fname(p.name); });
    var s = '<span class="eyebrow">Part 2</span><h3 style="margin-top:4px">Fire this season</h3>';
    s += '<p>Satellites detected <b>' + fi(fv(n.now)) + '</b> fire alerts across PNG between ' + esc(f.season.label) + '. That is <b>' + fx(fv(n.ratio)) + '</b> the 2012–2025 average for the same weeks and ' + (fv(n.rank) === 1 ? 'the highest' : 'the ' + fv(n.rank) + 'th highest') + ' since records began in 2012 (2015 El Niño season: ' + fi(fv(n.years['2015'])) + ').</p>';
    var ys = n.years, yk = Object.keys(ys);
    s += '<h4>This season against every season since 2012</h4><div style="height:240px"><canvas id="reportFireYears" data-labels="' + esc(JSON.stringify(yk)) + '" data-values="' + esc(JSON.stringify(yk.map(function (k) { return fv(ys[k]); }))) + '" data-current="' + esc(f.season.current) + '"></canvas></div>';
    var mo = f.season.months, MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    s += '<h4>Month by month</h4><div style="height:200px"><canvas id="reportFireMonths" data-labels="' + esc(JSON.stringify(mo.map(function (m) { return MN[+m.slice(5)] + ' ' + m.slice(0, 4); }))) + '" data-values="' + esc(JSON.stringify(mo.map(function (m) { return fv(n.monthly[m]) || 0; }))) + '"></canvas></div>';
    s += '<h4>Provinces: fire next to drought</h4><table><thead><tr><th>Province</th><th>Fire alerts</th><th>vs average</th><th>Rank since 2012</th><th>CDI</th><th>Phase</th></tr></thead><tbody>' + top.map(function (p) { var c = ex[fname(p.name)]; return '<tr><td><b>' + esc(fname(p.name)) + '</b></td><td>' + fi(fv(p.now)) + '</td><td>' + fx(fv(p.ratio)) + '</td><td>' + (fv(p.rank) || '--') + '</td><td>' + f2(c && c.cdi) + '</td><td>' + (c ? pill(c.cdi) : '--') + '</td></tr>'; }).join('') + '</tbody></table>';
    var dcdi = {}; ((adm && adm.districts) || []).forEach(function (d) { dcdi[d.province + '|' + fnorm(d.name)] = d.cdi_mean; });
    var td = f.districts.slice().sort(function (a, b) { return fv(b.now) - fv(a.now); }).slice(0, 15);
    s += '<h4>15 districts with the most alerts</h4><table><thead><tr><th>District</th><th>Province</th><th>Fire alerts</th><th>vs average</th><th>Mean CDI</th><th>Phase</th></tr></thead><tbody>' + td.map(function (d) { var pr = pid[d.province_id], c = dcdi[pr + '|' + fnorm(d.name)]; return '<tr><td><b>' + esc(String(d.name).replace(/ District$/, '')) + '</b></td><td>' + esc(pr) + '</td><td>' + fi(fv(d.now)) + '</td><td>' + fx(fv(d.ratio)) + '</td><td>' + f2(c) + '</td><td>' + (c != null ? pill(c) : '--') + '</td></tr>'; }).join('') + '</tbody></table>';
    var fl = n.flags || {}, base = fv(fl._base) || fv(n.now);
    s += '<h4>Where the fires fall</h4><div class="metric"><div><span class="small">Tree cover (over 30%)</span><br><b>' + pc(fv(fl.tcd30), base) + '</b></div><div><span class="small">Primary forest</span><br><b>' + pc(fv(fl.primary), base) + '</b></div><div><span class="small">Key Biodiversity Areas</span><br><b>' + pc(fv(fl.kba), base) + '</b></div></div>';
    s += '<p class="small">Shares are of alerts with land-cover information (' + esc(f.season.flags_basis || 'all alerts') + '). Satellites: ' + esc(f.season.sources.map(function (x) { return x.satellite + ' (' + x.from + ' to ' + x.to + ')'; }).join(', ')) + '.</p>';
    return s;
  }
  function buildGuidance() {
    return '<h3>What each phase means</h3><table><thead><tr><th>Phase</th><th>Recommended action</th></tr></thead><tbody>' +
      '<tr><td>' + pillLabel('Readiness') + ' 0.40–0.59</td><td>Maintain preparedness while supporting higher-phase operations elsewhere.</td></tr>' +
      '<tr><td>' + pillLabel('Anticipatory Action') + ' 0.60–0.79</td><td>Activate/scale anticipatory action now; complete field verification and prioritise hotspots.</td></tr>' +
      '<tr><td>' + pillLabel('Response') + ' 0.80–1.00</td><td>Urgently verify severity and impacts; transition to response only where the CDI signal and field evidence converge.</td></tr></tbody></table>' +
      '<p class="small">Source: FAO PNG Food Security &amp; Agriculture Sectoral Plan (Aug 2026), Table 1.</p>';
  }
  function buildLinks() {
    return '<h3>Data and links</h3><div class="embed-actions">' +
      '<a class="btn" href="' + LINKS.example + '">Province CDI (JSON)</a><a class="btn" href="' + LINKS.archive + '">CDI history since 1996 (JSON)</a>' +
      '<a class="btn" href="' + LINKS.districtCsv + '">Districts (CSV)</a><a class="btn" href="' + LINKS.llgCsv + '">LLGs (CSV)</a>' +
      '<a class="btn" href="' + LINKS.pixelTif + '">CDI pixels (GeoTIFF)</a><a class="btn" href="' + LINKS.pngnws3mo + '">PNGNWS 3-month outlook</a>' +
      '<a class="btn" href="https://rudoq007.github.io/PNGFireWatch/">PNG Fire Watch</a><a class="btn" href="https://rudoq007.github.io/PNGFireWatch/data/stats.json">Fire statistics (JSON)</a><a class="btn" href="' + LINKS.pngnws31d + '">PNGNWS 31-day forecast</a><a class="btn" href="' + LINKS.earthmap + '">EarthMap</a></div>';
  }
  function buildCaveats() {
    return '<h3>Notes</h3><ul class="small">' +
      '<li>The CDI flags where climate signals are converging strongly enough to warrant action. It does not by itself confirm crop failure or food insecurity; field verification decides the response.</li>' +
      '<li>District and LLG values are averages of ~5 km pixels and can differ from the official province CDI, which is calculated from province-average inputs.</li>' +
      '<li>Fire alerts are satellite heat detections (NASA VIIRS), not confirmed fires or burnt area. Comparisons use the same weeks of each year since 2012.</li>' +
      '<li>Boundaries: PNG NSO 2011 census. Population: NSO 2024 census-unit estimates placed in 2011 LLGs.</li></ul>';
  }
  function buildReportHtml(data) {
    var rows = provinces(data);
    return '<div id="reportBody">' + buildHeader(data) + buildSummary(data, rows) + HR + '<span class="eyebrow">Part 1</span><h3 style="margin-top:4px">Drought (CDI)</h3>' + buildProvinces(data, rows) + HR + buildSubnational(data) + HR +
      buildPeople(data) + HR + buildDrivers(data, rows) + buildTrend(data) + HR + buildFire(data) + HR + buildGuidance() + HR + buildLinks() + HR + buildCaveats() + '</div>';
  }

  function destroyChart(id) { if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; } }
  function initCharts(data) {
    ['reportCdiChart', 'reportCdiTrendChart', 'reportPopPhaseChart', 'reportFireYears', 'reportFireMonths'].forEach(destroyChart);
    var rows = provinces(data);
    var c1 = document.getElementById('reportCdiChart');
    if (c1) chartInstances.reportCdiChart = new Chart(c1, { type: 'bar', data: { labels: rows.map(function (r) { return r.name; }), datasets: [{ label: 'CDI', data: rows.map(function (r) { return r.cdi; }), backgroundColor: rows.map(function (r) { return PALETTE[phase(r.cdi).cls]; }) }] }, options: { indexAxis: 'y', maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 1 }, y: { ticks: { autoSkip: false } } } } });
    var c2 = document.getElementById('reportCdiTrendChart');
    if (c2) chartInstances.reportCdiTrendChart = new Chart(c2, { type: 'line', data: { labels: JSON.parse(c2.getAttribute('data-labels')), datasets: [{ label: 'National average CDI', data: JSON.parse(c2.getAttribute('data-values')), borderColor: '#b30000', backgroundColor: 'rgba(179,0,0,.08)', fill: true, pointRadius: 0, tension: .2 }] }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 1 }, x: { ticks: { maxTicksLimit: 10 } } } } });
    var c4 = document.getElementById('reportFireYears');
    if (c4) { var cur = c4.getAttribute('data-current'), yl = JSON.parse(c4.getAttribute('data-labels')); chartInstances.reportFireYears = new Chart(c4, { type: 'bar', data: { labels: yl, datasets: [{ data: JSON.parse(c4.getAttribute('data-values')), backgroundColor: yl.map(function (y) { return y === cur ? '#E8590C' : y === '2015' ? '#B45309' : '#CBD5E1'; }), borderRadius: 4 }] }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } } }); }
    var c5 = document.getElementById('reportFireMonths');
    if (c5) chartInstances.reportFireMonths = new Chart(c5, { type: 'bar', data: { labels: JSON.parse(c5.getAttribute('data-labels')), datasets: [{ data: JSON.parse(c5.getAttribute('data-values')), backgroundColor: '#E8590C', borderRadius: 4 }] }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } } });
    var c3 = document.getElementById('reportPopPhaseChart');
    if (c3) chartInstances.reportPopPhaseChart = new Chart(c3, { type: 'bar', data: { labels: ['Response', 'Anticipatory Action', 'Readiness', 'Monitoring', 'No data'], datasets: [{ data: JSON.parse(c3.getAttribute('data-values')), backgroundColor: [PALETTE.Response, PALETTE.AA, PALETTE.Readiness, PALETTE.Monitoring, PALETTE.NoData] }] }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } } });
  }

  // ---------- print / download ----------

  function downloadReport() {
    var output = document.getElementById('reportOutput');
    if (!output || !output.innerHTML) return;
    var clone = output.cloneNode(true);

    var liveCanvases = output.querySelectorAll('canvas');
    var cloneCanvases = clone.querySelectorAll('canvas');
    liveCanvases.forEach(function (cv, i) {
      try {
        var img = document.createElement('img');
        img.src = cv.toDataURL('image/png');
        img.style.maxWidth = '100%';
        img.alt = 'chart';
        cloneCanvases[i].replaceWith(img);
      } catch (e) { /* leave canvas out if it cannot be rasterised */ }
    });
    clone.querySelectorAll('.no-print').forEach(function (el) { el.remove(); });
    clone.querySelectorAll('[data-goto-tab]').forEach(function (el) {
      var span = document.createElement('span');
      span.textContent = el.textContent + ' (see the live dashboard)';
      span.style.fontWeight = '700';
      el.replaceWith(span);
    });

    var css = 'body{font-family:Inter,Arial,sans-serif;background:#F3F8FC;color:#102A43;margin:0;padding:24px}' +
      '.card{background:#fff;border:1px solid rgba(102,153,194,.18);border-radius:20px;padding:20px;box-shadow:0 8px 24px rgba(16,24,40,.08);max-width:1100px;margin:0 auto}' +
      'h2,h3,h4{margin-top:22px}h2{margin-top:0}' +
      'table{border-collapse:collapse;width:100%;margin:10px 0}' +
      'th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;font-size:13px}th{background:#f8fafc}' +
      '.pill{display:inline-block;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800}' +
      '.NoData{background:#e2e8f0;color:#334155}' +
      '.Response{background:#a50026;color:#fff}.AA{background:#fdae61;color:#7c2d12}.Readiness{background:#abd9e9;color:#0c4a6e}.Monitoring{background:#e2e8f0;color:#334155}' +
      '.eyebrow{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#4F82B3}' +
      '.note{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:13px}' +
      '.small{font-size:12px;color:#64748b}' +
      '.metric{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}' +
      '.embed-actions{display:flex;flex-wrap:wrap;gap:8px}' +
      'a.btn{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:8px 12px;text-decoration:none;color:#102A43;font-weight:700;font-size:13px}';

    var html = '<!doctype html><html><head><meta charset="utf-8"><title>ADAPt report, ' + new Date().toISOString().slice(0, 10) +
      '</title><style>' + css + '</style></head><body>' + clone.innerHTML + '</body></html>';
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'adapt-report-' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // ---------- wiring ----------

  function setStatus(msg, isError) {
    var el = document.getElementById('reportStatus');
    if (el) { el.textContent = msg; el.style.color = isError ? '#991b1b' : '#64748b'; }
  }

  function generateReport() {
    var btn = document.getElementById('generateReportBtn');
    var output = document.getElementById('reportOutput');
    var printBtn = document.getElementById('printReportBtn');
    var downloadBtn = document.getElementById('downloadReportBtn');
    if (!output) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    setStatus('Fetching the latest published data…');

    fetchAll().then(function (data) {
      output.innerHTML = buildReportHtml(data);
      output.style.display = '';
      initCharts(data);
      if (printBtn) printBtn.style.display = '';
      if (downloadBtn) downloadBtn.style.display = '';
      setStatus('Report generated ' + new Date().toLocaleTimeString() + '. Click Generate again any time to refresh it with the latest published data.');
    }).catch(function (e) {
      setStatus('Could not generate the report: ' + e.message, true);
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate report'; }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var genBtn = document.getElementById('generateReportBtn');
    var printBtn = document.getElementById('printReportBtn');
    var downloadBtn = document.getElementById('downloadReportBtn');
    if (genBtn) genBtn.addEventListener('click', generateReport);
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    if (downloadBtn) downloadBtn.addEventListener('click', downloadReport);

    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-goto-tab]');
      if (!el) return;
      var tabBtn = document.querySelector('.tab[data-panel="' + el.getAttribute('data-goto-tab') + '"]');
      if (tabBtn) tabBtn.click();
    });
  });
})();
