// ADAPt CDI dashboard: Overview, Province, District and LLG tabs.
// Data (all published by the GitHub workflows in this repo):
//   data/cdi_example_latest.json      official province CDI + six indicator values (monthly)
//   data/cdi_archive.json             province CDI history since 1996
//   data/cdi_admin_latest.json        district/LLG means of the pixel CDI + NSO 2024 population
//   data/integrated_priority_latest.json  pixel CDI tile URL and ENSO/IOD values
// Boundaries: adm1_nso_province.geojson, adm2_nso_district.geojson, adm3_nso_llg.geojson
(function(){
'use strict';

const PHASES=['Response','Anticipatory Action','Readiness','Monitoring','No data'];
const PROV_ALIAS={'Chimbu (Simbu)':'Chimbu','Gulf Province':'Gulf','Milne Bay Province':'Milne Bay','Northern (Oro)':'Oro','West Sepik (Sandaun)':'Sandaun','Northern':'Oro','West Sepik':'Sandaun','Simbu':'Chimbu'};
const PNG_BOUNDS=[[-11.6,141.0],[-1.0,156.0]];
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BANDS=[[0.95,'#7f0000','0.95-1.00'],[0.9,'#b30000','0.90-0.94'],[0.85,'#d7301f','0.85-0.89'],[0.8,'#ef6548','0.80-0.84'],[0.7,'#fdae61','0.70-0.79'],[0.6,'#fee090','0.60-0.69'],[0.4,'#abd9e9','0.40-0.59'],[-1,'#74add1','below 0.40']];

const S={example:null,archive:null,admin:null,integrated:null,provGeo:null,distGeo:null,llgGeo:null,charts:{}};

const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(v,dp=2)=>v==null||isNaN(v)?'--':Number(v).toFixed(dp);
const int=v=>v==null||isNaN(v)?'--':Math.round(v).toLocaleString('en-US');
const pct=(v,dp=0)=>v==null||isNaN(v)?'--':(v*100).toFixed(dp)+'%';
function phaseOf(v){if(v==null||isNaN(v))return'No data';if(v>=0.8)return'Response';if(v>=0.6)return'Anticipatory Action';if(v>=0.4)return'Readiness';return'Monitoring'}
const phaseCls=p=>p==='Response'?'Response':p==='Anticipatory Action'?'AA':p==='Readiness'?'Readiness':p==='Monitoring'?'Monitoring':'NoData';
const pill=p=>`<span class="pill ${phaseCls(p)}">${esc(p)}</span>`;
function colorOf(v){if(v==null||isNaN(v))return'#cbd5e1';for(const [t,c] of BANDS)if(v>=t)return c;return'#74add1'}
const provName=n=>PROV_ALIAS[n]||n;
const $=id=>document.getElementById(id);

function getJson(u,optional){return fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()}).catch(e=>{if(optional){console.warn(e);return null}throw e})}

