// ADAPt CDI dashboard: hero, Overview, Province, District and LLG tabs.
// Data (all published by the GitHub workflows in this repo):
//   data/cdi_example_latest.json      official province CDI + six indicator values (monthly)
//   data/cdi_archive.json             province CDI history since 1996
//   data/cdi_admin_latest.json        district/LLG means of the pixel CDI + NSO 2024 population
//   data/integrated_priority_latest.json  pixel CDI tile URL and ENSO/IOD values
// Boundaries: adm1_nso_province.geojson, adm2_nso_district.geojson, adm3_nso_llg.geojson
// Theme (light/dark, basemaps) comes from assets/theme.js.
(function(){
'use strict';

const PHASES=['Response','Anticipatory Action','Readiness','Monitoring','No data'];
const PROV_ALIAS={'Chimbu (Simbu)':'Chimbu','Gulf Province':'Gulf','Milne Bay Province':'Milne Bay','Northern (Oro)':'Oro','West Sepik (Sandaun)':'Sandaun','Northern':'Oro','West Sepik':'Sandaun','Simbu':'Chimbu'};
const PNG_BOUNDS=[[-11.6,141.0],[-1.0,156.0]];
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Map colour steps (lowest threshold first in the legend bar). Response starts at 0.80.
const BANDS=[[0.95,'#5A0B1F','0.95'],[0.9,'#8C1630','0.90'],[0.85,'#B5263B','0.85'],[0.8,'#D6514A','0.80'],[0.7,'#EB8C4C','0.70'],[0.6,'#F4C26B','0.60'],[0.4,'#B7D1E1','0.40'],[-1,'#7DA4BF','0']];
const NODATA='#C9C6BE';
const THEME=window.ADAPT_THEME||{get:()=>'light',onChange:()=>{},cssVar:()=>'',themedBasemap:null};
const reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const S={example:null,archive:null,admin:null,integrated:null,provGeo:null,distGeo:null,llgGeo:null,charts:{}};

const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(v,dp=2)=>v==null||isNaN(v)?'--':Number(v).toFixed(dp);
const int=v=>v==null||isNaN(v)?'--':Math.round(v).toLocaleString('en-US');
const pct=(v,dp=0)=>v==null||isNaN(v)?'--':(v*100).toFixed(dp)+'%';
function phaseOf(v){if(v==null||isNaN(v))return'No data';if(v>=0.8)return'Response';if(v>=0.6)return'Anticipatory Action';if(v>=0.4)return'Readiness';return'Monitoring'}
const phaseCls=p=>p==='Response'?'Response':p==='Anticipatory Action'?'AA':p==='Readiness'?'Readiness':p==='Monitoring'?'Monitoring':'NoData';
const pill=p=>`<span class="pill ${phaseCls(p)}">${esc(p)}</span>`;
function colorOf(v){if(v==null||isNaN(v))return NODATA;for(const [t,c] of BANDS)if(v>=t)return c;return BANDS[BANDS.length-1][1]}
const provName=n=>PROV_ALIAS[n]||n;
const $=id=>document.getElementById(id);
const css=n=>THEME.cssVar(n)||'';

function getJson(u,optional){return fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()}).catch(e=>{if(optional){console.warn(e);return null}throw e})}

// ---------- motion helpers ----------
function countUp(el,to,opts={}){if(!el)return;const dp=opts.dp??0,suffix=opts.suffix||'',fmtFn=opts.format||(v=>dp?v.toFixed(dp):Math.round(v).toLocaleString('en-US'));
  if(to==null||isNaN(to)){el.textContent='--';return}
  if(reduceMotion){el.textContent=fmtFn(to)+suffix;return}
  const dur=opts.dur||1400,t0=performance.now();const ease=t=>1-Math.pow(1-t,4);
  const step=now=>{const t=Math.min(1,(now-t0)/dur);el.textContent=fmtFn(to*ease(t))+suffix;if(t<1)requestAnimationFrame(step)};requestAnimationFrame(step)}
function stagger(root){(root||document).querySelectorAll('.panel>.grid').forEach(g=>[...g.children].forEach((c,i)=>c.style.setProperty('--i',i)))}

// ---------- chart theming ----------
function chartTheme(){if(!window.Chart)return;const ink=css('--muted')||'#6B717B',line=css('--line')||'#E4E0D6';
  Chart.defaults.font.family="'Inter',system-ui,sans-serif";Chart.defaults.font.size=12;Chart.defaults.color=ink;Chart.defaults.borderColor=line;
  Chart.defaults.plugins.tooltip.backgroundColor='rgba(14,18,24,.92)';Chart.defaults.plugins.tooltip.padding=12;Chart.defaults.plugins.tooltip.cornerRadius=10;
  Chart.defaults.plugins.tooltip.titleFont={family:"'Fraunces',serif",size:14,weight:'500'};Chart.defaults.plugins.tooltip.bodyFont={family:"'Inter',sans-serif",size:12};
  Chart.defaults.plugins.legend.labels.usePointStyle=true;Chart.defaults.plugins.legend.labels.pointStyle='circle';Chart.defaults.plugins.legend.labels.boxWidth=8;
  Chart.defaults.animation.duration=reduceMotion?0:1100;Chart.defaults.animation.easing='easeOutQuart'}
