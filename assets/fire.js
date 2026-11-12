// ADAPt Fire tab: brings PNG Fire Watch (https://rudoq007.github.io/PNGFireWatch/) into ADAPt.
// Reads Fire Watch's own published files live, so both sites always show the same numbers:
//   data/stats.json  season totals per province/district, every season since 2012 (loaded at start, ~230 KB)
//   data/fires.json  every alert this season as [lon, lat, day, flags, province] (loaded only when the Fire tab opens, ~4 MB)
// Index 0 of each [all, excluding low-confidence] pair is used, matching Fire Watch's default view.
(function(){
'use strict';
const FW='https://rudoq007.github.io/PNGFireWatch/';
const PROV_ALIAS={'Chimbu (Simbu)':'Chimbu','Northern (Oro)':'Oro','West Sepik (Sandaun)':'Sandaun','Autonomous Region of Bougainville':'Bougainville','Simbu':'Chimbu','Northern':'Oro','West Sepik':'Sandaun','Gulf Province':'Gulf','Milne Bay Province':'Milne Bay'};
const PNG_BOUNDS=[[-11.6,141.0],[-1.0,156.0]];
// "Times the 2012-2025 average" steps for areas. Ember tones, kept apart from the CDI colours.
const RBANDS=[[8,'#5B1A0A','8× or more'],[4,'#9A3412','4–8×'],[2,'#EA580C','2–4×'],[1.25,'#FB923C','1.25–2×'],[0.8,'#FDE1B8','about average'],[-1,'#E8E3D6','below average']];
const F={stats:null,fires:null,prov:{},dist:{},map:null,level:'province',layer:null,points:null,selected:null,charts:{},ready:null};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const int=v=>v==null||isNaN(v)?'--':Math.round(v).toLocaleString('en-US');
const x1=v=>v==null||isNaN(v)?'--':(+v).toFixed(1)+'×';
const pct=(a,b)=>b?Math.round(100*a/b)+'%':'--';
const norm=s=>String(s||'').toLowerCase().replace(/\b(district|province|autonomous region of|rural|urban)\b/g,'').replace(/[^a-z]/g,'');
const provName=n=>{n=String(n||'').replace(/ Province$/,'');return PROV_ALIAS[n]||n};
const css=n=>(window.ADAPT_THEME&&ADAPT_THEME.cssVar(n))||'';
const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const v0=a=>Array.isArray(a)?a[0]:a;
function ratioColor(r,now){if(r==null)return now?RBANDS[0][1]:'#E8E3D6';for(const [t,c] of RBANDS)if(r>=t)return c;return RBANDS[RBANDS.length-1][1]}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])}
function rankText(u){const r=v0(u.rank);if(!r)return'--';const yrs=Object.keys(F.stats.national.years).length;return r===1?'Highest of '+yrs+' seasons':ordinal(r)+' highest of '+yrs}
function cdiOf(kind,u){const S=window.ADAPT_CDI&&ADAPT_CDI.state;if(!S||!S.example)return null;
  if(kind==='province'){const p=S.example.provinces[u._name];return p?{v:p.cdi,id:u._name}:null}
  const d=(S.admin?.districts||[]).find(x=>x.province===u._prov&&norm(x.name)===norm(u.name));return d?{v:d.cdi_mean,id:d.geocode}:null}
function phase(v){return window.ADAPT_CDI?ADAPT_CDI.phaseOf(v):''}
function pill(p){const c=p==='Response'?'Response':p==='Anticipatory Action'?'AA':p==='Readiness'?'Readiness':'Monitoring';return `<span class="pill ${c}">${esc(p)}</span>`}