// ---------- shared helpers ----------
function provinceRows(){
  const ex=S.example.provinces||{};const adm={};(S.admin?.provinces||[]).forEach(p=>adm[p.name]=p);
  const tl=S.archive?.timeline||[];const hist=S.archive?.cdi_history||{};
  return Object.keys(ex).sort().map(name=>{const h=hist[name]||[];const prev=h.length>1?h[h.length-2]:null;const a=adm[name]||{};
    return {name,cdi:ex[name].cdi,phase:phaseOf(ex[name].cdi),prev,change:prev==null?null:ex[name].cdi-prev,ind:ex[name],
      population_2024:a.population_2024,pop_multidim_poverty:a.pop_multidim_poverty,pop_disability:a.pop_disability,households_2024:a.households_2024,
      pop_response:a.population_by_llg_phase?.Response,pop_aa:a.population_by_llg_phase?.['Anticipatory Action'],
      district_count:a.district_count,districts_in_response:a.districts_in_response,llg_count:a.llg_count,llgs_in_response:a.llgs_in_response,history:h,timeline:tl}})
}
function nationalSeries(){const tl=S.archive.timeline;const hist=S.archive.cdi_history;const names=Object.keys(hist);
  return tl.map((m,i)=>{const vals=names.map(n=>hist[n][i]).filter(v=>v!=null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null})}
function monthLabel(m){return m?MONTHS[m[1]]+' '+m[0]:''}
function flagLabel(f){return f>=1?'Declared':f>=0.5?'Alert':'OK'}
function flagOf(key,v){if(v==null)return null;if(key==='enso'||key==='iod')return v;
  const t={rain:[0,-0.5],sm:[-5,-15],vi:[0.4,0.3],fcast3:[0,-1]}[key];if(!t)return 0;return v<t[1]?1:v<t[0]?0.5:0}
function indicatorTable(d){const rows=[['enso','El Niño (ENSO)',d.enso,'20%'],['iod','Indian Ocean Dipole',d.iod,'10%'],['rain','Rainfall this month (SPI-1)',d.rain,'20%'],['sm','Soil moisture (% vs normal)',d.sm,'20%'],['vi','Vegetation health (VHI)',d.vi,'10%'],['fcast3','Rainfall forecast (SPI-3)',d.fcast3,'20%']];
  return `<table class="mini"><thead><tr><th>Signal</th><th>Value</th><th>Flag</th><th>Weight</th></tr></thead><tbody>${rows.map(([k,l,v,w])=>{const f=flagOf(k,v);return `<tr><td>${l}</td><td>${v==null?'--':(k==='sm'?Number(v).toFixed(1)+'%':Number(v).toFixed(2))}</td><td><span class="flag f${f>=1?2:f>=0.5?1:0}">${flagLabel(f)}</span></td><td>${w}</td></tr>`}).join('')}</tbody></table>`}
function legendHtml(title){return `<b>${esc(title)}</b><br>`+BANDS.map(([t,c,l])=>`<span class="swatch" style="background:${c}"></span>${l}${t===0.8?' <b>Response</b>':t===0.6?' <b>AA</b>':''}`).join('<br>')+`<br><span class="swatch" style="background:#cbd5e1"></span>No data`}
function downloadCsv(name,cols,rows){const csv=[cols.map(c=>c[0])].concat(rows.map(r=>cols.map(c=>{const v=c[1](r);return v==null?'':v}))).map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function mkChart(id,cfg){if(S.charts[id])S.charts[id].destroy();const el=$(id);if(!el)return null;S.charts[id]=new Chart(el,cfg);return S.charts[id]}

// ---------- Overview ----------
function renderOverview(){
  const rows=provinceRows();const ex=S.example;const adm=S.admin;
  const nat=rows.reduce((a,r)=>a+r.cdi,0)/rows.length;const ns=nationalSeries();const natPrev=ns.length>1?ns[ns.length-2]:null;
  const count=p=>rows.filter(r=>r.phase===p).length;
  $('ovReport').textContent=ex.reporting_month_label||'--';
  $('ovReportSub').textContent=(ex.observation_month_label?ex.observation_month_label+' observations':'')+(ex.forecast_window_label?' · forecast '+ex.forecast_window_label:'');
  $('ovNational').textContent=fmt(nat);
  $('ovNationalSub').innerHTML=pill(phaseOf(nat))+(natPrev!=null?` <span class="small">${nat>=natPrev?'up':'down'} from ${fmt(natPrev)} last month</span>`:'');
  $('ovProvResp').textContent=count('Response')+' of '+rows.length;
  $('ovProvRespSub').textContent=count('Anticipatory Action')+' in Anticipatory Action, '+count('Readiness')+' in Readiness';
  if(adm){const sl=adm.summary.llgs,sd=adm.summary.districts;
    $('ovPopResp').textContent=int(sl.Response.population_2024);
    $('ovPopRespSub').textContent='people in '+sl.Response.units+' of '+adm.llgs.length+' LLGs ('+sd.Response.units+' of '+adm.districts.length+' districts) at Response level';}
  // rank in history
  const sorted=ns.map((v,i)=>[v,i]).filter(x=>x[0]!=null).sort((a,b)=>b[0]-a[0]);const rank=sorted.findIndex(x=>x[1]===ns.length-1)+1;
  const peak=sorted[0];
  $('ovSummary').innerHTML=`<p>The ${esc(ex.reporting_month_label||'latest')} CDI (${esc(ex.observation_month_label||'')} observations) puts the national average at <b>${fmt(nat)}</b>${rank?`, the <b>${rank===1?'highest':ordinal(rank)+' highest'}</b> monthly value since ${S.archive.timeline[0][0]}`:''}${rank!==1&&peak?` (peak ${fmt(peak[0])} in ${monthLabel(S.archive.timeline[peak[1]])})`:''}. <b>${count('Response')}</b> provinces are at the Response threshold and <b>${count('Anticipatory Action')}</b> are in Anticipatory Action.</p>`+
    (adm?`<p>Looking inside provinces, <b>${adm.summary.llgs.Response.units}</b> of ${adm.llgs.length} LLGs have an average CDI at Response level. About <b>${int(adm.summary.llgs.Response.population_2024)}</b> people (NSO 2024) live in those LLGs, and <b>${int(adm.summary.llgs['Anticipatory Action'].population_2024)}</b> live in LLGs at Anticipatory Action.</p>`:'')+
    `<p class="small">Use the Province, District and LLG tabs to see each area on its own map. The CDI flags where climate signals are converging; field verification decides the response.</p>`;
  // ENSO / IOD
  const ctx=S.integrated?.enso_iod_context;const anyP=rows[0]?.ind||{};
  $('ovEnso').innerHTML=ctx?`${esc(ctx.enso_phase||'--')}<br><span class="small">ONI ${fmt(ctx.oni_value)} (${esc(ctx.oni_period||'')}) · CDI flag ${flagLabel(anyP.enso)}</span>`:`CDI flag ${flagLabel(anyP.enso)}`;
  $('ovIod').innerHTML=ctx?`${esc(ctx.iod_phase||'--')}<br><span class="small">DMI ${fmt(ctx.dmi_value)} (${esc(ctx.dmi_period||'')}) · CDI flag ${flagLabel(anyP.iod)}</span>`:`CDI flag ${flagLabel(anyP.iod)}`;
  $('ovDrivers').textContent=`Together these two signals add ${fmt(0.2*(anyP.enso||0)+0.1*(anyP.iod||0))} to every province's CDI this month.`;
  // ranking chart
  const rk=[...rows].sort((a,b)=>b.cdi-a.cdi);
  mkChart('ovRankChart',{type:'bar',data:{labels:rk.map(r=>r.name),datasets:[{data:rk.map(r=>r.cdi),backgroundColor:rk.map(r=>colorOf(r.cdi)),borderRadius:4}]},
    options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'CDI '+fmt(c.raw)+' · '+phaseOf(c.raw)}}},scales:{x:{min:0,max:1,grid:{color:'#eef2f6'}},y:{grid:{display:false},ticks:{autoSkip:false,font:{size:11}}}}}});
  // national trend
  renderTrend();
  // movers
  const mv=rows.filter(r=>r.change!=null).sort((a,b)=>b.change-a.change);
  const up=mv.filter(r=>r.change>0),dn=mv.filter(r=>r.change<0).reverse();
  $('ovMovers').innerHTML=`<div class="movers"><div><h3>Rose since last month (${up.length})</h3>${up.length?up.map(r=>`<div class="mv"><span>${esc(r.name)}</span><span>${fmt(r.prev)} → <b>${fmt(r.cdi)}</b></span></div>`).join(''):'<p class="small">None</p>'}</div><div><h3>Eased since last month (${dn.length})</h3>${dn.length?dn.map(r=>`<div class="mv"><span>${esc(r.name)}</span><span>${fmt(r.prev)} → <b>${fmt(r.cdi)}</b></span></div>`).join(''):'<p class="small">None</p>'}</div></div><p class="small">${mv.length-up.length-dn.length} provinces unchanged.</p>`;
  // population by phase
  if(adm){const sl=adm.summary.llgs;const tot=PHASES.reduce((a,p)=>a+(sl[p]?.population_2024||0),0);
    $('ovPopPhase').innerHTML=PHASES.filter(p=>sl[p]&&sl[p].units).map(p=>`<div class="tile">${pill(p)}<b>${int(sl[p].population_2024)}</b><span class="small">${pct(sl[p].population_2024/tot,1)} of people · ${sl[p].units} LLGs</span></div>`).join('');}
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])}
function renderTrend(){const span=$('ovTrendSpan')?.value||'60';const ns=nationalSeries();const tl=S.archive.timeline;const n=span==='all'?ns.length:Math.min(ns.length,+span);
  const labels=tl.slice(-n).map(monthLabel),data=ns.slice(-n);
  mkChart('ovTrendChart',{type:'line',data:{labels,datasets:[{label:'National average CDI',data,borderColor:'#b30000',backgroundColor:'rgba(179,0,0,.08)',fill:true,pointRadius:0,borderWidth:2,tension:.2},
    {label:'Response (0.80)',data:labels.map(()=>0.8),borderColor:'#7f0000',borderDash:[6,4],pointRadius:0,borderWidth:1},{label:'Anticipatory Action (0.60)',data:labels.map(()=>0.6),borderColor:'#f59e0b',borderDash:[6,4],pointRadius:0,borderWidth:1}]},
    options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:12}}},scales:{y:{min:0,max:1,grid:{color:'#eef2f6'}},x:{grid:{display:false},ticks:{maxTicksLimit:12}}}}})}

