/* ADAPt -- on-demand report generator (Report tab)
 * Fetches the dashboard's own published data files at click time and
 * compiles a self-contained briefing (charts, tables, direct links) from
 * whatever is currently live. Runs entirely client-side; nothing is
 * uploaded or stored anywhere. Kept self-contained (own fetches, own
 * formatting/classification helpers) rather than reaching into the main
 * inline script's globals, matching the pattern already used by the
 * other assets/*.js files in this repo.
 */
(function () {
  'use strict';

  var FILES = {
    asis: 'data/asis_vhi_latest.json',
    integrated: 'data/integrated_priority_latest.json',
    cdiExample: 'data/cdi_example_latest.json',
    cdiArchive: 'data/cdi_archive.json',
    cdiPop: 'data/cdi_population_exposure.json',
    liveProc: 'data/live_processing_status.json'
  };

  // Absolute base URL of the page this script is running on (e.g.
  // "https://rudoq007.github.io/gisnexus/"), resolved at runtime rather than
  // hardcoded so it keeps working under a custom domain, a fork, or local
  // testing. The report's "direct links" must be absolute -- a relative
  // "data/..." href only resolves correctly while viewed on the live page;
  // once the browser turns the page into a PDF (Print / Save as PDF) or this
  // script serialises a standalone HTML snapshot (Download report), the link
  // needs to carry the full URL to still work outside that page context.
  var BASE_URL = new URL('.', window.location.href).href;

  var LINKS = {
    cdiExample: BASE_URL + 'data/cdi_example_latest.json',
    cdiArchive: BASE_URL + 'data/cdi_archive.json',
    cdiPop: BASE_URL + 'data/cdi_population_exposure.json',
    asis: BASE_URL + 'data/asis_vhi_latest.json',
    integratedJson: BASE_URL + 'data/integrated_priority_latest.json',
    integratedCsv: BASE_URL + 'data/integrated_priority_latest.csv',
    compositeTif: BASE_URL + 'data/composite_biophysical_stress.tif',
    cdiPixelTif: BASE_URL + 'data/cdi_pixel_latest.tif',
    liveWorkspace: 'https://png-climate-workspace-v1.streamlit.app/',
    pngnws3mo: 'https://www.pngmet.gov.pg/nwp/three-months-forecasts/',
    pngnws31d: 'https://www.pngmet.gov.pg/nwp/thirty-one-days-forecasts/',
    earthmap: 'https://png.earthmap.org'
  };

  var chartInstances = {};

  // ---------- small self-contained helpers (deliberately not shared with the main script) ----------

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtInt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'No data';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function fmt2(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'No data';
    return Number(n).toFixed(2);
  }

  function fmt1(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'No data';
    return Number(n).toFixed(1);
  }

  function pct(part, total, digits) {
    if (!total) return 'No data';
    return (part / total * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function monthLabel(pair) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (!Array.isArray(pair) || pair.length < 2) return '';
    return months[pair[1] - 1] + ' ' + pair[0];
  }

  function cdiPhase(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return { label: 'No data', cls: 'NoData' };
    if (v >= 0.80) return { label: 'Response threshold', cls: 'Response' };
    if (v >= 0.60) return { label: 'Anticipatory Action', cls: 'AA' };
    if (v >= 0.40) return { label: 'Readiness', cls: 'Readiness' };
    return { label: 'Monitoring', cls: 'Monitoring' };
  }

  function asisClass(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return { label: 'No data', cls: 'NoData' };
    if (v < 0.35) return { label: 'High vegetation stress', cls: 'High' };
    if (v < 0.50) return { label: 'Moderate vegetation stress', cls: 'Moderate' };
    if (v < 0.65) return { label: 'Watch / below-normal', cls: 'Watch' };
    return { label: 'Lower current stress', cls: 'Lower' };
  }

  function compositeClassOf(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return { label: 'No data', cls: 'NoData' };
    if (v >= 80) return { label: 'Severe', cls: 'Severe' };
    if (v >= 60) return { label: 'High', cls: 'High' };
    if (v >= 40) return { label: 'Moderate', cls: 'Moderate' };
    if (v >= 20) return { label: 'Watch', cls: 'Watch' };
    return { label: 'Low', cls: 'Low' };
  }

  var PALETTE = {
    Severe: '#7f0000', High: '#d73027', Moderate: '#fc8d59', Watch: '#fee08b', Low: '#91cf60', Lower: '#dcfce7',
    Response: '#a50026', AA: '#fdae61', Readiness: '#abd9e9', Monitoring: '#e2e8f0', NoData: '#cbd5e1'
  };

  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  function fetchAll() {
    var keys = Object.keys(FILES);
    return Promise.all(keys.map(function (key) {
      return fetchJson(FILES[key]).then(function (d) { return { key: key, ok: true, data: d }; })
        .catch(function (e) { return { key: key, ok: false, error: e.message }; });
    })).then(function (results) {
      var out = { _missing: [] };
      results.forEach(function (r) {
        out[r.key] = r.ok ? r.data : null;
        if (!r.ok) out._missing.push(r.key);
      });
      return out;
    });
  }

  // ---------- report sections ----------

  function buildHeader(data) {
    var now = new Date();
    var missingNote = '';
    if (data._missing.length) {
      missingNote = '<p class="small" style="color:#b45309">Not currently published, skipped in this report: ' +
        esc(data._missing.join(', ')) + '.</p>';
    }
    return '' +
      '<span class="eyebrow">FAO ADAPt · generated report</span>' +
      '<h2 style="margin-top:6px">ADAPt drought &amp; food-security briefing</h2>' +
      '<p class="small" style="color:#64748b">Generated ' + esc(now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })) +
      ' from ADAPt’s live published data (rudoq007.github.io/gisnexus). For use in El Niño drought preparedness and response planning &mdash; does not replace official declarations by mandated national authorities or field assessment by DAL, NARI, NDC, provincial or district teams.</p>' +
      missingNote;
  }

  function buildExecutiveSummary(data) {
    var cdiProvinces = (data.cdiExample && data.cdiExample.provinces) || {};
    var names = Object.keys(cdiProvinces);
    var counts = { Response: 0, AA: 0, Readiness: 0, Monitoring: 0, NoData: 0 };
    var sumCdi = 0, nCdi = 0;
    names.forEach(function (name) {
      var v = cdiProvinces[name] && cdiProvinces[name].cdi;
      var ph = cdiPhase(v);
      counts[ph.cls] = (counts[ph.cls] || 0) + 1;
      if (v !== null && v !== undefined && !Number.isNaN(v)) { sumCdi += v; nCdi++; }
    });
    var avgCdi = nCdi ? sumCdi / nCdi : null;

    var pop = data.cdiPop && data.cdiPop.national;
    var popResponse = pop && pop.population_by_phase ? pop.population_by_phase['Response threshold'] : null;
    var popAA = pop && pop.population_by_phase ? pop.population_by_phase['Anticipatory Action'] : null;

    var enso = data.integrated && data.integrated.enso_iod_context;

    var kpis = [
      { label: 'National average CDI', value: avgCdi === null ? 'No data' : fmt2(avgCdi), sub: nCdi + ' of ' + names.length + ' provinces reporting' },
      { label: 'Provinces at Response threshold', value: fmtInt(counts.Response), sub: 'CDI ≥ 0.80' },
      { label: 'Provinces at Anticipatory Action', value: fmtInt(counts.AA), sub: 'CDI 0.60–0.79' },
      { label: 'People at Response threshold', value: popResponse === null || popResponse === undefined ? 'No data' : fmtInt(popResponse), sub: 'CDI-linked population exposure' },
      { label: 'People at Anticipatory Action', value: popAA === null || popAA === undefined ? 'No data' : fmtInt(popAA), sub: 'CDI-linked population exposure' },
      { label: 'ENSO state (ONI)', value: enso ? esc(enso.enso_phase) + ' (' + fmt1(enso.oni_value) + ')' : 'No data', sub: enso ? esc(enso.oni_period) : '' }
    ];

    var kpiHtml = kpis.map(function (k) {
      return '<div style="flex:1;min-width:180px;padding:12px 14px;border-radius:12px;border:1px solid #e2e8f0;background:#f8fafc">' +
        '<div class="small" style="color:#64748b">' + esc(k.label) + '</div>' +
        '<div style="font-weight:800;font-size:22px;color:#1e293b;margin-top:4px">' + k.value + '</div>' +
        '<div class="small" style="color:#94a3b8">' + esc(k.sub) + '</div></div>';
    }).join('');

    return '<h3>Executive summary</h3>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin:10px 0 16px">' + kpiHtml + '</div>';
  }

  function buildCdiSection(data) {
    var ex = data.cdiExample;
    var cdiProvinces = (ex && ex.provinces) || {};
    var rows = Object.keys(cdiProvinces).map(function (name) {
      var v = cdiProvinces[name].cdi;
      return { name: name, cdi: v, phase: cdiPhase(v) };
    }).sort(function (a, b) { return (b.cdi || -1) - (a.cdi || -1); });

    var tableRows = rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + (r.cdi === null || r.cdi === undefined ? 'No data' : fmt2(r.cdi)) +
        '</td><td><span class="pill ' + r.phase.cls + '">' + esc(r.phase.label) + '</span></td></tr>';
    }).join('');

    var labelsLine = ex ? ('Reporting month: ' + esc(ex.reporting_month_label || '—') +
      ' &middot; Observation month: ' + esc(ex.observation_month_label || '—') +
      ' &middot; Forecast window: ' + esc(ex.forecast_window_label || '—')) : '';

    return '<h3>Combined Drought Index (CDI) by province</h3>' +
      '<p class="small" style="color:#64748b">' + labelsLine + '</p>' +
      '<div class="tablewrap" style="max-height:520px;overflow:auto"><canvas id="reportCdiChart" height="' + Math.max(240, rows.length * 20) + '"></canvas></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Province</th><th>CDI</th><th>Phase</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
      buildCdiTrend(data);
  }

  function buildCdiTrend(data) {
    var archive = data.cdiArchive;
    if (!archive || !archive.timeline || !archive.cdi_history) return '';
    var timeline = archive.timeline;
    var provinces = Object.keys(archive.cdi_history);
    if (!provinces.length) return '';
    var lastYear = timeline[timeline.length - 1][0];
    var idxThisYear = [];
    timeline.forEach(function (pair, i) { if (pair[0] === lastYear) idxThisYear.push(i); });
    var labels = idxThisYear.map(function (i) { return monthLabel(timeline[i]); });
    var avgs = idxThisYear.map(function (i) {
      var sum = 0, n = 0;
      provinces.forEach(function (p) {
        var v = archive.cdi_history[p][i];
        if (v !== null && v !== undefined && !Number.isNaN(v)) { sum += v; n++; }
      });
      return n ? sum / n : null;
    });
    return '<h4 style="margin-top:18px">National average CDI trend, ' + lastYear + '</h4>' +
      '<canvas id="reportCdiTrendChart" height="90" data-labels=\'' + esc(JSON.stringify(labels)) + '\' data-values=\'' + esc(JSON.stringify(avgs)) + '\'></canvas>';
  }

  function buildAsisSection(data) {
    var asis = data.asis;
    if (!asis) return '<h3>FAO ASIS/GIEWS vegetation screening</h3><p class="note">Not currently published.</p>';
    var rows = (asis.provinces || []).slice().sort(function (a, b) { return (a.mean === null || a.mean === undefined ? 999 : a.mean) - (b.mean === null || b.mean === undefined ? 999 : b.mean); });
    var counts = { High: 0, Moderate: 0, Watch: 0, Lower: 0, NoData: 0 };
    var sum = 0, n = 0;
    rows.forEach(function (r) {
      var c = asisClass(r.mean);
      counts[c.cls]++;
      if (r.mean !== null && r.mean !== undefined) { sum += r.mean; n++; }
    });
    var mean = n ? sum / n : null;
    var tableRows = rows.map(function (r, i) {
      var c = asisClass(r.mean);
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.province) + '</td><td>' + (r.mean === null || r.mean === undefined ? 'No data' : fmt2(r.mean)) +
        '</td><td><span class="pill ' + c.cls + '">' + esc(c.label) + '</span></td></tr>';
    }).join('');

    return '<h3>FAO ASIS/GIEWS vegetation screening</h3>' +
      '<p class="small" style="color:#64748b">Dekad ' + esc(asis.dekad_label || '—') + ' &middot; generated ' + esc(asis.generated_utc || '—') +
      ' &middot; national mean vegetation index ' + (mean === null ? 'No data' : fmt2(mean)) +
      ' &middot; High ' + counts.High + ', Moderate ' + counts.Moderate + ', Watch ' + counts.Watch + ', Lower ' + counts.Lower + '</p>' +
      '<canvas id="reportAsisChart" height="' + Math.max(240, rows.length * 20) + '" data-rows=\'' + esc(JSON.stringify(rows.map(function (r) { return { province: r.province, mean: r.mean }; }))) + '\'></canvas>' +
      '<div class="tablewrap"><table><thead><tr><th>Rank</th><th>Province</th><th>VHI</th><th>Class</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
  }

  function buildEnsoIodSection(data) {
    var e = data.integrated && data.integrated.enso_iod_context;
    if (!e) return '';
    return '<h3>Climate driver context (ENSO / IOD)</h3>' +
      '<div class="metric">' +
      '<div><span class="muted">ENSO state (ONI)</span><b>' + esc(e.enso_phase || '—') + ' (' + fmt1(e.oni_value) + ', ' + esc(e.oni_period || '') + ')</b></div>' +
      '<div><span class="muted">IOD state (DMI)</span><b>' + esc(e.iod_phase || '—') + ' (' + fmt1(e.dmi_value) + ', ' + esc(e.dmi_period || '') + ')</b></div>' +
      '<div><span class="muted">Composite weighting</span><b>' + (data.integrated && data.integrated.composite_weights ? Object.keys(data.integrated.composite_weights).map(function (k) { return k + ' ' + data.integrated.composite_weights[k]; }).join(', ') : '—') + '</b></div>' +
      '</div>' +
      '<p class="small" style="color:#64748b">' + esc(e.source_note || '') + '</p>';
  }

  function buildCompositeSection(data) {
    var integ = data.integrated;
    if (!integ) return '<h3>Composite biophysical stress &amp; population exposure</h3><p class="note">Not currently published.</p>';
    var rows = (integ.provinces || []).slice().sort(function (a, b) { return (b.composite_biophysical_stress_mean || -1) - (a.composite_biophysical_stress_mean || -1); });
    var nat = integ.national_summary || {};
    var tableRows = rows.map(function (r) {
      var c = compositeClassOf(r.composite_biophysical_stress_mean);
      return '<tr><td>' + esc(r.province) + '</td><td>' + fmt1(r.composite_biophysical_stress_mean) + '</td><td><span class="pill ' + c.cls + '">' + esc(c.label) +
        '</span></td><td>' + fmtInt(r.population_high_priority) + '</td><td>' + fmtInt(r.population_exposed_total) + '</td></tr>';
    }).join('');

    return '<h3>Composite biophysical stress &amp; population exposure</h3>' +
      '<p class="note">A different, complementary framework from the CDI phase above (own weighting, no ENSO/IOD; drought window ' + esc(integ.drought_window || '—') + ', frost window ' + esc(integ.frost_window || '—') + ', ASIS date ' + esc(integ.asis_date || '—') + '). Population figures here should not be summed with the CDI-phase population table below.</p>' +
      '<div class="metric">' +
      '<div><span class="muted">Population exposed</span><b>' + fmtInt(nat.total_population_exposed) + '</b></div>' +
      '<div><span class="muted">High-priority population</span><b>' + fmtInt(nat.total_population_high_priority) + '</b></div>' +
      '<div><span class="muted">Cropland stressed (ha)</span><b>' + fmtInt(nat.total_cropland_stressed_ha) + '</b></div>' +
      '</div>' +
      '<canvas id="reportCompositeChart" height="' + Math.max(240, rows.length * 20) + '" data-rows=\'' + esc(JSON.stringify(rows.map(function (r) { return { province: r.province, v: r.composite_biophysical_stress_mean }; }))) + '\'></canvas>' +
      '<div class="tablewrap"><table><thead><tr><th>Province</th><th>Composite stress</th><th>Class</th><th>Pop., high priority</th><th>Pop., exposed</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
  }

  function buildPopulationSection(data) {
    var cdiPop = data.cdiPop;
    if (!cdiPop) return '<h3>CDI-linked population exposure by province</h3><p class="note">Not currently published (depends on the pixel-level CDI raster having been generated at least once).</p>';
    var nat = cdiPop.national || {};
    var phaseOrder = [['Response threshold', 'Response'], ['Anticipatory Action', 'AA'], ['Readiness', 'Readiness'], ['Monitoring', 'Monitoring'], ['No data', 'NoData']];
    var byPhase = nat.population_by_phase || {};

    var provinces = Object.keys(cdiPop.provinces || {}).sort(function (a, b) {
      var pa = cdiPop.provinces[a].population_by_phase || {};
      var pb = cdiPop.provinces[b].population_by_phase || {};
      return (pb['Response threshold'] || 0) - (pa['Response threshold'] || 0);
    });
    var tableRows = provinces.map(function (name) {
      var p = cdiPop.provinces[name];
      var ph = p.population_by_phase || {};
      return '<tr><td>' + esc(name) + '</td><td>' + fmtInt(p.total_population) + '</td><td>' + fmtInt(ph['Response threshold']) +
        '</td><td>' + fmtInt(ph['Anticipatory Action']) + '</td><td>' + fmtInt(ph['Readiness']) + '</td><td>' + fmtInt(ph['No data']) + '</td></tr>';
    }).join('');

    return '<h3>CDI-linked population exposure by province</h3>' +
      '<p class="small" style="color:#64748b">Generated ' + esc(cdiPop.generated_utc || '—') + ' &middot; ' + fmtInt(nat.total_population) + ' people, ' +
      fmtInt(nat.total_households) + ' households, ' + fmtInt(nat.census_units) + ' census units (' + pct(nat.census_units_no_coverage, nat.census_units) + ' with no CDI-raster coverage).</p>' +
      '<canvas id="reportPopPhaseChart" height="140" data-values=\'' + esc(JSON.stringify(phaseOrder.map(function (p) { return byPhase[p[0]] || 0; }))) + '\'></canvas>' +
      '<div class="tablewrap"><table><thead><tr><th>Province</th><th>Total population</th><th>Response threshold</th><th>Anticipatory Action</th><th>Readiness</th><th>No coverage</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
  }

  function buildResponseGuidance() {
    return '<h3>CDI-based response guidance</h3>' +
      '<div class="tablewrap"><table><thead><tr><th>CDI phase</th><th>Range</th><th>Recommended action</th></tr></thead><tbody>' +
      '<tr><td><span class="pill Readiness">Readiness</span></td><td>0.40–0.59</td><td>Maintain preparedness while supporting higher-phase operations elsewhere.</td></tr>' +
      '<tr><td><span class="pill AA">Anticipatory Action</span></td><td>0.60–0.79</td><td>Activate/scale anticipatory action now; complete field verification and prioritize hotspots.</td></tr>' +
      '<tr><td><span class="pill Response">Response threshold</span></td><td>0.80–1.00</td><td>Urgently verify severity and impacts; transition to response only where the CDI signal and field evidence converge.</td></tr>' +
      '</tbody></table></div>' +
      '<p class="small" style="color:#64748b">Per the FAO PNG Food Security &amp; Agriculture Sectoral Plan (Table 1). The CDI phase is ADAPt’s primary, government-endorsed trigger; ASIS/GIEWS screening is a complementary, higher-frequency layer.</p>';
  }

  function buildLinksSection(data) {
    function dataLink(url, label) { return '<a class="btn" href="' + url + '" target="_blank" rel="noopener">' + esc(label) + '</a>'; }
    function tabLink(panel, label) { return '<button class="btn no-print" data-goto-tab="' + panel + '">' + esc(label) + '</button>'; }
    function extLink(url, label) { return '<a class="btn" href="' + url + '" target="_blank" rel="noopener">' + esc(label) + '</a>'; }

    var stale = '';
    if (data.liveProc && data.liveProc.generated_utc) {
      var parsed = Date.parse(data.liveProc.generated_utc.replace(' UTC', 'Z').replace(' ', 'T'));
      if (!Number.isNaN(parsed)) {
        var days = Math.round((Date.now() - parsed) / 86400000);
        if (days > 14) {
          stale = '<p class="small" style="color:#b45309">Live processing workspace status last recorded ' + esc(data.liveProc.generated_utc) +
            ' — roughly ' + days + ' days old. Treat as background context only until refreshed.</p>';
        }
      }
    }

    return '<h3>Direct links to data and maps</h3>' +
      '<p class="small" style="color:#64748b">Downloads pull directly from this dashboard’s published <code>data/</code> folder; they reflect whatever is live right now.</p>' +
      '<div class="embed-actions" style="margin-bottom:10px">' +
      dataLink(LINKS.integratedCsv, 'Per-province summary (CSV)') +
      dataLink(LINKS.integratedJson, 'Composite priority data (JSON)') +
      dataLink(LINKS.cdiExample, 'CDI by province (JSON)') +
      dataLink(LINKS.cdiArchive, 'CDI historical archive (JSON)') +
      dataLink(LINKS.cdiPop, 'CDI population exposure (JSON)') +
      dataLink(LINKS.asis, 'ASIS/GIEWS screening (JSON)') +
      dataLink(LINKS.compositeTif, 'Composite stress raster (GeoTIFF)') +
      dataLink(LINKS.cdiPixelTif, 'Pixel-level CDI raster (GeoTIFF, if published)') +
      '</div>' +
      '<div class="embed-actions" style="margin-bottom:10px">' +
      tabLink('mapPanel', 'Open Interactive Map tab') +
      tabLink('provincial', 'Open Provincial Data tab') +
      tabLink('about', 'Open About ADAPt (CDI methodology)') +
      '</div>' +
      '<div class="embed-actions">' +
      extLink(LINKS.liveWorkspace, 'Live processing workspace') +
      extLink(LINKS.pngnws3mo, 'PNGNWS 3-month forecast') +
      extLink(LINKS.pngnws31d, 'PNGNWS 31-day forecast') +
      extLink(LINKS.earthmap, 'FAO EarthMap') +
      '</div>' + stale;
  }

  function buildCaveats(data) {
    var integ = data.integrated;
    var cdiPop = data.cdiPop;
    var compositeGap = '';
    if (integ && integ.provinces) {
      var totalCu = 0, totalNc = 0;
      integ.provinces.forEach(function (p) { totalCu += p.census_units || 0; totalNc += p.census_units_no_coverage || 0; });
      compositeGap = pct(totalNc, totalCu);
    }
    var cdiGap = cdiPop && cdiPop.national ? pct(cdiPop.national.census_units_no_coverage, cdiPop.national.census_units) : 'No data';
    return '<h3>Data caveats</h3>' +
      '<p class="note">The CDI framework (About ADAPt / Interactive Map) and the composite-stress framework (Provincial Data) use the same PNG NSO 2024 census-unit population source but classify people against different rasters over different windows &mdash; their population figures should not be added together. Roughly ' + esc(compositeGap) +
      ' of census units fall outside composite-stress raster coverage and roughly ' + esc(cdiGap) +
      ' of the population falls outside CDI-pixel coverage; these gaps are <b>unknown</b>, not confirmed low-risk, and are a priority for field verification. The composite-stress raster is ~5 km/pixel — a national screening resolution, not survey-grade. All figures above are pulled live from this dashboard’s own published data files at the moment this report was generated.</p>';
  }

  function buildReportHtml(data) {
    return '<div id="reportBody">' +
      buildHeader(data) +
      buildExecutiveSummary(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildCdiSection(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildAsisSection(data) +
      buildEnsoIodSection(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildCompositeSection(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildPopulationSection(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildResponseGuidance() +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildLinksSection(data) +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' +
      buildCaveats(data) +
      '</div>';
  }

  // ---------- chart initialization (after the HTML above is in the DOM) ----------

  function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
  }

  function initCharts(data) {
    ['reportCdiChart', 'reportCdiTrendChart', 'reportAsisChart', 'reportCompositeChart', 'reportPopPhaseChart'].forEach(destroyChart);

    // CDI by province (horizontal bar)
    var cdiCanvas = document.getElementById('reportCdiChart');
    if (cdiCanvas && data.cdiExample && data.cdiExample.provinces) {
      var rows = Object.keys(data.cdiExample.provinces).map(function (name) {
        return { name: name, cdi: data.cdiExample.provinces[name].cdi };
      }).sort(function (a, b) { return (b.cdi || -1) - (a.cdi || -1); });
      chartInstances.reportCdiChart = new Chart(cdiCanvas, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return r.name; }),
          datasets: [{ label: 'CDI', data: rows.map(function (r) { return r.cdi; }), backgroundColor: rows.map(function (r) { return PALETTE[cdiPhase(r.cdi).cls]; }) }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 1 } } }
      });
    }

    // National CDI trend (line)
    var trendCanvas = document.getElementById('reportCdiTrendChart');
    if (trendCanvas) {
      var labels = JSON.parse(trendCanvas.getAttribute('data-labels') || '[]');
      var values = JSON.parse(trendCanvas.getAttribute('data-values') || '[]');
      if (labels.length) {
        chartInstances.reportCdiTrendChart = new Chart(trendCanvas, {
          type: 'line',
          data: { labels: labels, datasets: [{ label: 'National average CDI', data: values, borderColor: '#2F6FA3', backgroundColor: 'rgba(47,111,163,.15)', fill: true, tension: .25 }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 1 } } }
        });
      }
    }

    // ASIS ranking (horizontal bar)
    var asisCanvas = document.getElementById('reportAsisChart');
    if (asisCanvas) {
      var asisRows = JSON.parse(asisCanvas.getAttribute('data-rows') || '[]');
      if (asisRows.length) {
        chartInstances.reportAsisChart = new Chart(asisCanvas, {
          type: 'bar',
          data: {
            labels: asisRows.map(function (r) { return r.province; }),
            datasets: [{ label: 'VHI', data: asisRows.map(function (r) { return r.mean; }), backgroundColor: asisRows.map(function (r) { return PALETTE[asisClass(r.mean).cls]; }) }]
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 1 } } }
        });
      }
    }

    // Composite stress ranking (horizontal bar)
    var compositeCanvas = document.getElementById('reportCompositeChart');
    if (compositeCanvas) {
      var compRows = JSON.parse(compositeCanvas.getAttribute('data-rows') || '[]');
      if (compRows.length) {
        chartInstances.reportCompositeChart = new Chart(compositeCanvas, {
          type: 'bar',
          data: {
            labels: compRows.map(function (r) { return r.province; }),
            datasets: [{ label: 'Composite stress', data: compRows.map(function (r) { return r.v; }), backgroundColor: compRows.map(function (r) { return PALETTE[compositeClassOf(r.v).cls]; }) }]
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } }
        });
      }
    }

    // Population by CDI phase (bar)
    var popCanvas = document.getElementById('reportPopPhaseChart');
    if (popCanvas) {
      var vals = JSON.parse(popCanvas.getAttribute('data-values') || '[]');
      var phaseLabels = ['Response threshold', 'Anticipatory Action', 'Readiness', 'Monitoring', 'No coverage'];
      var phaseColors = [PALETTE.Response, PALETTE.AA, PALETTE.Readiness, PALETTE.Monitoring, PALETTE.NoData];
      if (vals.length) {
        chartInstances.reportPopPhaseChart = new Chart(popCanvas, {
          type: 'bar',
          data: { labels: phaseLabels, datasets: [{ label: 'People', data: vals, backgroundColor: phaseColors }] },
          options: { responsive: true, plugins: { legend: { display: false } } }
        });
      }
    }
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
      '.Severe{background:#7f0000;color:#fff}.High{background:#d73027;color:#fff}.Moderate{background:#fc8d59;color:#fff}.Watch{background:#fee08b;color:#854d0e}' +
      '.Low{background:#91cf60;color:#166534}.Lower{background:#dcfce7;color:#166534}.NoData{background:#e2e8f0;color:#334155}' +
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