// Restyle charts this file did not create (About tab history/components) after a theme change.
function restyleForeignCharts(){if(!window.Chart||!Chart.instances)return;const ink=css('--muted'),line=css('--line');const mine=Object.values(S.charts);
  Object.values(Chart.instances).forEach(ch=>{if(mine.includes(ch))return;const o=ch.config.options||(ch.config.options={});o.scales=o.scales||{};
    Object.keys(ch.scales||{}).forEach(k=>{const sc=o.scales[k]=o.scales[k]||{};sc.ticks={...(sc.ticks||{}),color:ink};sc.grid={...(sc.grid||{}),color:line};if(sc.title)sc.title={...sc.title,color:ink}});
    o.plugins=o.plugins||{};o.plugins.legend={...(o.plugins.legend||{}),labels:{...((o.plugins.legend||{}).labels||{}),color:ink}};ch.update('none')})}
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
function indicatorTable(d){const rows=[['enso','El Niño (ENSO)',d.enso,'20%'],['iod','Indian Ocean Dipole',d.iod,'10%'],['rain','Rainfall this month (SPI-1)',d.rain,'20%'],['sm','Soil moisture vs normal',d.sm,'20%'],['vi','Vegetation health (VHI)',d.vi,'10%'],['fcast3','Rainfall forecast (SPI-3)',d.fcast3,'20%']];
  return `<table class="mini"><thead><tr><th>Signal</th><th>Value</th><th>Flag</th><th>Weight</th></tr></thead><tbody>${rows.map(([k,l,v,w])=>{const f=flagOf(k,v);return `<tr><td>${l}</td><td>${v==null?'--':(k==='sm'?Number(v).toFixed(1)+'%':Number(v).toFixed(2))}</td><td><span class="flag f${f>=1?2:f>=0.5?1:0}">${flagLabel(f)}</span></td><td>${w}</td></tr>`}).join('')}</tbody></table>`}
function legendHtml(title){const asc=[...BANDS].reverse();
  return `<span class="lg-title">${esc(title)}</span><div class="lg-bar">${asc.map(b=>`<i style="background:${b[1]}"></i>`).join('')}</div>`+
    `<div class="lg-ticks"><span>0</span><span>0.40</span><span>0.60</span><span>0.80</span><span>1.0</span></div>`+
    `<div class="lg-phases"><span><i style="background:var(--ready)"></i>Readiness</span><span><i style="background:var(--aa)"></i>Anticipatory</span><span><i style="background:var(--resp)"></i>Response</span></div>`}
function downloadCsv(name,cols,rows){const csv=[cols.map(c=>c[0])].concat(rows.map(r=>cols.map(c=>{const v=c[1](r);return v==null?'':v}))).map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function mkChart(id,cfg){if(S.charts[id])S.charts[id].destroy();const el=$(id);if(!el)return null;S.charts[id]=new Chart(el,cfg);return S.charts[id]}
function fadeGradient(color,top=.32){return c=>{const {chart}=c;const a=chart.chartArea;if(!a)return 'transparent';const g=chart.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,hexA(color,top));g.addColorStop(1,hexA(color,0));return g}}
function hexA(h,a){h=h.replace('#','');if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h,16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}

// ---------- hero ----------
function renderHero(){const rows=provinceRows();const nat=rows.reduce((a,r)=>a+r.cdi,0)/rows.length;
  countUp($('heroNat'),nat,{dp:2});countUp($('heroProv'),rows.filter(r=>r.phase==='Response').length,{format:v=>Math.round(v)+' / '+rows.length});
  if(S.admin){countUp($('heroLlg'),S.admin.summary.llgs.Response.units,{format:v=>Math.round(v)+' / '+S.admin.llgs.length});
    const p=S.admin.summary.llgs.Response.population_2024;countUp($('heroPop'),p/1e6,{format:v=>v.toFixed(1)+'M'})}
  const ex=S.example;$('heroPeriodTxt').textContent=(ex.reporting_month_label||'latest')+' report';}