// ---------- data ----------
function loadStats(){if(F.ready)return F.ready;
  F.ready=fetch(FW+'data/stats.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('stats '+r.status);return r.json()}).then(s=>{F.stats=s;
    const pid={};s.provinces.forEach(p=>{p._name=provName(p.name);pid[p.id]=p._name;F.prov[p._name]=p});
    s.districts.forEach(d=>{d._prov=pid[d.province_id];d._name=String(d.name).replace(/ District$/,'');F.dist[d._prov+'|'+norm(d.name)]=d});
    fillSlots();renderBridge();document.dispatchEvent(new CustomEvent('adapt-fire-ready'));return s}).catch(e=>{console.warn('PNG Fire Watch data unavailable:',e);F.ready=null;throw e});
  return F.ready}
function loadFires(){if(F.fires)return Promise.resolve(F.fires);
  return fetch(FW+'data/fires.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('fires '+r.status);return r.json()}).then(f=>{F.fires=f;return f})}
function fireForProvince(name){return F.prov[name]||null}
function fireForDistrict(prov,name){return F.dist[prov+'|'+norm(name)]||null}

// ---------- small "fire this season" block used inside CDI panels ----------
function blockHtml(u,kind,link){if(!u)return'';const r=v0(u.ratio),now=v0(u.now);
  return `<div class="fire-mini"><div class="fire-mini-h"><span class="ember-dot"></span>Fires this season <span class="small">(${esc(F.stats.season.label)})</span></div>
    <div class="fire-mini-row"><div><b>${int(now)}</b><span>alerts</span></div><div><b style="color:${ratioColor(r,now)}">${x1(r)}</b><span>the 2012–2025 average</span></div><div><b>${v0(u.rank)?ordinal(v0(u.rank)):'--'}</b><span>rank since 2012 (1st = most)</span></div></div>
    ${link?`<a href="#fire" class="fire-link" data-fire-open="${esc(kind)}|${esc(kind==='province'?u._name:u.id)}">See fires on the map →</a>`:''}</div>`}
function fillSlots(root){if(!F.stats)return;(root||document).querySelectorAll('.fire-slot').forEach(el=>{const k=el.dataset.kind,u=k==='province'?fireForProvince(el.dataset.prov):fireForDistrict(el.dataset.prov,el.dataset.name);
  el.innerHTML=blockHtml(u,k,true);el.querySelectorAll('[data-fire-open]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const [kind,id]=a.dataset.fireOpen.split('|');openFireAt(kind,id)}))})}
function openFireAt(kind,id){if(window.ADAPT_CDI)ADAPT_CDI.openTab('fire');setLevel(kind==='province'?'province':'district');setTimeout(()=>selectArea(id,true),350)}

// ---------- Overview bridge card ----------
function renderBridge(){const el=$('fireBridge');if(!el||!F.stats)return;const n=F.stats.national,S=window.ADAPT_CDI&&ADAPT_CDI.state;
  const ys=n.years,y15=v0(ys['2015']);const top=[...F.stats.provinces].sort((a,b)=>v0(b.now)-v0(a.now)).slice(0,3).map(p=>esc(p._name)).join(', ');
  el.innerHTML=`<div class="bridge"><div class="bridge-l"><span class="eyebrow">Drought → fire</span><h2>Dry ground is burning</h2>
    <p class="lede">Since ${esc(F.stats.season.label.split('–')[0])}, satellites have picked up <b>${int(v0(n.now))}</b> fire alerts across PNG: <b>${x1(v0(n.ratio))}</b> the 2012–2025 average for the same weeks, and more than the 2015 El Niño season (${int(y15)}).</p>
    <p class="small">Most alerts so far: ${top}. Fires follow drought: when the CDI is high, soils and vegetation are dry enough for fires to start and spread.</p>
    <a class="btn primary" href="#fire" data-goto="fire">Open the Fire tab</a></div>
    <div class="bridge-r"><div class="bridge-step"><span class="muted">Drought</span><b>${S&&S.example?(()=>{const c=Object.values(S.example.provinces).map(p=>p.cdi);return (c.reduce((a,b)=>a+b,0)/c.length).toFixed(2)})():'--'}</b><span>national CDI</span></div>
    <svg class="bridge-arrow" viewBox="0 0 60 24" aria-hidden="true"><path d="M0 12h52M44 4l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <div class="bridge-step fire"><span class="muted">Fire</span><b>${x1(v0(n.ratio))}</b><span>usual fire activity</span></div></div></div>`;
  el.querySelectorAll('[data-goto]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();ADAPT_CDI.openTab('fire')}))}

// ---------- Fire tab ----------
let built=false;
function buildTab(){if(built||!F.stats)return;built=true;const n=F.stats.national,s=F.stats.season;
  const y15=v0(n.years['2015']),now=v0(n.now),fl=n.flags||{};const base=v0(fl._base)||now;
  $('fireLede').innerHTML=`Since ${esc(s.label.split('–')[0])}, satellites have detected <b>${int(now)}</b> fire alerts across Papua New Guinea. That is <b>${x1(v0(n.ratio))}</b> the 2012–2025 average for the same weeks and the <b>${v0(n.rank)===1?'highest':ordinal(v0(n.rank))+' highest'}</b> since records began in 2012, ${now>y15?'well above':'compared with'} the 2015 El Niño season (${int(y15)}).`;
  $('fireUpdated').textContent='PNG Fire Watch · updated '+s.updated+' · '+s.sources.map(x=>x.satellite).join(' then ');
  const k=(id,v,opts)=>{const el=$(id);if(!el)return;if(window.ADAPT_CDI&&ADAPT_CDI.countUp)ADAPT_CDI.countUp(el,v,opts);else el.textContent=v};
  k('fkNow',now);k('fkRatio',v0(n.ratio),{format:v=>v.toFixed(1)+'×'});$('fkRank').textContent=v0(n.rank)===1?'1st':ordinal(v0(n.rank));
  k('fkForest',100*v0(fl.tcd30)/base,{format:v=>Math.round(v)+'%'});
  $('fkForestSub').textContent=pct(v0(fl.primary),base)+' in primary forest · '+pct(v0(fl.kba),base)+' in Key Biodiversity Areas';
  renderYears();renderScatter();renderTable();
  $('fireLevel').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>setLevel(b.dataset.level)));
  $('fireSearch').addEventListener('input',renderTable);$('fireSort').addEventListener('change',renderTable);
  $('fireSelect').addEventListener('change',e=>{if(e.target.value)selectArea(e.target.value,true)});
  showNational();
}
function units(){return F.level==='province'?F.stats.provinces:F.stats.districts}
function unitId(u){return F.level==='province'?u._name:u.id}
function unitById(id){return units().find(u=>unitId(u)===id)}
function setLevel(l){if(!F.stats)return;F.level=l;F.selected=null;const seg=$('fireLevel');if(seg)seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.level===l));
  if(F.map)drawAreas();renderTable();showNational()}
function initMap(){if(F.map||!$('fireMap'))return;const m=L.map('fireMap',{scrollWheelZoom:false,zoomControl:false}).setView([-6.3,148],6);F.map=m;
  L.control.zoom({position:'topleft'}).addTo(m);
  const bm=window.ADAPT_THEME&&ADAPT_THEME.themedBasemap?ADAPT_THEME.themedBasemap(m):{base:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m)};
  m.createPane('units');m.getPane('units').style.zIndex=380;m.createPane('fires');m.getPane('fires').style.zIndex=430;m.getPane('fires').style.pointerEvents='none';
  F.base=bm;drawAreas();
  const lg=L.control({position:'bottomleft'});lg.onAdd=()=>{const d=L.DomUtil.create('div','map-legend');d.innerHTML=`<span class="lg-title">Fire activity vs average</span><div class="lg-bar">${[...RBANDS].reverse().map(b=>`<i style="background:${b[1]}"></i>`).join('')}</div><div class="lg-ticks"><span>below</span><span>1×</span><span>2×</span><span>4×</span><span>8×+</span></div><div class="lg-phases"><span><i style="background:#FFD166;box-shadow:0 0 6px #FFB703"></i>Last 7 days</span><span><i style="background:#F97316"></i>Earlier this season</span></div>`;return d};lg.addTo(m);
  m.fitBounds(PNG_BOUNDS);
  m.on('zoomstart movestart',()=>F.layer&&F.layer.eachLayer(l=>l.closeTooltip()));
  loadFires().then(()=>{addPoints();const st=$('fireMapStatus');if(st)st.textContent=''}).catch(e=>{const st=$('fireMapStatus');if(st)st.textContent='Fire points could not be loaded right now; area totals are still shown.'})}
function areaGeo(){const S=ADAPT_CDI.state;return F.level==='province'?S.provGeo:S.distGeo}
function featUnit(f){if(F.level==='province')return F.prov[provName(f.properties.PROVNAME)];const S=ADAPT_CDI.state;const d=(S.admin?.districts||[]).find(x=>x.geocode===f.properties.geocode);return d?fireForDistrict(d.province,d.name):null}
function areaStyle(f){const u=featUnit(f);return{color:css('--map-stroke')||'#fff',weight:F.level==='province'?1.2:.8,fillColor:u?ratioColor(v0(u.ratio),v0(u.now)):'#E8E3D6',fillOpacity:.55}}
function drawAreas(){if(!F.map)return;if(F.layer)F.map.removeLayer(F.layer);if(F.ctl)F.map.removeControl(F.ctl);
  F.layer=L.geoJSON(areaGeo(),{pane:'units',style:areaStyle,onEachFeature:(f,l)=>{const u=featUnit(f);
    l.bindTooltip(u?`<b>${esc(F.level==='province'?u._name:u._name)}</b>${F.level==='district'?'<br><span style="opacity:.7">'+esc(u._prov)+'</span>':''}<span class="tv">${int(v0(u.now))}</span><span style="opacity:.8">alerts · ${x1(v0(u.ratio))} average</span>`:'No data',{sticky:true,className:'adapt-tip',direction:'top',offset:[0,-12],opacity:1});
    l.on({click:()=>{if(u)selectArea(unitId(u),true)},mouseover:e=>{e.target.setStyle({weight:2.4,color:css('--ink'),fillOpacity:.75});e.target.bringToFront()},mouseout:e=>{F.layer.resetStyle(e.target);hl()}})}}).addTo(F.map);
  const ov={};if(F.points)ov['Fire alerts']=F.points;ov[(F.level==='province'?'Provinces':'Districts')+' (vs average)']=F.layer;if(F.base.labels)ov['Place names']=F.base.labels;
  F.ctl=L.control.layers({'Map':F.base.base,'Satellite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'Imagery &copy; Esri'})},ov,{collapsed:true,position:'topright'}).addTo(F.map);hl()}
function hl(){if(!F.layer||!F.selected)return;F.layer.eachLayer(l=>{const u=featUnit(l.feature);if(u&&unitId(u)===F.selected){l.setStyle({weight:3,color:css('--ink'),fillOpacity:.75});l.bringToFront()}})}
// Fire points on a canvas grid layer: ~140k points stay smooth because each tile only draws its own.
function addPoints(){const f=F.fires;if(!f||F.points)return;const rows=f.rows,maxDay=rows.reduce((m,r)=>r[2]>m?r[2]:m,0);
  const B={};rows.forEach(r=>{const k=Math.floor(r[0])+'|'+Math.floor(r[1]);(B[k]||(B[k]=[])).push(r)});
  const Grid=L.GridLayer.extend({createTile(c){const t=L.DomUtil.create('canvas','fire-tile');const sz=this.getTileSize();t.width=sz.x;t.height=sz.y;const ctx=t.getContext('2d');
    const nw=this._map.unproject([c.x*sz.x,c.y*sz.y],c.z),se=this._map.unproject([(c.x+1)*sz.x,(c.y+1)*sz.y],c.z);const pad=.05;
    const z=c.z,rad=z<=6?1.1:z<=8?1.8:z<=10?2.6:3.4;const old=[],recent=[];
    for(let gx=Math.floor(nw.lng-pad);gx<=Math.floor(se.lng+pad);gx++)for(let gy=Math.floor(se.lat-pad);gy<=Math.floor(nw.lat+pad);gy++){const b=B[gx+'|'+gy];if(!b)continue;
      for(const r of b){if(r[0]<nw.lng-pad||r[0]>se.lng+pad||r[1]>nw.lat+pad||r[1]<se.lat-pad)continue;const p=this._map.project([r[1],r[0]],z);const x=p.x-c.x*sz.x,y=p.y-c.y*sz.y;(maxDay-r[2]<7?recent:old).push(x,y)}}
    ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(234,88,12,.55)';for(let i=0;i<old.length;i+=2){ctx.beginPath();ctx.arc(old[i],old[i+1],rad,0,6.283);ctx.fill()}
    ctx.shadowColor='rgba(255,183,3,.9)';ctx.shadowBlur=z<=7?4:7;ctx.fillStyle='rgba(255,214,102,.95)';for(let i=0;i<recent.length;i+=2){ctx.beginPath();ctx.arc(recent[i],recent[i+1],rad+.4,0,6.283);ctx.fill()}
    return t}});
  F.points=new Grid({pane:'fires',updateWhenZooming:false,keepBuffer:2,attribution:'Fire alerts: NASA FIRMS VIIRS via PNG Fire Watch'}).addTo(F.map);drawAreas()}
function selectArea(id,zoom){const u=unitById(id);if(!u)return;F.selected=id;if(F.layer){F.layer.eachLayer(l=>F.layer.resetStyle(l));hl();
    if(zoom)F.layer.eachLayer(l=>{const lu=featUnit(l.feature);if(lu&&unitId(lu)===id){const o={padding:[50,50],maxZoom:F.level==='province'?7:8};reduce?F.map.fitBounds(l.getBounds(),o):F.map.flyToBounds(l.getBounds(),{...o,duration:.9})}})}
  $('fireSelect').value=id;$('fireBody').querySelectorAll('tr').forEach(tr=>tr.classList.toggle('sel',tr.dataset.id===id));
  renderDetail(u)}
function showNational(){const n=F.stats.national;n._name='Papua New Guinea';renderDetail(n,true);const sel=$('fireSelect');if(sel)sel.value=''}
function renderDetail(u,national){const d=$('fireDetail');const r=v0(u.ratio),now=v0(u.now),fl=u.flags||{},base=v0(fl._base)||now,y15=v0(u.y2015);
  const c=national?null:cdiOf(F.level,u);const kind=F.level;
  d.innerHTML=`<div class="anim"><span class="eyebrow">${national?'National':kind==='province'?'Province':'District'}</span><h2>${esc(national?'Papua New Guinea':u._name)}</h2>${!national&&kind==='district'?`<p class="small">${esc(u._prov)}</p>`:''}
    <div class="bigval" style="--c:${ratioColor(r,now)}"><span>${int(now)}</span><small>alerts</small></div>
    <span class="pill" style="background:${ratioColor(r,now)};color:${r>=1.25?'#fff':'#3B1D02'}">${r==null?'New activity':x1(r)+' the average'}</span> <span class="small">${rankText(u)}</span>
    <div class="dgrid">${st('2012–2025 average',int(v0(u.mean)))}${st('2015 El Niño season',int(y15))}${st('In tree cover',pct(v0(fl.tcd30),base))}${st('In primary forest',pct(v0(fl.primary),base))}</div>
    <h3>This season, month by month</h3><div style="height:150px"><canvas id="fireMonthly"></canvas></div>
    ${c?`<h3>Drought in the same ${kind}</h3><div class="fire-cdi"><div><b style="color:${ADAPT_CDI.colorOf(c.v)}">${c.v==null?'--':(+c.v).toFixed(2)}</b><span>CDI</span></div>${pill(phase(c.v))}<a href="#${kind}" class="fire-link" data-cdi-open="${esc(kind)}|${esc(c.id)}">Open in the ${kind==='province'?'Province':'District'} tab →</a></div>`:''}
    ${national?`<p class="small" style="margin-top:14px">Click a ${kind} on the map or in the table to see its fires next to its drought score.</p>`:''}</div>`;
  const ob=d.querySelector('[data-cdi-open]');if(ob)ob.addEventListener('click',e=>{e.preventDefault();const [lv,id]=ob.dataset.cdiOpen.split('|');ADAPT_CDI.openTab(lv);setTimeout(()=>ADAPT_CDI.select(lv,id,true),300)});
  const mo=F.stats.season.months,MN=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  chart('fireMonthly',{type:'bar',data:{labels:mo.map(m=>MN[+m.slice(5)]),datasets:[{data:mo.map(m=>v0((u.monthly||{})[m])||0),backgroundColor:mo.map((m,i)=>i===mo.length-1?'#FFB703':'#EA580C'),borderRadius:6,borderSkipped:false}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>int(c.raw)+' alerts'+(c.dataIndex===mo.length-1?' (so far)':'')}}},scales:{y:{grid:{color:css('--line')},border:{display:false},ticks:{maxTicksLimit:4}},x:{grid:{display:false},border:{display:false}}}}})}
function st(l,v){return `<div class="dstat"><span class="muted">${l}</span><b>${v}</b></div>`}
function chart(id,cfg){if(F.charts[id])F.charts[id].destroy();const el=$(id);if(!el||!window.Chart)return;F.charts[id]=new Chart(el,cfg)}
function renderYears(){const ys=F.stats.national.years,ks=Object.keys(ys);
  chart('fireYears',{type:'bar',data:{labels:ks,datasets:[{data:ks.map(k=>v0(ys[k])),backgroundColor:ks.map(k=>k===F.stats.season.current?'#EA580C':k==='2015'?'#B45309':css('--line-2')||'#D6D1C5'),borderRadius:6,borderSkipped:false}]},
    options:{maintainAspectRatio:false,animation:{delay:c=>reduce?0:c.dataIndex*40},plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>c[0].label+(c[0].label===F.stats.season.current?' (this season)':c[0].label==='2015'?' (El Niño)':''),label:c=>int(c.raw)+' alerts, '+F.stats.season.label.replace(/ \d{4}$/,'')}}},
      scales:{y:{grid:{color:css('--line')},border:{display:false},ticks:{callback:v=>v>=1000?(v/1000)+'k':v}},x:{grid:{display:false},border:{display:false}}}}})}
function renderScatter(){const S=ADAPT_CDI.state;if(!S||!S.example)return;
  const pts=F.stats.provinces.map(p=>{const c=S.example.provinces[p._name];return c?{x:c.cdi,y:Math.max(.3,v0(p.ratio)||.3),name:p._name,n:v0(p.now)}:null}).filter(Boolean);
  chart('fireScatter',{type:'bubble',data:{datasets:[{data:pts.map(p=>({x:p.x,y:p.y,r:Math.min(26,Math.max(4,Math.sqrt(p.n)/7)),name:p.name,n:p.n})),backgroundColor:pts.map(p=>ADAPT_CDI.colorOf(p.x)+'CC'),borderColor:css('--surface'),borderWidth:1.5}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>c[0].raw.name,label:c=>['CDI '+(+c.raw.x).toFixed(2)+' · '+phase(c.raw.x),int(c.raw.n)+' fire alerts · '+x1(c.raw.y)+' average']}}},
      scales:{x:{min:.5,max:1,title:{display:true,text:'Drought (CDI)'},grid:{color:css('--line')},border:{display:false}},y:{type:'logarithmic',min:.25,max:Math.max(16,...pts.map(p=>p.y))*1.4,title:{display:true,text:'Fires vs 2012–2025 average'},grid:{color:css('--line')},border:{display:false},afterBuildTicks:ax=>{ax.ticks=[.5,1,2,4,8,16,32,64].filter(v=>v>=ax.min&&v<=ax.max).map(v=>({value:v}))},ticks:{callback:v=>v+'×'}}},
      onClick:(e,els)=>{if(els[0]){const p=pts[els[0].index];setLevel('province');selectArea(p.name,true);$('fireMap').scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'})}}}})}
function renderTable(){if(!F.stats)return;const q=($('fireSearch').value||'').toLowerCase(),sort=$('fireSort').value;let rows=units().filter(u=>!q||(u._name+' '+(u._prov||'')).toLowerCase().includes(q));
  const c=(a,b,f)=>(f(b)??-1)-(f(a)??-1);rows=[...rows].sort(sort==='now'?(a,b)=>c(a,b,u=>v0(u.now)):sort==='name'?(a,b)=>a._name.localeCompare(b._name):(a,b)=>c(a,b,u=>v0(u.ratio)));
  const isP=F.level==='province';$('fireHead').innerHTML=`<tr><th>${isP?'Province':'District'}</th>${isP?'':'<th>Province</th>'}<th>Alerts this season</th><th>vs average</th><th>Rank since 2012</th><th>2015 season</th><th>Drought (CDI)</th></tr>`;
  $('fireBody').innerHTML=rows.map(u=>{const cd=cdiOf(F.level,u);return `<tr data-id="${esc(unitId(u))}" class="${F.selected===unitId(u)?'sel':''}"><td><b>${esc(u._name)}</b></td>${isP?'':`<td>${esc(u._prov)}</td>`}<td>${int(v0(u.now))}</td><td><span style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><i style="width:10px;height:10px;border-radius:3px;background:${ratioColor(v0(u.ratio),v0(u.now))};display:inline-block"></i>${x1(v0(u.ratio))}</span></td><td>${v0(u.rank)?ordinal(v0(u.rank)):'--'}</td><td>${int(v0(u.y2015))}</td><td>${cd&&cd.v!=null?pill(phase(cd.v))+' '+(+cd.v).toFixed(2):'--'}</td></tr>`}).join('');
  $('fireBody').querySelectorAll('tr[data-id]').forEach(tr=>tr.addEventListener('click',()=>{selectArea(tr.dataset.id,true);$('fireMap').scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'})}));
  $('fireSelect').innerHTML=`<option value="">Papua New Guinea (national)</option>`+[...units()].sort((a,b)=>a._name.localeCompare(b._name)).map(u=>`<option value="${esc(unitId(u))}">${esc(u._name)}${isP?'':' ('+esc(u._prov)+')'}</option>`).join('');
  if(F.selected)$('fireSelect').value=F.selected}

function onOpen(){loadStats().then(()=>{buildTab();initMap();setTimeout(()=>F.map&&F.map.invalidateSize(),120)}).catch(()=>{const l=$('fireLede');if(l)l.textContent='PNG Fire Watch data could not be loaded right now. Please try again later, or open PNG Fire Watch directly.'})}
function onTheme(){if(!F.stats)return;if(F.layer){F.layer.setStyle(areaStyle);hl()}if(built){renderYears();renderScatter();if(F.selected){const u=unitById(F.selected);if(u)renderDetail(u)}else showNational()}}

window.ADAPT_FIRE={load:loadStats,fill:fillSlots,onOpen,onTheme,state:F};
document.addEventListener('adapt-data-ready',()=>loadStats().catch(()=>{}));
})();