// ---------- Province / District / LLG tabs ----------
const LEVELS={
  province:{title:'Province',geo:()=>S.provGeo,key:f=>provName(f.properties.PROVNAME),rows:()=>provinceRows(),id:r=>r.name,value:r=>r.cdi,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['change_desc','Biggest rise since last month'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>`<b>${esc(r.name)}</b>`],['CDI',r=>fmt(r.cdi)],['Phase',r=>pill(r.phase)],['Last month',r=>fmt(r.prev)],['Change',r=>r.change==null?'--':(r.change>0?'+':'')+fmt(r.change)],['Districts at Response',r=>r.district_count==null?'--':r.districts_in_response+' of '+r.district_count],['LLGs at Response',r=>r.llg_count==null?'--':r.llgs_in_response+' of '+r.llg_count],['Population 2024',r=>int(r.population_2024)],['People in Response LLGs',r=>int(r.pop_response)]],
    csv:[['province',r=>r.name],['cdi',r=>r.cdi],['phase',r=>r.phase],['cdi_last_month',r=>r.prev],['enso_flag',r=>r.ind.enso],['iod_flag',r=>r.ind.iod],['rain_spi1',r=>r.ind.rain],['soil_moisture_pct',r=>r.ind.sm],['vhi',r=>r.ind.vi],['forecast_spi3',r=>r.ind.fcast3],['population_2024',r=>r.population_2024],['pop_in_response_llgs',r=>r.pop_response],['pop_in_aa_llgs',r=>r.pop_aa],['districts_in_response',r=>r.districts_in_response],['llgs_in_response',r=>r.llgs_in_response]]},
  district:{title:'District',geo:()=>S.distGeo,key:f=>f.properties.geocode,rows:()=>S.admin?.districts||[],id:r=>r.geocode,value:r=>r.cdi_mean,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>esc(r.province)],['District',r=>`<b>${esc(r.name)}</b>`],['Mean CDI',r=>fmt(r.cdi_mean)],['Phase',r=>pill(r.phase)],['% area at Response',r=>pct(r.pct_area_response)],['Pixel range',r=>r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max)],['Province CDI',r=>fmt(r.province_cdi)],['LLGs at Response',r=>r.llgs_in_response+' of '+r.llg_count],['Population 2024',r=>int(r.population_2024)]],
    csv:null,csvFile:'data/cdi_district_latest.csv'},
  llg:{title:'LLG',geo:()=>S.llgGeo,key:f=>f.properties.geocode,rows:()=>S.admin?.llgs||[],id:r=>r.geocode,value:r=>r.cdi_mean,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>esc(r.province)],['District',r=>esc(r.district)],['LLG',r=>`<b>${esc(r.name)}</b>`],['Mean CDI',r=>fmt(r.cdi_mean)],['Phase',r=>pill(r.phase)],['% area at Response',r=>pct(r.pct_area_response)],['Pixel range',r=>r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max)],['Province CDI',r=>fmt(r.province_cdi)],['Population 2024',r=>int(r.population_2024)]],
    csv:null,csvFile:'data/cdi_llg_latest.csv'}
};
const TABS={};