// ---------- Overview ----------
function renderOverview(){
  const rows=provinceRows();const ex=S.example;const adm=S.admin;
  const nat=rows.reduce((a,r)=>a+r.cdi,0)/rows.length;const ns=nationalSeries();const natPrev=ns.length>1?ns[ns.length-2]:null;
  const count=p=>rows.filter(r=>r.phase===p).length;
  $('ovReport').textContent=ex.reporting_month_label||'--';
  $('ovReportSub').textContent=(ex.observation_month_label?ex.observation_month_label+' observations':'')+(ex.forecast_window_label?' · forecast '+ex.forecast_window_label:'');
  countUp($('ovNational'),nat,{dp:2});
  $('ovNationalSub').innerHTML=pill(phaseOf(nat))+(natPrev!=null?` <span>${nat>=natPrev?'up':'down'} from ${fmt(natPrev)} last month</span>`:'');
  countUp($('ovProvResp'),count('Response'),{format:v=>Math.round(v)+' of '+rows.length});
  $('ovProvRespSub').textContent=count('Anticipatory Action')+' in Anticipatory Action, '+count('Readiness')+' in Readiness';
  if(adm){const sl=adm.summary.llgs,sd=adm.summary.districts;
    countUp($('ovPopResp'),sl.Response.population_2024);
    $('ovPopRespSub').textContent='in '+sl.Response.units+' of '+adm.llgs.length+' LLGs ('+sd.Response.units+' of '+adm.districts.length+' districts) at Response level';}
  const sorted=ns.map((v,i)=>[v,i]).filter(x=>x[0]!=null).sort((a,b)=>b[0]-a[0]);const rank=sorted.findIndex(x=>x[1]===ns.length-1)+1;
  const peak=sorted[0];
  $('ovSummary').innerHTML=`<p class="lede">The ${esc(ex.reporting_month_label||'latest')} CDI puts Papua New Guinea's national average at <b>${fmt(nat)}</b>${rank?`, the <b>${rank===1?'highest':ordinal(rank)+' highest'}</b> monthly reading since ${S.archive.timeline[0][0]}`:''}${rank!==1&&peak?` (the record is ${fmt(peak[0])}, set in ${monthLabel(S.archive.timeline[peak[1]])})`:''}. <b>${count('Response')}</b> provinces are at the Response threshold and <b>${count('Anticipatory Action')}</b> are in Anticipatory Action.</p>`+
    (adm?`<p>Inside those provinces, <b>${adm.summary.llgs.Response.units}</b> of ${adm.llgs.length} LLGs average at Response level. About <b>${int(adm.summary.llgs.Response.population_2024)}</b> people live in them (NSO 2024), and another <b>${int(adm.summary.llgs['Anticipatory Action'].population_2024)}</b> live in LLGs at Anticipatory Action.</p>`:'')+
    `<p class="small">The CDI shows where climate signals are converging. Field verification decides the response.</p>`;
  const ctx=S.integrated?.enso_iod_context;const anyP=rows[0]?.ind||{};
  $('ovEnso').innerHTML=ctx?`${esc(ctx.enso_phase||'--')}<span class="small">ONI ${fmt(ctx.oni_value)} (${esc(ctx.oni_period||'')}) · CDI flag ${flagLabel(anyP.enso)}</span>`:`CDI flag ${flagLabel(anyP.enso)}`;
  $('ovIod').innerHTML=ctx?`${esc(ctx.iod_phase||'--')}<span class="small">DMI ${fmt(ctx.dmi_value)} (${esc(ctx.dmi_period||'')}) · CDI flag ${flagLabel(anyP.iod)}</span>`:`CDI flag ${flagLabel(anyP.iod)}`;
  $('ovDrivers').textContent=`Together they add ${fmt(0.2*(anyP.enso||0)+0.1*(anyP.iod||0))} of a possible 0.30 to every province's CDI this month.`;
  renderRank(rows);renderTrend();
  const mv=rows.filter(r=>r.change!=null).sort((a,b)=>b.change-a.change);
  const up=mv.filter(r=>r.change>0),dn=mv.filter(r=>r.change<0).reverse();
  const line=(r,cls,arrow)=>`<div class="mv"><span>${esc(r.name)}</span><span>${fmt(r.prev)} <span class="${cls}">${arrow}</span> <b>${fmt(r.cdi)}</b></span></div>`;
  $('ovMovers').innerHTML=`<div class="movers"><div><h3>Rose (${up.length})</h3>${up.length?up.map(r=>line(r,'up','↗')).join(''):'<p class="small">None</p>'}</div><div><h3>Eased (${dn.length})</h3>${dn.length?dn.map(r=>line(r,'down','↘')).join(''):'<p class="small">None</p>'}</div></div><p class="small" style="margin-top:10px">${(()=>{const n=mv.length-up.length-dn.length;return n===0?'No province unchanged.':n===1?'1 province unchanged.':n+' provinces unchanged.'})()}</p>`;
  if(adm){const sl=adm.summary.llgs;const tot=PHASES.reduce((a,p)=>a+(sl[p]?.population_2024||0),0);
    $('ovPopPhase').innerHTML=PHASES.filter(p=>sl[p]&&sl[p].units).map((p,i)=>`<div class="tile">${pill(p)}<b data-pop="${sl[p].population_2024}">0</b><span class="small">${pct(sl[p].population_2024/tot,1)} of people · ${sl[p].units} LLGs</span></div>`).join('')+
      `<div class="tile" style="grid-column:1/-1;padding:14px 18px"><div class="lg-bar" style="height:12px">${PHASES.filter(p=>sl[p]&&sl[p].units).map(p=>`<i style="flex:${sl[p].population_2024};background:var(--${{'Response':'resp','Anticipatory Action':'aa','Readiness':'ready','Monitoring':'mon','No data':'mon'}[p]})"></i>`).join('')}</div></div>`;
    $('ovPopPhase').querySelectorAll('[data-pop]').forEach(b=>countUp(b,+b.dataset.pop));}
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])}
function renderRank(rows){rows=rows||provinceRows();const rk=[...rows].sort((a,b)=>b.cdi-a.cdi);
  mkChart('ovRankChart',{type:'bar',data:{labels:rk.map(r=>r.name),datasets:[{data:rk.map(r=>r.cdi),backgroundColor:rk.map(r=>colorOf(r.cdi)),borderRadius:6,borderSkipped:false,barPercentage:.78,categoryPercentage:.9}]},
    options:{indexAxis:'y',maintainAspectRatio:false,animation:{delay:c=>reduceMotion?0:c.dataIndex*35},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'CDI '+fmt(c.raw)+' · '+phaseOf(c.raw)}}},
      scales:{x:{min:0,max:1,grid:{color:css('--line')},border:{display:false},ticks:{stepSize:.2}},y:{grid:{display:false},border:{display:false},ticks:{autoSkip:false,font:{size:12},color:css('--ink-2')}}}}})}
