// ADAPt theme: light/dark, follows the device setting until the viewer picks one.
// Loaded in <head> so the right theme is applied before the page paints.
(function () {
  var KEY = 'adapt-theme';
  var listeners = [];
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function system() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function current() { return document.documentElement.getAttribute('data-theme') || stored() || system(); }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    listeners.forEach(function (cb) { try { cb(t); } catch (e) { console.warn(e); } });
  }
  function set(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* private mode: still switch for this visit */ }
    document.documentElement.classList.add('theme-anim');
    apply(t);
    setTimeout(function () { document.documentElement.classList.remove('theme-anim'); }, 450);
  }
  document.documentElement.setAttribute('data-theme', stored() || system());
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSys = function () { if (!stored()) apply(system()); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  }
  // Esri canvas basemaps: quiet grey base + a separate label layer drawn above the CDI polygons.
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  function baseUrl(t) { return ESRI + (t === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base') + '/MapServer/tile/{z}/{y}/{x}'; }
  function labelUrl(t) { return ESRI + (t === 'dark' ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference') + '/MapServer/tile/{z}/{y}/{x}'; }
  // Adds a theme-following basemap (and labels) to a Leaflet map; returns the base layer.
  function themedBasemap(map, opts) {
    opts = opts || {};
    var L = window.L, t = current();
    if (!map.getPane('labels')) { map.createPane('labels'); map.getPane('labels').style.zIndex = 620; map.getPane('labels').style.pointerEvents = 'none'; }
    var attr = 'Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
    var base = L.tileLayer(baseUrl(t), { maxZoom: 16, attribution: attr, className: 'basemap-tiles' });
    var labels = opts.labels === false ? null : L.tileLayer(labelUrl(t), { maxZoom: 16, pane: 'labels', className: 'label-tiles' });
    base.addTo(map); if (labels) labels.addTo(map);
    listeners.push(function (nt) { base.setUrl(baseUrl(nt)); if (labels) labels.setUrl(labelUrl(nt)); });
    return { base: base, labels: labels };
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  window.ADAPT_THEME = { get: current, set: set, toggle: function () { set(current() === 'dark' ? 'light' : 'dark'); }, onChange: function (cb) { listeners.push(cb); }, themedBasemap: themedBasemap, cssVar: cssVar };
})();