function sortRows(rows,sort,lv){const v=r=>{const x=lv.value(r);return x==null?-1:x};const c=[...rows];
  if(sort==='cdi_asc')c.sort((a,b)=>(lv.value(a)==null)-(lv.value(b)==null)||v(a)-v(b));
  else if(sort==='pop_desc')c.sort((a,b)=>(b.population_2024||0)-(a.population_2024||0));
  else if(sort==='change_desc')c.sort((a,b)=>(b.change??-9)-(a.change??-9));
  else if(sort==='name_asc')c.sort((a,b)=>a.name.localeCompare(b.name));
  else c.sort((a,b)=>v(b)-v(a));return c}

function buildTab(level){
  const lv=LEVELS[level];const p=level;const T={level,lv,selected:null,map:null,layer:null,byId:{},rows:lv.rows()};TABS[level]=T;
  T.rows.forEach(r=>T.byId[lv.id(r)]=r);
  const provs=[...new Set((S.admin?.districts||[]).map(r=>r.province).concat(Object.keys(S.example.provinces||{})))].sort();
  const pf=$(p+'Province');if(pf)pf.innerHTML='<option value="">All provinces</option>'+provs.map(x=>`<option>${esc(x)}</option>`).join('');
  $(p+'Sort').innerHTML=lv.sorts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  $(p+'Head').innerHTML='<tr>'+lv.cols.map(c=>`<th>${c[0]}</th>`).join('')+'</tr>';
  ['Province','Sort'].forEach(k=>$(p+k)&&$(p+k).addEventListener('change',()=>{renderTable(level);if(k==='Province')zoomToProvince(level)}));
  $(p+'Search').addEventListener('input',()=>renderTable(level));
  $(p+'Select').addEventListener('change',e=>{if(e.target.value)select(level,e.target.value,true)});
  $(p+'Csv').addEventListener('click',()=>{if(lv.csv)downloadCsv('adapt_cdi_'+level+'.csv',lv.csv,sortRows(filtered(level),$(p+'Sort').value,lv));else{const a=document.createElement('a');a.href=lv.csvFile;a.download='';a.click()}});
  renderTable(level);
}
function filtered(level){const T=TABS[level],lv=T.lv,p=level;const prov=$(p+'Province')?.value||'';const q=($(p+'Search').value||'').trim().toLowerCase();
  return T.rows.filter(r=>(!prov||(r.province||r.name)===prov)&&(!q||[r.name,r.district,r.province].some(x=>x&&x.toLowerCase().includes(q))))}