function renderTrend(){const span=$('ovTrendSpan')?.value||'60';const ns=nationalSeries();const tl=S.archive.timeline;const n=span==='all'?ns.length:Math.min(ns.length,+span);
  const labels=tl.slice(-n).map(monthLabel),data=ns.slice(-n);const red=css('--resp')||'#9C1C33';
  mkChart('ovTrendChart',{type:'line',data:{labels,datasets:[{label:'National average CDI',data,borderColor:red,backgroundColor:fadeGradient(red,.28),fill:true,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:red,borderWidth:2.2,tension:.35},
    {label:'Response (0.80)',data:labels.map(()=>0.8),borderColor:hexA(red,.55),borderDash:[4,5],pointRadius:0,borderWidth:1.2,fill:false},{label:'Anticipatory Action (0.60)',data:labels.map(()=>0.6),borderColor:css('--aa'),borderDash:[4,5],pointRadius:0,borderWidth:1.2,fill:false}]},
    options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',align:'start'}},scales:{y:{min:0,max:1,grid:{color:css('--line')},border:{display:false},ticks:{stepSize:.2}},x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:10,maxRotation:0}}}}})}

// ---------- Province / District / LLG tabs ----------
const LEVELS={
  province:{title:'Province',geo:()=>S.provGeo,key:f=>provName(f.properties.PROVNAME),rows:()=>provinceRows(),id:r=>r.name,value:r=>r.cdi,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['change_desc','Biggest rise since last month'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>`<b>${esc(r.name)}</b>`],['CDI',r=>cdiCell(r.cdi)],['Phase',r=>pill(r.phase)],['Last month',r=>fmt(r.prev)],['Change',r=>r.change==null?'--':(r.change>0?'+':'')+fmt(r.change)],['Districts at Response',r=>r.district_count==null?'--':r.districts_in_response+' of '+r.district_count],['LLGs at Response',r=>r.llg_count==null?'--':r.llgs_in_response+' of '+r.llg_count],['Population 2024',r=>int(r.population_2024)],['People in Response LLGs',r=>int(r.pop_response)]],
    csv:[['province',r=>r.name],['cdi',r=>r.cdi],['phase',r=>r.phase],['cdi_last_month',r=>r.prev],['enso_flag',r=>r.ind.enso],['iod_flag',r=>r.ind.iod],['rain_spi1',r=>r.ind.rain],['soil_moisture_pct',r=>r.ind.sm],['vhi',r=>r.ind.vi],['forecast_spi3',r=>r.ind.fcast3],['population_2024',r=>r.population_2024],['pop_in_response_llgs',r=>r.pop_response],['pop_in_aa_llgs',r=>r.pop_aa],['districts_in_response',r=>r.districts_in_response],['llgs_in_response',r=>r.llgs_in_response]]},
  district:{title:'District',geo:()=>S.distGeo,key:f=>f.properties.geocode,rows:()=>S.admin?.districts||[],id:r=>r.geocode,value:r=>r.cdi_mean,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>esc(r.province)],['District',r=>`<b>${esc(r.name)}</b>`],['Mean CDI',r=>cdiCell(r.cdi_mean)],['Phase',r=>pill(r.phase)],['Area at Response',r=>pct(r.pct_area_response)],['Pixel range',r=>r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max)],['Province CDI',r=>fmt(r.province_cdi)],['LLGs at Response',r=>r.llgs_in_response+' of '+r.llg_count],['Population 2024',r=>int(r.population_2024)]],
    csv:null,csvFile:'data/cdi_district_latest.csv'},
  llg:{title:'LLG',geo:()=>S.llgGeo,key:f=>f.properties.geocode,rows:()=>S.admin?.llgs||[],id:r=>r.geocode,value:r=>r.cdi_mean,
    sorts:[['cdi_desc','Highest CDI first'],['cdi_asc','Lowest CDI first'],['pop_desc','Most people first'],['name_asc','Name A-Z']],
    cols:[['Province',r=>esc(r.province)],['District',r=>esc(r.district)],['LLG',r=>`<b>${esc(r.name)}</b>`],['Mean CDI',r=>cdiCell(r.cdi_mean)],['Phase',r=>pill(r.phase)],['Area at Response',r=>pct(r.pct_area_response)],['Pixel range',r=>r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max)],['Province CDI',r=>fmt(r.province_cdi)],['Population 2024',r=>int(r.population_2024)]],
    csv:null,csvFile:'data/cdi_llg_latest.csv'}
};
const TABS={};
function cdiCell(v){return v==null?'--':`<span style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><i style="width:10px;height:10px;border-radius:3px;background:${colorOf(v)};display:inline-block"></i>${fmt(v)}</span>`}

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
function filtered(level){const T=TABS[level],p=level;const prov=$(p+'Province')?.value||'';const q=($(p+'Search').value||'').trim().toLowerCase();
  return T.rows.filter(r=>(!prov||(r.province||r.name)===prov)&&(!q||[r.name,r.district,r.province].some(x=>x&&x.toLowerCase().includes(q))))}