function renderTable(level){const T=TABS[level],lv=T.lv,p=level;const rows=sortRows(filtered(level),$(p+'Sort').value,lv);
  $(p+'Body').innerHTML=rows.length?rows.map(r=>`<tr data-id="${esc(lv.id(r))}" class="${T.selected===lv.id(r)?'sel':''}">${lv.cols.map(c=>`<td>${c[1](r)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${lv.cols.length}">No matching rows.</td></tr>`;
  $(p+'Body').querySelectorAll('tr[data-id]').forEach(tr=>tr.addEventListener('click',()=>select(level,tr.dataset.id,true)));
  const sel=$(p+'Select');const cur=T.selected;
  sel.innerHTML=`<option value="">Choose ${level==='llg'?'an LLG':'a '+lv.title.toLowerCase()}…</option>`+sortRows(filtered(level),'name_asc',lv).map(r=>`<option value="${esc(lv.id(r))}">${esc(r.name)}${level!=='province'?' ('+esc(level==='llg'?r.district+', ':'')+esc(r.province)+')':''}</option>`).join('');
  if(cur)sel.value=cur;
  $(p+'Count').textContent=rows.length+' shown';
}
function initMap(level){const T=TABS[level];if(T.map)return;const lv=T.lv;
  const m=L.map(level+'Map',{scrollWheelZoom:false}).setView([-6.3,147],6);T.map=m;
  const base={'OpenStreetMap':L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}),
    'Topographic':L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'}),
    'Satellite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'Tiles &copy; Esri'})};
  base['OpenStreetMap'].addTo(m);
  m.createPane('px');m.getPane('px').style.zIndex=300;m.createPane('units');m.getPane('units').style.zIndex=400;m.createPane('outline');m.getPane('outline').style.zIndex=450;m.getPane('outline').style.pointerEvents='none';
  const overlays={};
  const tile=S.integrated?.layers?.cdi_tile_url;if(tile){overlays['CDI pixels (~5 km)']=L.tileLayer(tile,{pane:'px',opacity:.85,attribution:'ADAPt pixel-level CDI'})}
  const style=f=>{const r=T.byId[lv.key(f)];return{color:'#ffffff',weight:level==='llg'?.6:1,fillColor:colorOf(r?lv.value(r):null),fillOpacity:.82}};
  T.layer=L.geoJSON(lv.geo(),{pane:'units',style,onEachFeature:(f,l)=>{const id=lv.key(f);const r=T.byId[id];
    l.bindTooltip(r?`<b>${esc(r.name)}</b>${level!=='province'?'<br>'+esc(level==='llg'?r.district+', ':'')+esc(r.province):''}<br>CDI ${fmt(lv.value(r))} · ${esc(r.phase)}`:'No data',{sticky:true});
    l.on({click:()=>select(level,id,false),mouseover:e=>{e.target.setStyle({weight:2.5,color:'#111827'});e.target.bringToFront()},mouseout:e=>{T.layer.resetStyle(e.target);highlight(level)}})}}).addTo(m);
  overlays[lv.title+'s (CDI)']=T.layer;
  if(level!=='province'&&S.provGeo){T.outline=L.geoJSON(S.provGeo,{pane:'outline',style:{color:'#1f2937',weight:1.4,fill:false},interactive:false}).addTo(m);overlays['Province boundaries']=T.outline}
  L.control.layers(base,overlays,{collapsed:true,position:'topright'}).addTo(m);
  const lg=L.control({position:'bottomleft'});lg.onAdd=()=>{const d=L.DomUtil.create('div','map-legend');d.innerHTML=legendHtml(level==='province'?'Province CDI':'Mean CDI');return d};lg.addTo(m);
  m.fitBounds(PNG_BOUNDS);
  if(T.selected)highlight(level);
}
function highlight(level){const T=TABS[level];if(!T.layer)return;T.layer.eachLayer(l=>{if(T.lv.key(l.feature)===T.selected){l.setStyle({weight:3,color:'#0f172a'});l.bringToFront()}})}
function zoomToProvince(level){const T=TABS[level];if(!T.map)return;const prov=$(level+'Province').value;
  if(!prov){T.map.fitBounds(PNG_BOUNDS);return}
  const ls=[];T.layer.eachLayer(l=>{const r=T.byId[T.lv.key(l.feature)];if(r&&r.province===prov)ls.push(l)});if(ls.length)T.map.fitBounds(L.featureGroup(ls).getBounds(),{padding:[20,20]})}
function select(level,id,zoom){const T=TABS[level];const r=T.byId[id];if(!r)return;T.selected=id;
  if(T.layer){T.layer.eachLayer(l=>T.layer.resetStyle(l));highlight(level);if(zoom){T.layer.eachLayer(l=>{if(T.lv.key(l.feature)===id)T.map.fitBounds(l.getBounds(),{padding:[40,40],maxZoom:level==='llg'?9:8})})}}
  $(level+'Select').value=id;$(level+'Body').querySelectorAll('tr').forEach(tr=>tr.classList.toggle('sel',tr.dataset.id===id));
  $(level+'Detail').innerHTML=detailHtml(level,r);
  if(level==='province')provinceSpark(r);
  $(level+'Detail').querySelectorAll('[data-jump]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const [lvl,jid]=a.dataset.jump.split('|');openTab(lvl);setTimeout(()=>select(lvl,jid,true),250)}));
}
function stat(label,val,sub){return `<div class="dstat"><span class="muted">${label}</span><b>${val}</b>${sub?`<span class="small">${sub}</span>`:''}</div>`}
function popBlock(r){return `<div class="dgrid">${stat('Population 2024',int(r.population_2024))}${stat('Households',int(r.households_2024))}${stat('Multidimensionally poor',int(r.pop_multidim_poverty))}${stat('Living with disability',int(r.pop_disability))}</div>`}
function detailHtml(level,r){
  if(level==='province'){const kids=(S.admin?.districts||[]).filter(d=>d.province===r.name).sort((a,b)=>(b.cdi_mean||0)-(a.cdi_mean||0));
    const prof=(typeof PROVINCE_LIVELIHOOD_PROFILES!=='undefined')?PROVINCE_LIVELIHOOD_PROFILES[r.name]:null;
    return `<h2>${esc(r.name)}</h2><div class="bigval" style="--c:${colorOf(r.cdi)}">${fmt(r.cdi)}</div>${pill(r.phase)} <span class="small">${r.prev==null?'':'last month '+fmt(r.prev)+(r.change?(r.change>0?' (up ':' (down ')+fmt(Math.abs(r.change))+')':' (no change)')}</span>
      <h3>What drives this month's score</h3>${indicatorTable(r.ind)}
      <h3>CDI over the last 24 months</h3><div style="height:150px"><canvas id="provSpark"></canvas></div>
      ${r.population_2024!=null?`<h3>People</h3>${popBlock(r)}<p class="small"><b>${int(r.pop_response)}</b> live in LLGs at Response level and <b>${int(r.pop_aa)}</b> in LLGs at Anticipatory Action.</p>`:''}
      ${kids.length?`<h3>Districts</h3><table class="mini"><thead><tr><th>District</th><th>Mean CDI</th><th>Phase</th></tr></thead><tbody>${kids.map(d=>`<tr><td><a href="#" data-jump="district|${esc(d.geocode)}">${esc(d.name)}</a></td><td>${fmt(d.cdi_mean)}</td><td>${pill(d.phase)}</td></tr>`).join('')}</tbody></table>`:''}
      ${prof?`<h3>Livelihoods and likely impacts</h3><p class="small"><b>Livelihoods:</b> ${esc(prof.livelihoods)}</p><p class="small"><b>Impact of dry conditions:</b> ${esc(prof.impact)}</p>`:''}`}
  const diff=r.cdi_mean==null||r.province_cdi==null?null:r.cdi_mean-r.province_cdi;
  const head=`<h2>${esc(r.name)}${level==='llg'?' LLG':' District'}</h2><p class="small">${level==='llg'?`<a href="#" data-jump="district|${esc(r.district_geocode)}">${esc(r.district)} District</a>, `:''}<a href="#" data-jump="province|${esc(r.province)}">${esc(r.province)}</a></p>
    <div class="bigval" style="--c:${colorOf(r.cdi_mean)}">${fmt(r.cdi_mean)}</div>${pill(r.phase)}
    <div class="dgrid">${stat('Pixel range',r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max))}${stat('Area at Response',pct(r.pct_area_response))}${stat('Area at Anticipatory Action',pct(r.pct_area_aa))}${stat('Province CDI (official)',fmt(r.province_cdi),diff==null?'':(diff>=0?'this area is ':'this area is ')+fmt(Math.abs(diff))+(diff>=0?' higher':' lower'))}</div>
    ${r.pixel_coverage!=null&&r.pixel_coverage<0.9?`<p class="small warnline">Only ${pct(r.pixel_coverage)} of this area has CDI pixels (small islands or coast).</p>`:''}
    <h3>People</h3>${popBlock(r)}`;
  if(level==='district'){const kids=(S.admin?.llgs||[]).filter(l=>l.district_geocode===r.geocode).sort((a,b)=>(b.cdi_mean||0)-(a.cdi_mean||0));
    return head+`<h3>LLGs in this district</h3><table class="mini"><thead><tr><th>LLG</th><th>Mean CDI</th><th>Phase</th><th>People</th></tr></thead><tbody>${kids.map(l=>`<tr><td><a href="#" data-jump="llg|${esc(l.geocode)}">${esc(l.name)}</a></td><td>${fmt(l.cdi_mean)}</td><td>${pill(l.phase)}</td><td>${int(l.population_2024)}</td></tr>`).join('')}</tbody></table>`}
  return head+(r.census_2024_llgs?`<p class="small">2024 census LLGs counted here: ${esc(r.census_2024_llgs)}</p>`:'')
}
function provinceSpark(r){const n=24;const h=r.history.slice(-n),tl=r.timeline.slice(-n);
  mkChart('provSpark',{type:'line',data:{labels:tl.map(monthLabel),datasets:[{data:h,borderColor:'#b30000',pointRadius:2,pointBackgroundColor:h.map(colorOf),borderWidth:2,tension:.15},{data:tl.map(()=>0.8),borderColor:'#7f0000',borderDash:[5,4],pointRadius:0,borderWidth:1},{data:tl.map(()=>0.6),borderColor:'#f59e0b',borderDash:[5,4],pointRadius:0,borderWidth:1}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:1,ticks:{stepSize:.2}},x:{ticks:{maxTicksLimit:6,font:{size:10}},grid:{display:false}}}}})}

// ---------- tabs ----------
function openTab(panel){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.panel===panel));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===panel));
  if(TABS[panel]){initMap(panel);setTimeout(()=>TABS[panel].map&&TABS[panel].map.invalidateSize(),120)}
  setTimeout(()=>Object.values(S.charts).forEach(c=>c&&c.resize&&c.resize()),60);
  try{history.replaceState(null,'','#'+panel)}catch(e){}}
function initTabs(){document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.panel)));}

function setMeta(){const ex=S.example;const t=`${ex.reporting_month_label||''} report · ${ex.observation_month_label||''} observations`;
  document.querySelectorAll('.cdiPeriod').forEach(e=>e.textContent=t);
  $('heroPeriod').textContent=(ex.reporting_month_label||'Latest')+' CDI report';
  $('footerMeta').innerHTML=`CDI: ${esc(t)}${S.admin?'<br>District/LLG figures updated '+esc(S.admin.generated_utc):''}`}

function init(){initTabs();$('ovTrendSpan')?.addEventListener('change',renderTrend);
  Promise.all([getJson('data/cdi_example_latest.json'),getJson('data/cdi_archive.json'),getJson('data/cdi_admin_latest.json',true),getJson('data/integrated_priority_latest.json',true),
    getJson('adm1_nso_province.geojson',true),getJson('adm2_nso_district.geojson',true),getJson('adm3_nso_llg.geojson',true)])
  .then(([ex,ar,adm,integ,pg,dg,lg])=>{Object.assign(S,{example:ex,archive:ar,admin:adm,integrated:integ,provGeo:pg,distGeo:dg,llgGeo:lg});
    setMeta();renderOverview();
    ['province','district','llg'].forEach(l=>{if(LEVELS[l].geo()&&LEVELS[l].rows().length)buildTab(l);else{const d=$(l+'Detail');if(d)d.innerHTML='<p>Data for this level is not available yet.</p>'}});
    const fromHash=()=>{const h=(location.hash||'').slice(1);if(h&&$(h)&&$(h).classList.contains('panel'))openTab(h)};fromHash();window.addEventListener('hashchange',fromHash);
  }).catch(e=>{console.error(e);const s=$('ovSummary');if(s)s.innerHTML='<p>CDI data could not be loaded right now. Please try again later.</p>'})}
window.ADAPT_CDI={state:S,openTab,select,phaseOf,colorOf};
document.addEventListener('DOMContentLoaded',init);
})();