function renderTable(level){const T=TABS[level],lv=T.lv,p=level;const rows=sortRows(filtered(level),$(p+'Sort').value,lv);
  $(p+'Body').innerHTML=rows.length?rows.map(r=>`<tr data-id="${esc(lv.id(r))}" class="${T.selected===lv.id(r)?'sel':''}">${lv.cols.map(c=>`<td>${c[1](r)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${lv.cols.length}">No matching rows.</td></tr>`;
  $(p+'Body').querySelectorAll('tr[data-id]').forEach(tr=>tr.addEventListener('click',()=>{select(level,tr.dataset.id,true);$(level+'Map').scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'center'})}));
  const sel=$(p+'Select');const cur=T.selected;
  sel.innerHTML=`<option value="">Choose ${level==='llg'?'an LLG':'a '+lv.title.toLowerCase()}…</option>`+sortRows(filtered(level),'name_asc',lv).map(r=>`<option value="${esc(lv.id(r))}">${esc(r.name)}${level!=='province'?' ('+esc(level==='llg'?r.district+', ':'')+esc(r.province)+')':''}</option>`).join('');
  if(cur)sel.value=cur;
  $(p+'Count').textContent=rows.length+' shown';
}
function polyStyle(T){const lv=T.lv,level=T.level;return f=>{const r=T.byId[lv.key(f)];return{color:css('--map-stroke')||'#fff',weight:level==='llg'?.6:level==='district'?.9:1.2,fillColor:colorOf(r?lv.value(r):null),fillOpacity:.88}}}
function initMap(level){const T=TABS[level];if(T.map)return;const lv=T.lv;
  const m=L.map(level+'Map',{scrollWheelZoom:false,zoomControl:false,attributionControl:true}).setView([-6.3,148],6);T.map=m;
  L.control.zoom({position:'topleft'}).addTo(m);
  m.createPane('px');m.getPane('px').style.zIndex=300;m.createPane('units');m.getPane('units').style.zIndex=400;m.getPane('units').classList.add('leaflet-units-pane');m.createPane('outline');m.getPane('outline').style.zIndex=450;m.getPane('outline').style.pointerEvents='none';
  const bm=THEME.themedBasemap?THEME.themedBasemap(m):{base:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(m)};
  const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'Imagery &copy; Esri'});
  const base={'Map':bm.base,'Satellite':sat};
  const overlays={};
  const tile=S.integrated?.layers?.cdi_tile_url;if(tile){overlays['CDI pixels (~5 km)']=L.tileLayer(tile,{pane:'px',opacity:.9,attribution:'ADAPt pixel-level CDI'})}
  if(bm.labels)overlays['Place names']=bm.labels;
  T.style=polyStyle(T);
  T.layer=L.geoJSON(lv.geo(),{pane:'units',style:T.style,onEachFeature:(f,l)=>{const id=lv.key(f);const r=T.byId[id];
    l.bindTooltip(r?`<b>${esc(r.name)}</b>${level!=='province'?'<br><span style="opacity:.7">'+esc(level==='llg'?r.district+', ':'')+esc(r.province)+'</span>':''}<span class="tv">${fmt(lv.value(r))}</span><span style="opacity:.8">${esc(r.phase)}</span>`:'No data',{sticky:true,className:'adapt-tip',direction:'top',offset:[0,-12],opacity:1});
    l.on({click:()=>select(level,id,true),
      mouseover:e=>{const t=e.target;t.setStyle({weight:2.4,color:css('--ink')||'#111',fillOpacity:.96});t.bringToFront();t._path&&t._path.classList.add('hot')},
      mouseout:e=>{const t=e.target;T.layer.resetStyle(t);t._path&&t._path.classList.remove('hot');highlight(level)}})}}).addTo(m);
  overlays[lv.title+(level==='llg'?'s':'s')+' (CDI)']=T.layer;
  if(level!=='province'&&S.provGeo){T.outline=L.geoJSON(S.provGeo,{pane:'outline',style:{color:css('--ink')||'#14181E',weight:1.3,opacity:.55,fill:false},interactive:false}).addTo(m);overlays['Province boundaries']=T.outline}
  L.control.layers(base,overlays,{collapsed:true,position:'topright'}).addTo(m);
  const lg=L.control({position:'bottomleft'});lg.onAdd=()=>{const d=L.DomUtil.create('div','map-legend');d.innerHTML=legendHtml(level==='province'?'Province CDI':'Mean CDI');return d};lg.addTo(m);
  m.on('zoomstart movestart',()=>T.layer.eachLayer(l=>{l.closeTooltip();if(l._path)l._path.classList.remove('hot')}));
  m.fitBounds(PNG_BOUNDS);
  if(T.selected){highlight(level);zoomTo(level,T.selected)}
}
function highlight(level){const T=TABS[level];if(!T.layer)return;T.layer.eachLayer(l=>{if(T.lv.key(l.feature)===T.selected){l.setStyle({weight:3,color:css('--ink')||'#111',fillOpacity:.96});l.bringToFront()}})}
function zoomTo(level,id){const T=TABS[level];if(!T.map)return;T.layer.eachLayer(l=>{if(T.lv.key(l.feature)===id){const o={padding:[50,50],maxZoom:level==='llg'?9:level==='district'?8:7};if(reduceMotion)T.map.fitBounds(l.getBounds(),o);else T.map.flyToBounds(l.getBounds(),{...o,duration:.9,easeLinearity:.2})}})}
function zoomToProvince(level){const T=TABS[level];if(!T.map)return;const prov=$(level+'Province').value;
  if(!prov){reduceMotion?T.map.fitBounds(PNG_BOUNDS):T.map.flyToBounds(PNG_BOUNDS,{duration:.9});return}
  const ls=[];T.layer.eachLayer(l=>{const r=T.byId[T.lv.key(l.feature)];if(r&&r.province===prov)ls.push(l)});if(ls.length){const b=L.featureGroup(ls).getBounds();reduceMotion?T.map.fitBounds(b,{padding:[30,30]}):T.map.flyToBounds(b,{padding:[30,30],duration:.9})}}
function select(level,id,zoom){const T=TABS[level];const r=T.byId[id];if(!r)return;T.selected=id;
  if(T.layer){T.layer.eachLayer(l=>T.layer.resetStyle(l));highlight(level);if(zoom)zoomTo(level,id)}
  $(level+'Select').value=id;$(level+'Body').querySelectorAll('tr').forEach(tr=>tr.classList.toggle('sel',tr.dataset.id===id));
  $(level+'Detail').innerHTML=`<div class="anim">${detailHtml(level,r)}</div>`;
  const bv=$(level+'Detail').querySelector('.bigval [data-v]');if(bv)countUp(bv,+bv.dataset.v,{dp:2,dur:900});
  if(level==='province')provinceSpark(r);
  $(level+'Detail').querySelectorAll('[data-jump]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const [lvl,jid]=a.dataset.jump.split('|');openTab(lvl);setTimeout(()=>select(lvl,jid,true),300)}));
}
function stat(label,val,sub){return `<div class="dstat"><span class="muted">${label}</span><b>${val}</b>${sub?`<span class="small">${sub}</span>`:''}</div>`}
function popBlock(r){return `<div class="dgrid">${stat('Population 2024',int(r.population_2024))}${stat('Households',int(r.households_2024))}${stat('Multidimensionally poor',int(r.pop_multidim_poverty))}${stat('Living with disability',int(r.pop_disability))}</div>`}
function big(v){return `<div class="bigval" style="--c:${colorOf(v)}"><span data-v="${v==null?'':v}">${fmt(v)}</span><small>CDI</small></div>`}
function detailHtml(level,r){
  if(level==='province'){const kids=(S.admin?.districts||[]).filter(d=>d.province===r.name).sort((a,b)=>(b.cdi_mean||0)-(a.cdi_mean||0));
    const prof=(typeof PROVINCE_LIVELIHOOD_PROFILES!=='undefined')?PROVINCE_LIVELIHOOD_PROFILES[r.name]:null;
    return `<span class="eyebrow">Province</span><h2>${esc(r.name)}</h2>${big(r.cdi)}${pill(r.phase)} <span class="small">${r.prev==null?'':'last month '+fmt(r.prev)+(r.change?(r.change>0?' · up ':' · down ')+fmt(Math.abs(r.change)):' · no change')}</span>
      <h3>What drives this month's score</h3>${indicatorTable(r.ind)}
      <h3>Last 24 months</h3><div style="height:160px"><canvas id="provSpark"></canvas></div>
      ${r.population_2024!=null?`<h3>People</h3>${popBlock(r)}<p class="small" style="margin-top:10px"><b>${int(r.pop_response)}</b> live in LLGs at Response level and <b>${int(r.pop_aa)}</b> in LLGs at Anticipatory Action.</p>`:''}
      ${kids.length?`<h3>Districts</h3><table class="mini"><thead><tr><th>District</th><th>Mean CDI</th><th>Phase</th></tr></thead><tbody>${kids.map(d=>`<tr><td><a href="#" data-jump="district|${esc(d.geocode)}">${esc(d.name)}</a></td><td>${cdiCell(d.cdi_mean)}</td><td>${pill(d.phase)}</td></tr>`).join('')}</tbody></table>`:''}
      ${prof?`<h3>Livelihoods and likely impacts</h3><p class="small"><b>Livelihoods:</b> ${esc(prof.livelihoods)}</p><p class="small"><b>Impact of dry conditions:</b> ${esc(prof.impact)}</p>`:''}`}
  const diff=r.cdi_mean==null||r.province_cdi==null?null:r.cdi_mean-r.province_cdi;
  const head=`<span class="eyebrow">${level==='llg'?'Local-Level Government':'District'}</span><h2>${esc(r.name)}</h2><p class="small">${level==='llg'?`<a href="#" data-jump="district|${esc(r.district_geocode)}">${esc(r.district)} District</a> · `:''}<a href="#" data-jump="province|${esc(r.province)}">${esc(r.province)}</a></p>
    ${big(r.cdi_mean)}${pill(r.phase)}
    <div class="dgrid">${stat('Pixel range',r.cdi_min==null?'--':fmt(r.cdi_min)+'–'+fmt(r.cdi_max))}${stat('Area at Response',pct(r.pct_area_response))}${stat('Area at Anticipatory Action',pct(r.pct_area_aa))}${stat('Province CDI (official)',fmt(r.province_cdi),diff==null?'':'this area is '+fmt(Math.abs(diff))+(diff>=0?' higher':' lower'))}</div>
    ${r.pixel_coverage!=null&&r.pixel_coverage<0.9?`<p class="small warnline" style="margin-top:10px">Only ${pct(r.pixel_coverage)} of this area has CDI pixels (small islands or coast).</p>`:''}
    <h3>People</h3>${popBlock(r)}`;
  if(level==='district'){const kids=(S.admin?.llgs||[]).filter(l=>l.district_geocode===r.geocode).sort((a,b)=>(b.cdi_mean||0)-(a.cdi_mean||0));
    return head+`<h3>LLGs in this district</h3><table class="mini"><thead><tr><th>LLG</th><th>Mean CDI</th><th>Phase</th><th>People</th></tr></thead><tbody>${kids.map(l=>`<tr><td><a href="#" data-jump="llg|${esc(l.geocode)}">${esc(l.name)}</a></td><td>${cdiCell(l.cdi_mean)}</td><td>${pill(l.phase)}</td><td>${int(l.population_2024)}</td></tr>`).join('')}</tbody></table>`}
  return head+(r.census_2024_llgs?`<p class="small" style="margin-top:12px">2024 census LLGs counted here: ${esc(r.census_2024_llgs)}</p>`:'')
}
function provinceSpark(r){const n=24;const h=r.history.slice(-n),tl=r.timeline.slice(-n);const red=css('--resp')||'#9C1C33';
  mkChart('provSpark',{type:'line',data:{labels:tl.map(monthLabel),datasets:[{data:h,borderColor:red,backgroundColor:fadeGradient(red,.25),fill:true,pointRadius:2.5,pointBackgroundColor:h.map(colorOf),pointBorderWidth:0,borderWidth:2,tension:.3},{data:tl.map(()=>0.8),borderColor:hexA(red,.5),borderDash:[4,5],pointRadius:0,borderWidth:1,fill:false},{data:tl.map(()=>0.6),borderColor:css('--aa'),borderDash:[4,5],pointRadius:0,borderWidth:1,fill:false}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{filter:i=>i.datasetIndex===0}},scales:{y:{min:0,max:1,ticks:{stepSize:.2},grid:{color:css('--line')},border:{display:false}},x:{ticks:{maxTicksLimit:6,font:{size:10},maxRotation:0},grid:{display:false},border:{display:false}}}}})}

// ---------- tabs ----------
function moveIndicator(){const ind=document.querySelector('.tab-ind'),a=document.querySelector('.tab.active');if(!ind||!a)return;ind.style.width=a.offsetWidth+'px';ind.style.transform=`translateX(${a.offsetLeft}px)`}
function openTab(panel){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.panel===panel));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===panel));
  moveIndicator();const at=document.querySelector('.tab.active');if(at&&at.scrollIntoView)at.scrollIntoView({block:'nearest',inline:'center',behavior:reduceMotion?'auto':'smooth'});
  if(TABS[panel]){initMap(panel);setTimeout(()=>TABS[panel].map&&TABS[panel].map.invalidateSize(),120)}
  if(panel==='about'&&window.ADAPT_ABOUT_MAP)setTimeout(()=>{ADAPT_ABOUT_MAP.invalidateSize();ADAPT_ABOUT_MAP.fitBounds(PNG_BOUNDS)},80);
  setTimeout(()=>Object.values(S.charts).forEach(c=>c&&c.resize&&c.resize()),60);
  try{history.replaceState(null,'','#'+panel)}catch(e){}}
function initTabs(){document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{openTab(b.dataset.panel);const t=document.querySelector('.tabs');if(t&&window.scrollY>t.offsetTop)window.scrollTo({top:document.querySelector('main').offsetTop-70,behavior:reduceMotion?'auto':'smooth'})}));
  moveIndicator();window.addEventListener('resize',moveIndicator);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(moveIndicator)}

function setMeta(){const ex=S.example;const t=`${ex.reporting_month_label||''} report · ${ex.observation_month_label||''} observations`;
  document.querySelectorAll('.cdiPeriod').forEach(e=>e.textContent=t);
  if($('liveLabel'))$('liveLabel').textContent=(ex.reporting_month_label||'Latest')+' CDI';
  $('footerMeta').innerHTML=`CDI: ${esc(t)}${S.admin?'<br>District and LLG figures updated '+esc(S.admin.generated_utc):''}`}

function onTheme(){chartTheme();if(!S.example)return;renderRank();renderTrend();
  Object.values(TABS).forEach(T=>{if(T.layer){T.layer.setStyle(T.style);highlight(T.level)}if(T.outline)T.outline.setStyle({color:css('--ink')});if(T.level==='province'&&T.selected)provinceSpark(T.byId[T.selected])});
  restyleForeignCharts()}

function init(){chartTheme();stagger();initTabs();$('ovTrendSpan')?.addEventListener('change',renderTrend);
  const tb=$('themeBtn');if(tb)tb.addEventListener('click',()=>window.ADAPT_THEME&&ADAPT_THEME.toggle());
  if(THEME.onChange)THEME.onChange(()=>requestAnimationFrame(onTheme));
  Promise.all([getJson('data/cdi_example_latest.json'),getJson('data/cdi_archive.json'),getJson('data/cdi_admin_latest.json',true),getJson('data/integrated_priority_latest.json',true),
    getJson('adm1_nso_province.geojson',true),getJson('adm2_nso_district.geojson',true),getJson('adm3_nso_llg.geojson',true)])
  .then(([ex,ar,adm,integ,pg,dg,lg])=>{Object.assign(S,{example:ex,archive:ar,admin:adm,integrated:integ,provGeo:pg,distGeo:dg,llgGeo:lg});
    setMeta();renderHero();renderOverview();
    ['province','district','llg'].forEach(l=>{if(LEVELS[l].geo()&&LEVELS[l].rows().length)buildTab(l);else{const d=$(l+'Detail');if(d)d.innerHTML='<p>Data for this level is not available yet.</p>'}});
    const fromHash=()=>{const h=(location.hash||'').slice(1);if(h&&$(h)&&$(h).classList.contains('panel'))openTab(h)};fromHash();window.addEventListener('hashchange',fromHash);
    setTimeout(restyleForeignCharts,1500);
  }).catch(e=>{console.error(e);const s=$('ovSummary');if(s)s.innerHTML='<p>CDI data could not be loaded right now. Please try again later.</p>'})}
window.ADAPT_CDI={state:S,openTab,select,phaseOf,colorOf};
document.addEventListener('DOMContentLoaded',init);
})();
