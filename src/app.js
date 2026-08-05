/* CETP-Baddi dashboard app — SVG charts + UI. Depends only on CETP core (window.CETP). */
(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
var el=function(t,a,txt){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(txt!=null)e.textContent=txt;return e;};

/* PERSIST_DATA — when false the dashboard keeps NO workbook data in the browser:
   files are fed each session. Set to true to store parsed workbooks in IndexedDB.
   (UI settings — theme, window, targets — are always kept in localStorage.) */
var PERSIST_DATA=false;

function save(k,v){try{localStorage.setItem('cetp_'+k,JSON.stringify(v));}catch(e){}}
function load(k,d){try{var v=localStorage.getItem('cetp_'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}}


// ---- IndexedDB: persist parsed workbooks between sessions ----
var IDB={db:null,name:'cetp_dash',store:'books'};
function idbOpen(){
  return new Promise(function(res,rej){
    if(IDB.db) return res(IDB.db);
    if(typeof indexedDB==='undefined') return rej('no indexedDB');
    var rq=indexedDB.open(IDB.name,1);
    rq.onupgradeneeded=function(e){var db=e.target.result; if(!db.objectStoreNames.contains(IDB.store)) db.createObjectStore(IDB.store,{keyPath:'cat'});};
    rq.onsuccess=function(e){IDB.db=e.target.result;res(IDB.db);};
    rq.onerror=function(){rej('open failed');};
  });
}
function packBook(bk){                       // compact: keys once + value arrays
  var keys=bk.keys, idx={}; keys.forEach(function(k,i){idx[k]=i;});
  var rows=bk.records.map(function(r){
    var a=new Array(keys.length+1); a[0]=r.date;
    for(var k in r.v){var i=idx[k]; if(i!=null) a[i+1]=r.v[k];}
    return a;
  });
  return {keys:keys, rows:rows, file:bk.file, savedAt:new Date().toISOString()};
}
function unpackBook(p){
  return {keys:p.keys, file:p.file, savedAt:p.savedAt, records:p.rows.map(function(row){
    var v={}; for(var i=0;i<p.keys.length;i++){var x=row[i+1]; if(x!=null) v[p.keys[i]]=x;}
    return {date:row[0], v:v};
  })};
}
function idbSave(cat,bk){
  return idbOpen().then(function(db){
    return new Promise(function(res,rej){
      var tx=db.transaction(IDB.store,'readwrite');
      var rec=packBook(bk); rec.cat=cat;
      tx.objectStore(IDB.store).put(rec);
      tx.oncomplete=function(){res(true);}; tx.onerror=function(){rej('save failed');};
    });
  }).catch(function(){return false;});
}
function idbLoadAll(){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      var out={}, tx=db.transaction(IDB.store,'readonly'), rq=tx.objectStore(IDB.store).getAll();
      rq.onsuccess=function(){(rq.result||[]).forEach(function(rec){ if(rec&&rec.keys&&rec.rows) out[rec.cat]=unpackBook(rec); }); res(out);};
      rq.onerror=function(){res({});};
    });
  }).catch(function(){return {};});
}
function idbClear(){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      var tx=db.transaction(IDB.store,'readwrite'); tx.objectStore(IDB.store).clear();
      tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);};
    });
  }).catch(function(){return false;});
}

// ---- plant geometry (from "Category Wise Details Of Tanks Capacity.xlsx"; Cat-2 pending) ----
var PLANT={
 'Cat-1':{aerVol:15960, aerDetail:'Aeration Tank-01 · 70×57×4 m',
   eqVol:14437.5, primVol:2505.5, primArea:706.86, primName:'Pre-settler (D30)',
   scVol:6048.0, scArea:1590.43, scName:'Secondary clarifier-1 (D45)',
   tertVol:3300.6, tertArea:981.75, tertName:'Tertiary clariflocculator A+B (2×D25)'},
 'Cat-2':null,
 'Cat-3':{aerVol:6000, aerDetail:'ASP 4,000 (40×25×4) + MBBR 2,000 (25×20×4) m³',
   eqVol:2625, primVol:421.6, primArea:113.10, primName:'Pre-settler (D12)',
   scVol:581.0, scArea:176.71, scName:'Secondary clarifier-3 (D15)',
   tertVol:365.1, tertArea:113.10, tertName:'Tertiary clariflocculator-C (D12)'}
};
// ---- config ----
var CFG=Object.assign({
  limits:{COD:250,BOD:30,TSS:100}, DO:{anoxic:0.5,low:1.2}, SVI:{fair:150,bad:250},
  VS:{desirable:0.70, minimum:0.65},
  fmBasis:'COD', fmBand:{'Cat-1':[0.10,0.16],'Cat-2':[0.07,0.15],'Cat-3':[0.20,0.35]},
  aerVol:{'Cat-1':PLANT['Cat-1'].aerVol,'Cat-2':null,'Cat-3':PLANT['Cat-3'].aerVol},
  HRT:{primaryMin:2.5}, SOR:{primaryMax:40, secondaryMax:33, tertiaryMax:40}
}, load('cfg',{}));
['Cat-1','Cat-3'].forEach(function(c){ if(CFG.aerVol[c]==null) CFG.aerVol[c]=PLANT[c].aerVol; });
if(!CFG.VS) CFG.VS={desirable:0.70,minimum:0.65};
if(CFG.SOR.tertiaryMax==null) CFG.SOR.tertiaryMax=40;

var CAT_INFO={'Cat-1':{name:'Food · Textile · Paper',chambers:['Chamber 1','Chamber 9','Chamber-16']},
  'Cat-2':{name:'Detergent',chambers:['Aeration']},
  'Cat-3':{name:'Pharma Formulations',chambers:['Chamber 1','Chamber 5','Chamber 8']}};
var STATE={books:{}, cat:null, win:load('win',30), theme:load('theme',null), flow:load('flow',true)};

// ---- category-specific raw column names ----
var COLS={
 'Cat-1':{turbIn:'Cat I Equalization Tank | Turbidity (NTU)', turbPrim:'Pre-Settler I o/f | Turbidity (NTU)',
   turbSec:'Secondary Clarifier o/f | Turbidity (NTU)',
   waste:'Secondary Clarifier u/f | Sludge Wastage (m3/d)', ufFlow:'Secondary Clarifier u/f | Flow (m3/d)',
   ufMLSS:'Secondary Clarifier u/f | MLSS (mg/L)',
   recycle:['Secondary Clarifier u/f | Recycle to Chamber 1 (m3/d)','Secondary Clarifier u/f | Recycle to Chamber 9 (m3/d)'],
   colourIn:null, colourPrim:null, primBOD:'Pre-Settler I o/f | BOD (mg/L)'},
 'Cat-2':{turbIn:'Cat II Equalization Tank | Turbidity (NTU)', turbPrim:'Tube Settler o/f | Turbidity (NTU)',
   turbSec:'Secondary Clarifier o/f | Turbidity (NTU)',
   waste:'Secondary Clarifier u/f | Sludge Wastage (m3/d)', ufFlow:'Secondary Clarifier u/f | Flow (m3/d)',
   ufMLSS:'Secondary Clarifier u/f | MLSS (mg/L)',
   recycle:['Secondary Clarifier u/f | Recycle to Inlet of Aeration Tank (m3/d)'],
   colourIn:'Cat II Equalization Tank | Color', colourPrim:'Tube Settler o/f | Color', primBOD:'Tube Settler o/f | BOD (mg/L)'},
 'Cat-3':{turbIn:'Cat III Equalization Tank | Turbidity (NTU)', turbPrim:'Pre-Settler I o/f | Turbidity (NTU)',
   turbSec:'Secondary Clarifier o/f | Turbidity (NTU)',
   waste:'Secondary Clarifier u/f | Sludge Wastage (m3/d)', ufFlow:'Secondary Clarifier u/f | Flow (m3/d)',
   ufMLSS:'Secondary Clarifier u/f | MLSS (mg/L)',
   recycle:['Secondary Clarifier u/f | Recycle to Chamber 1 (m3/d)','Secondary Clarifier u/f | Recycle to Chamber 5 (m3/d)'],
   colourIn:'Pre-Settler Inlet | Color', colourPrim:'Pre-Settler I o/f | Color', primBOD:'Pre-Settler I o/f | BOD (mg/L)'}
};

// ---- theme-aware palette ----
function getPal(){
  var d={grid:'#17361f',muted:'#8fb39c',ink:'#eaf6ee',line:'#1f4a2e',red:'#ff6b6b',amber:'#f6b64b',green:'#3ad07a',
    series:['#4aa3ff','#f6b64b','#3ad07a','#ff85c8','#b58bff','#38d7d7','#ff6b6b']};
  try{ if(typeof getComputedStyle==='function'){ var cs=getComputedStyle(document.documentElement);
    var g=function(n,f){var v=cs.getPropertyValue(n);v=v&&v.trim();return v||f;};
    d.grid=g('--grid',d.grid);d.muted=g('--muted',d.muted);d.ink=g('--ink',d.ink);d.line=g('--line',d.line);
    d.red=g('--red',d.red);d.amber=g('--amber',d.amber);d.green=g('--green',d.green);
    d.series=d.series.map(function(x,i){return g('--c'+(i+1),x);});
  }}catch(e){}
  return d;
}
var COLORS=getPal().series;

function dnum(iso){return Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10));}
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(ms){var d=new Date(ms);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
function fmtDateY(ms){var d=new Date(ms);return MON[d.getUTCMonth()]+" '"+String(d.getUTCFullYear()).slice(2);}
function round(x,n){if(x==null||isNaN(x))return null;var p=Math.pow(10,n||0);return Math.round(x*p)/p;}
function fmtN(x){if(x==null||isNaN(x))return '—';return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');}

function avg(a){a=a.filter(function(x){return x!=null&&!isNaN(x);});return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:null;}
function sum(a){a=a.filter(function(x){return x!=null&&!isNaN(x);});return a.length?a.reduce(function(s,x){return s+x;},0):null;}
function computeRows(cat){
  var bk=STATE.books[cat]; if(!bk) return [];
  var M=CETP.MAP[cat], C=COLS[cat];
  return bk.records.map(function(r){
    var v=r.v, u=v[M.inCODu], f=v[M.inCODf], b=v[M.inBOD];
    var mlss=avg(M.MLSS.map(function(k){return v[k];})), mlvss=avg(M.MLVSS.map(function(k){return v[k];}));
    var prim=v[M.primCOD], sc=v[M.scCOD], fin=v[M.finCOD];
    var rem=function(a,x){return (a!=null&&x!=null&&a>0)?100*(a-x)/a:null;};
    return {date:r.date, x:dnum(r.date), raw:v,
      flow:v[M.flow], inCODu:u, inCODf:f, inBOD:b,
      partCOD:(u!=null&&f!=null)?u-f:null, bodcod:(u&&b!=null)?b/u:null,
      primCOD:prim, scCOD:sc, finCOD:fin, finBOD:v[M.finBOD], finTSS:v[M.finTSS], finNH4:v[M.finNH4],
      primRem:rem(u,prim), secRem:rem(prim,sc), overRem:rem(u,fin),
      doArr:M.DO.map(function(k){return v[k];}), mlss:mlss, mlvss:mlvss,
      vsRatio:(mlss&&mlvss!=null)?mlvss/mlss:null, svi:avg(M.SVI.map(function(k){return v[k];})),
      waste:v[C.waste], recycle:sum(C.recycle.map(function(k){return v[k];})),
      turbIn:v[C.turbIn], turbPrim:v[C.turbPrim], turbSec:v[C.turbSec]};
  });
}
function windowed(rows){
  if(!rows.length) return rows;
  if(STATE.win==='all') return rows;
  var last=rows[rows.length-1].x, from=last-STATE.win*86400000;
  return rows.filter(function(r){return r.x>=from;});
}
function latest(rows,key){for(var i=rows.length-1;i>=0;i--){if(rows[i][key]!=null&&!isNaN(rows[i][key]))return rows[i];}return null;}

// ---------- SVG chart (supports a right-hand axis for the flow overlay) ----------
function niceNum(range,round_){var exp=Math.floor(Math.log10(range||1)),frac=range/Math.pow(10,exp),nf;
  if(round_){nf=frac<1.5?1:frac<3?2:frac<7?5:10;}else{nf=frac<=1?1:frac<=2?2:frac<=5?5:10;}
  return nf*Math.pow(10,exp);}
function chart(mount, series, opts){
  opts=opts||{}; mount.innerHTML=''; var PAL=getPal();
  var right=opts.right&&opts.right.data&&opts.right.data.some(function(p){return p.y!=null;})?opts.right:null;
  var W=Math.max(320, mount.clientWidth||mount.parentNode.clientWidth||480), H=opts.height||210;
  var mL=46,mR=right?44:12,mT=10,mB=26, iw=W-mL-mR, ih=H-mT-mB;
  var pts=[]; series.forEach(function(s){s.data.forEach(function(p){if(p.y!=null&&!isNaN(p.y))pts.push(p);});});
  var thr=opts.thresholds||[], bands=opts.bands||[];
  if(!pts.length){mount.innerHTML='<div class="empty">No data for this parameter in the selected window.</div>';return;}
  var xs=pts.map(function(p){return p.x;}), ys=pts.map(function(p){return p.y;});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  if(right) right.data.forEach(function(p){if(p.y!=null){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}});
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  thr.forEach(function(t){if(t.y!=null){minY=Math.min(minY,t.y);maxY=Math.max(maxY,t.y);}});
  if(opts.y0!=null)minY=Math.min(minY,opts.y0);
  if(opts.forceMin!=null)minY=opts.forceMin;
  if(opts.forceMax!=null)maxY=Math.max(maxY,opts.forceMax);
  if(minY===maxY){maxY=minY+1;minY=minY-1;}
  var span=niceNum(maxY-minY,false),step=niceNum(span/5,true);
  var lo=Math.floor(minY/step)*step, hi=Math.ceil(maxY/step)*step;
  if(opts.y0!=null&&lo>opts.y0)lo=opts.y0;
  var nDiv=Math.max(1,Math.round((hi-lo)/step));
  var xr=(maxX-minX)||1;
  var X=function(x){return mL+(x-minX)/xr*iw;}, Y=function(y){return mT+(hi-y)/(hi-lo)*ih;};
  // right axis shares the gridline positions
  var r_hi=0,R=null;
  if(right){
    var rv=right.data.map(function(p){return p.y;}).filter(function(y){return y!=null&&!isNaN(y);});
    r_hi=niceNum(Math.max.apply(null,rv)||1,false);
    var rstep=niceNum(r_hi/nDiv,true); r_hi=rstep*nDiv;
    R=function(y){return mT+(r_hi-y)/(r_hi||1)*ih;};
  }
  var svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img">';
  bands.forEach(function(b){var y1=Y(Math.min(b.y1,hi)),y0=Y(Math.max(b.y0,lo));
    svg+='<rect x="'+mL+'" y="'+y1+'" width="'+iw+'" height="'+Math.max(0,y0-y1)+'" fill="'+b.color+'" opacity="0.11"/>';});
  for(var i2=0;i2<=nDiv;i2++){var gv=lo+i2*step, yy=Y(gv);
    svg+='<line x1="'+mL+'" y1="'+yy+'" x2="'+(mL+iw)+'" y2="'+yy+'" stroke="'+PAL.grid+'" stroke-width="1"/>';
    svg+='<text x="'+(mL-6)+'" y="'+(yy+3.5)+'" fill="'+PAL.muted+'" font-size="10" text-anchor="end">'+fmtTick(gv)+'</text>';
    if(right) svg+='<text x="'+(mL+iw+6)+'" y="'+(yy+3.5)+'" fill="'+right.color+'" font-size="9" text-anchor="start" opacity=".85">'+fmtTick(r_hi/nDiv*i2)+'</text>';
  }
  var nT=Math.min(6,pts.length), spanDays=xr/86400000;
  for(var i=0;i<nT;i++){var xv=minX+xr*i/(nT-1||1),xx=X(xv);
    svg+='<line x1="'+xx+'" y1="'+mT+'" x2="'+xx+'" y2="'+(mT+ih)+'" stroke="'+PAL.grid+'" stroke-width="1" opacity="0.5"/>';
    svg+='<text x="'+xx+'" y="'+(H-8)+'" fill="'+PAL.muted+'" font-size="10" text-anchor="middle">'+(spanDays>200?fmtDateY(xv):fmtDate(xv))+'</text>';}
  thr.forEach(function(t){var yy=Y(t.y);
    svg+='<line x1="'+mL+'" y1="'+yy+'" x2="'+(mL+iw)+'" y2="'+yy+'" stroke="'+t.color+'" stroke-width="'+(t.w||1.2)+'" stroke-dasharray="'+(t.dash||'5 4')+'" opacity="0.9"/>';
    svg+='<text x="'+(mL+iw-3)+'" y="'+(yy-3)+'" fill="'+t.color+'" font-size="9.5" text-anchor="end">'+t.label+'</text>';});
  function drawSeries(s,mapY,cls){
    var segs=[],cur=[];
    s.data.forEach(function(p){if(p.y==null||isNaN(p.y)){if(cur.length){segs.push(cur);cur=[];}}else cur.push(p);});
    if(cur.length)segs.push(cur);
    segs.forEach(function(seg){var d=seg.map(function(p,j){return (j?'L':'M')+X(p.x).toFixed(1)+' '+mapY(p.y).toFixed(1);}).join(' ');
      svg+='<path class="series" pathLength="1" d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="'+(s.width||1.9)+'" '+(s.dash?'stroke-dasharray="'+(s.dash===true?'4 3':s.dash)+'"':'')+' stroke-linejoin="round" stroke-linecap="round" '+(s.op?'opacity="'+s.op+'"':'')+'/>';});
  }
  if(right){ right.width=right.width||1.4; right.dash='3 3'; right.op=0.75; drawSeries(right,R); }
  series.forEach(function(s){ drawSeries(s,Y);
    if(pts.length<=45)s.data.forEach(function(p){if(p.y!=null&&!isNaN(p.y))svg+='<circle class="pt" cx="'+X(p.x).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="2.1" fill="'+s.color+'"/>';});
    var last=null; for(var q=s.data.length-1;q>=0;q--){if(s.data[q].y!=null&&!isNaN(s.data[q].y)){last=s.data[q];break;}}
    if(last){var lx=X(last.x),ly=Y(last.y);
      svg+='<circle class="pt" cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="6.5" fill="'+s.color+'" opacity="0.18"/>';
      svg+='<circle class="pt" cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="3.4" fill="'+s.color+'" stroke="'+PAL.ink+'" stroke-width="1.1"/>';
      if(series.length<=2) svg+='<text class="pt" x="'+(lx-7).toFixed(1)+'" y="'+(ly-8).toFixed(1)+'" fill="'+s.color+'" font-size="10.5" font-weight="700" text-anchor="end">'+(Math.round(last.y*100)/100).toLocaleString()+'</text>';
    }});
  svg+='<rect class="hit" x="'+mL+'" y="'+mT+'" width="'+iw+'" height="'+ih+'" fill="transparent"/>';
  svg+='</svg>';
  mount.innerHTML=svg;
  function fmtTick(g){var a=Math.abs(g);return a>=1000?(Math.round(g/100)/10)+'k':(Math.round(g*100)/100);}
  var all=series.concat(right?[right]:[]);
  var tip=el('div',{class:'tooltip hidden'}); mount.appendChild(tip);
  var guide=null, svgEl=mount.querySelector('svg'), allX=uniqSortedX(all);
  svgEl.addEventListener('mousemove',function(ev){
    var rect=svgEl.getBoundingClientRect(); var px=(ev.clientX-rect.left)/rect.width*W;
    if(px<mL||px>mL+iw){tip.classList.add('hidden');if(guide){guide.remove();guide=null;}return;}
    var xv=minX+(px-mL)/iw*xr, nearest=allX[0],best=1e18;
    allX.forEach(function(xx){var dd=Math.abs(xx-xv);if(dd<best){best=dd;nearest=xx;}});
    var gx=X(nearest);
    if(!guide){guide=document.createElementNS('http://www.w3.org/2000/svg','line');guide.setAttribute('stroke',PAL.muted);guide.setAttribute('stroke-width','1');guide.setAttribute('opacity','.55');svgEl.appendChild(guide);}
    guide.setAttribute('x1',gx);guide.setAttribute('x2',gx);guide.setAttribute('y1',mT);guide.setAttribute('y2',mT+ih);
    var html='<div class="tt-d">'+fmtDate(nearest)+' '+new Date(nearest).getUTCFullYear()+'</div>';var any=false;
    all.forEach(function(s){var p=s.data.find(function(q){return q.x===nearest;});
      if(p&&p.y!=null&&!isNaN(p.y)){any=true;html+='<div class="tt-r"><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+s.color+'"></i> '+s.label+'</span><b>'+(Math.round(p.y*100)/100).toLocaleString()+'</b></div>';}});
    if(!any){tip.classList.add('hidden');return;}
    tip.innerHTML=html;tip.classList.remove('hidden');
    var tx=gx/W*rect.width+14; if(tx>rect.width-150)tx=gx/W*rect.width-160;
    tip.style.left=Math.max(2,tx)+'px'; tip.style.top='6px';
  });
  svgEl.addEventListener('mouseleave',function(){tip.classList.add('hidden');if(guide){guide.remove();guide=null;}});
}
function uniqSortedX(series){var set={};series.forEach(function(s){s.data.forEach(function(p){set[p.x]=1;});});
  return Object.keys(set).map(Number).sort(function(a,b){return a-b;});}
function S(rows,key,label,color,extra){var s={label:label,color:color,data:rows.map(function(r){return {x:r.x,y:r[key]!=null?r[key]:null};})};if(extra)for(var k in extra)s[k]=extra[k];return s;}
function Sraw(rows,rawkey,label,color){return {label:label,color:color,data:rows.map(function(r){var y=rawkey?r.raw[rawkey]:null;return {x:r.x,y:(y!=null&&!isNaN(y))?y:null};})};}
function flowOverlay(rows){ if(!STATE.flow) return null;
  return {label:'Flow (m³/d)', color:getPal().series[5], data:rows.map(function(r){return {x:r.x,y:r.flow!=null?r.flow:null};})}; }

function spark(rows,key,color){
  var W=150,H=30,data=rows.map(function(r){return r[key];}).filter(function(x){return x!=null&&!isNaN(x);});
  if(data.length<2)return '';
  var lo=Math.min.apply(null,data),hi=Math.max.apply(null,data),rng=(hi-lo)||1;
  var total=data.length,idx=0,d='';
  rows.forEach(function(r){var v=r[key];if(v==null||isNaN(v))return;var x=idx/(total-1)*W;var y=H-4-(v-lo)/rng*(H-8);d+=(idx?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';idx++;});
  return '<div class="spark"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><path class="series" pathLength="1" d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg></div>';
}

function card(section,title,note,series,opts){
  var c=el('div',{class:'card'});
  c.style.animationDelay=((section._n=(section._n||0)+1)*0.035)+'s';
  var h=el('div',{class:'ct'}); h.appendChild(el('span',null,title));
  if(note)h.appendChild(el('span',{class:'note'},note)); c.appendChild(h);
  var leg=(series||[]).slice(); if(opts&&opts.right&&STATE.flow) leg=leg.concat([opts.right]);
  if(leg.length>1){var lg=el('div',{class:'legend'});
    leg.forEach(function(s){var sp=el('span');sp.innerHTML='<i style="background:'+s.color+'"></i>'+s.label;lg.appendChild(sp);});c.appendChild(lg);}
  var ch=el('div',{class:'chart'}); c.appendChild(ch); section.appendChild(c);
  requestAnimationFrame(function(){chart(ch,series||[],opts||{});});
  c._render=function(){chart(ch,series||[],opts||{});};
  return c;
}
function sect(num,title,badge){
  var s=el('div',{class:'section'});var h=el('h3');
  h.appendChild(el('span',{class:'si'},num));
  h.appendChild(el('span',null,title));
  if(badge){h.appendChild(el('span',{class:'badge pill'},badge));}s.appendChild(h);
  var g=el('div',{class:'grid'});s.appendChild(g);s._grid=g;return s;}

// ---------- render (ordered by process: EQ → Primary → Secondary → Tertiary) ----------
function render(){
  var P=getPal(); COLORS=P.series;
  var host=$('#dash'); host.innerHTML='';
  var cat=STATE.cat, rows=windowed(computeRows(cat));
  if(!rows.length){host.appendChild(el('div',{class:'empty'},'No data in this window.'));return;}
  renderKPIs(host,rows,P);
  var lim=CFG.limits, DO=CFG.DO, VS=CFG.VS, ci=CAT_INFO[cat], C=COLS[cat], G=PLANT[cat];
  var fo=function(){return flowOverlay(rows);};

  /* ===== 1. EQUALIZATION / INFLUENT ===== */
  var s1=sect('1','Equalization tank — influent','raw effluent received');
  card(s1._grid,'Flow received','m³/d',[S(rows,'flow','Total effluent',COLORS[0])],{height:200,y0:0});
  var codScale=0;
  rows.forEach(function(r){['inCODu','inCODf','inBOD','partCOD'].forEach(function(k){if(r[k]!=null&&!isNaN(r[k])&&r[k]>codScale)codScale=r[k];});});
  card(s1._grid,'COD & BOD — influent','mg/L · shared scale (flow on right axis)',
    [S(rows,'inCODu','COD (unfiltered)',COLORS[0]),S(rows,'inCODf','COD (filtered)',COLORS[5]),S(rows,'inBOD','BOD',COLORS[1])],
    {right:fo(),y0:0,forceMin:0,forceMax:codScale});
  card(s1._grid,'Particulate COD','unfiltered − filtered · same scale as above',
    [S(rows,'partCOD','Particulate COD',COLORS[4])],{y0:0,forceMin:0,forceMax:codScale});
  card(s1._grid,'BOD/COD ratio','biodegradability',[S(rows,'bodcod','BOD/COD',COLORS[2])],{height:190});
  card(s1._grid,'Turbidity — influent','NTU',[S(rows,'turbIn','Influent turbidity',COLORS[3])],{right:fo()});
  if(G) card(s1._grid,'Equalization HRT','hours · V '+fmtN(G.eqVol)+' m³',
    [{label:'HRT (h)',color:COLORS[2],data:rows.map(function(r){return {x:r.x,y:r.flow?G.eqVol/r.flow*24:null};})}],{y0:0,height:190});
  host.appendChild(s1);

  /* ===== 2. PRIMARY ===== */
  var s2=sect('2','Primary — coagulation & settling','PAC / lime / polymer');
  card(s2._grid,'COD removal — primary vs overall','% (flow on right axis)',
    [S(rows,'primRem','Primary %',COLORS[1]),S(rows,'overRem','Overall %',COLORS[0])],{right:fo()});
  card(s2._grid,'Particulate COD vs primary removal','is primary catching the settleables?',
    [S(rows,'partCOD','Particulate COD',COLORS[4]),
     {label:'COD removed (primary)',color:COLORS[1],data:rows.map(function(r){return {x:r.x,y:(r.inCODu!=null&&r.primCOD!=null)?r.inCODu-r.primCOD:null};})}]);
  card(s2._grid,'Turbidity — influent vs primary o/f','NTU',
    [S(rows,'turbIn','Influent',COLORS[3]),S(rows,'turbPrim','Primary o/f',COLORS[1])],{right:fo()});
  if(C.colourIn||C.colourPrim){
    var cs=[]; if(C.colourIn)cs.push(Sraw(rows,C.colourIn,'Influent colour',COLORS[4]));
    if(C.colourPrim)cs.push(Sraw(rows,C.colourPrim,'Primary o/f colour',COLORS[1]));
    card(s2._grid,'Colour — in vs after primary','toxicity proxy (Cat-2/3)',cs);
  }
  if(G){
    card(s2._grid,'Primary settler HRT','hours · '+G.primName,
      [{label:'HRT (h)',color:COLORS[2],data:rows.map(function(r){return {x:r.x,y:r.flow?G.primVol/r.flow*24:null};})}],
      {y0:0,height:195,thresholds:[{y:CFG.HRT.primaryMin,label:'min '+CFG.HRT.primaryMin+' h',color:P.red,dash:'3 3'}]});
    card(s2._grid,'Primary surface overflow rate (SOR)','m³/m²·d · A '+Math.round(G.primArea)+' m²',
      [{label:'Primary SOR',color:COLORS[1],data:rows.map(function(r){return {x:r.x,y:r.flow?r.flow/G.primArea:null};})}],
      {y0:0,height:195,thresholds:[{y:CFG.SOR.primaryMax,label:'upper '+CFG.SOR.primaryMax,color:P.amber,dash:'3 3'}]});
  }
  host.appendChild(s2);

  /* ===== 3. SECONDARY ===== */
  var s3=sect('3','Secondary — activated sludge','ASP · '+ci.chambers.length+' sample point'+(ci.chambers.length>1?'s':''));
  var doSer=ci.chambers.map(function(nm,i){return {label:nm,color:COLORS[i%COLORS.length],data:rows.map(function(r){return {x:r.x,y:(r.doArr[i]!=null)?r.doArr[i]:null};})};});
  card(s3._grid,'Dissolved oxygen by chamber','anoxic < '+DO.anoxic+' mg/L',doSer,
    {y0:0,right:fo(),thresholds:[{y:DO.low,label:'target '+DO.low,color:P.amber,dash:'3 3'},{y:DO.anoxic,label:'anoxic',color:P.red,dash:'3 3'}],
     bands:[{y0:0,y1:DO.anoxic,color:P.red},{y0:DO.anoxic,y1:DO.low,color:P.amber}]});
  card(s3._grid,'MLSS & MLVSS','biomass inventory (mg/L)',[S(rows,'mlss','MLSS',COLORS[0]),S(rows,'mlvss','MLVSS',COLORS[2])]);
  card(s3._grid,'MLVSS : MLSS ratio','active fraction — targets 0.70 / 0.65',[S(rows,'vsRatio','MLVSS/MLSS',COLORS[5])],
    {height:200,thresholds:[{y:VS.desirable,label:'desirable '+VS.desirable.toFixed(2),color:P.green,dash:'2 3',w:1.4},
                            {y:VS.minimum,label:'minimum '+VS.minimum.toFixed(2),color:P.amber,dash:'2 3',w:1.4}]});
  card(s3._grid,'Sludge wastage & recycle','m³/d — the main F/M lever',
    [S(rows,'waste','Sludge wastage',COLORS[1]),S(rows,'recycle','Recycle (RAS)',COLORS[0])],{y0:0});
  card(s3._grid,'SVI','settleability (mL/g)',[S(rows,'svi','SVI',COLORS[3])],
    {thresholds:[{y:CFG.SVI.fair,label:'fair '+CFG.SVI.fair,color:P.amber,dash:'3 3'},{y:CFG.SVI.bad,label:'bulking '+CFG.SVI.bad,color:P.red,dash:'3 3'}]});
  var vol=CFG.aerVol[cat], band=CFG.fmBand[cat];
  if(vol){
    var fm=rows.map(function(r){var sub=(CFG.fmBasis==='COD')?r.primCOD:r.raw[C.primBOD];
      return {x:r.x,y:(r.flow!=null&&sub!=null&&r.mlvss)?(r.flow*sub)/(vol*r.mlvss):null};});
    card(s3._grid,'F/M ratio ('+CFG.fmBasis+' basis)','band '+band[0]+'–'+band[1]+' · V '+fmtN(vol)+' m³',[{label:'F/M',color:COLORS[0],data:fm}],
      {y0:0,thresholds:[{y:band[0],label:'low '+band[0],color:P.amber,dash:'3 3'},{y:band[1],label:'high '+band[1],color:P.amber,dash:'3 3'}],
       bands:[{y0:band[0],y1:band[1],color:P.green}]});
  } else {
    var c0=el('div',{class:'card'});c0.innerHTML='<div class="ct"><span>F/M ratio</span><span class="note">needs aeration volume</span></div>'+
      '<div class="empty"><b>Cat-2 capacities not supplied yet.</b><br>Add the Cat-2 aeration volume in <b>⚙ Config</b> to switch on F/M, HRT and SOR.</div>';
    s3._grid.appendChild(c0);
  }
  card(s3._grid,'COD removal — secondary','% (flow on right axis)',[S(rows,'secRem','Secondary %',COLORS[2])],{right:fo()});
  card(s3._grid,'Turbidity — secondary clarifier o/f','NTU',[S(rows,'turbSec','Secondary o/f',COLORS[3])],{right:fo()});
  if(G){
    card(s3._grid,'Aeration HRT','hours · '+G.aerDetail,
      [{label:'HRT (h)',color:COLORS[2],data:rows.map(function(r){return {x:r.x,y:r.flow?G.aerVol/r.flow*24:null};})}],{y0:0,height:195});
    card(s3._grid,'Secondary clarifier SOR','m³/m²·d · A '+Math.round(G.scArea)+' m²',
      [{label:'Secondary SOR',color:COLORS[0],data:rows.map(function(r){return {x:r.x,y:r.flow?r.flow/G.scArea:null};})}],
      {y0:0,height:195,thresholds:[{y:CFG.SOR.secondaryMax,label:'upper '+CFG.SOR.secondaryMax,color:P.amber,dash:'3 3'}]});
  }
  host.appendChild(s3);

  /* ===== 4. TERTIARY ===== */
  var s4=sect('4','Tertiary — polishing & final effluent','vs discharge limits');
  card(s4._grid,'Final COD','limit '+lim.COD+' mg/L (flow on right axis)',[S(rows,'finCOD','Final COD',COLORS[0])],
    {right:fo(),thresholds:[{y:lim.COD,label:'limit',color:P.red,dash:'3 3'}]});
  card(s4._grid,'Final BOD','limit '+lim.BOD+' mg/L',[S(rows,'finBOD','Final BOD',COLORS[1])],
    {thresholds:[{y:lim.BOD,label:'limit',color:P.red,dash:'3 3'}],height:195});
  card(s4._grid,'Final TSS','limit '+lim.TSS+' mg/L',[S(rows,'finTSS','Final TSS',COLORS[5])],
    {thresholds:[{y:lim.TSS,label:'limit',color:P.red,dash:'3 3'}],height:195});
  card(s4._grid,'Ammonia (NH₄-N) out','nitrifier health',[S(rows,'finNH4','NH₄-N',COLORS[4])],{height:195});
  if(G) card(s4._grid,'Tertiary surface overflow rate (SOR)','m³/m²·d · '+G.tertName+' · A '+Math.round(G.tertArea)+' m²',
    [{label:'Tertiary SOR',color:COLORS[2],data:rows.map(function(r){return {x:r.x,y:r.flow?r.flow/G.tertArea:null};})}],
    {y0:0,thresholds:[{y:CFG.SOR.tertiaryMax,label:'upper '+CFG.SOR.tertiaryMax,color:P.amber,dash:'3 3'}]});
  host.appendChild(s4);

  /* ===== 5. RAW EXPLORER ===== */
  var s5=sect('5','Raw parameter explorer','plot any logged column');
  var bar=el('div',{class:'rawbar'});
  var sel=el('select'); var keys=STATE.books[cat].keys.slice().sort();
  keys.forEach(function(k){sel.appendChild(el('option',{value:k},k));});
  var prev=STATE['raw_'+cat]; if(prev&&keys.indexOf(prev)>=0)sel.value=prev;
  bar.appendChild(el('span',{class:'pill'},'Parameter')); bar.appendChild(sel);
  s5.insertBefore(bar,s5._grid);
  function drawRaw(){var key=sel.value||keys[0];STATE['raw_'+cat]=key;s5._grid.innerHTML='';s5._grid._n=0;
    card(s5._grid,key,'raw daily values',[Sraw(rows,key,key.split('|').pop().trim(),COLORS[0])],{height:230,right:fo()});}
  sel.addEventListener('change',drawRaw); drawRaw();
  host.appendChild(s5);
  STATE._cards=$$('.card',host);
}

function animateNum(node,to,dec){
  if(to==null||isNaN(to)){node.textContent='—';return;}
  var fmt=function(x){return (dec?(Math.round(x*Math.pow(10,dec))/Math.pow(10,dec)).toFixed(dec):Math.round(x)).toLocaleString();};
  var t0=(typeof performance!=='undefined'&&performance.now)?performance.now():null;
  if(t0==null||typeof requestAnimationFrame!=='function'){node.textContent=fmt(to);return;}
  function step(t){var p=(!t||isNaN(t))?1:Math.min(1,(t-t0)/620);var e=1-Math.pow(1-p,3);node.textContent=fmt(to*e);if(p<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}
function kpi(host,lab,val,unit,cls,meta,sparkHtml,dec){var c=el('div',{class:'kpi '+cls});
  c.style.animationDelay=((host._k=(host._k||0)+1)*0.05)+'s';
  var l=el('div',{class:'lab'});l.appendChild(el('span',null,lab));l.appendChild(el('span',{class:'dot '+cls}));c.appendChild(l);
  var v=el('div',{class:'val'});var num=el('span',{class:'num'},'—');v.appendChild(num);
  if(unit){v.appendChild(document.createTextNode(' '));v.appendChild(el('span',{class:'unit'},unit));}c.appendChild(v);
  if(meta)c.appendChild(el('div',{class:'meta'},meta));
  if(sparkHtml){var sp=el('div');sp.innerHTML=sparkHtml;c.appendChild(sp.firstChild);}
  host.appendChild(c); animateNum(num,val,dec);}
function renderKPIs(host,rows,P){
  var box=el('div',{class:'kpis'}); var lim=CFG.limits,DO=CFG.DO;
  var lc=latest(rows,'finCOD'),lb=latest(rows,'finBOD'),lm=latest(rows,'mlss'),lo=latest(rows,'overRem'),lw=latest(rows,'waste');
  var minDO=null,dRow=null;
  for(var i=rows.length-1;i>=0;i--){var a=rows[i].doArr.filter(function(x){return x!=null;});
    if(a.length){minDO=Math.min.apply(null,a);dRow=rows[i];break;}}
  var codCls=lc?(lc.finCOD>lim.COD?'r':lc.finCOD>lim.COD*0.8?'a':'g'):'n';
  var bodCls=lb?(lb.finBOD>lim.BOD?'r':lb.finBOD>lim.BOD*0.8?'a':'g'):'n';
  var doCls=minDO==null?'n':(minDO<DO.anoxic?'r':minDO<DO.low?'a':'g');
  var oCls=lo?(lo.overRem>=70?'g':lo.overRem>=50?'a':'r'):'n';
  var col=function(cls){return cls==='g'?P.green:cls==='a'?P.amber:cls==='r'?P.red:P.muted;};
  kpi(box,'Final COD',lc?lc.finCOD:null,'mg/L',codCls,lc?('on '+lc.date+' · limit '+lim.COD):'no data',spark(rows,'finCOD',col(codCls)),0);
  kpi(box,'Final BOD',lb?lb.finBOD:null,'mg/L',bodCls,lb?('limit '+lim.BOD):'no data',spark(rows,'finBOD',col(bodCls)),0);
  kpi(box,'Lowest chamber DO',minDO,'mg/L',doCls,dRow?(minDO<DO.anoxic?'ANOXIC':minDO<DO.low?'low':'ok')+' · '+dRow.date:'no data',null,1);
  kpi(box,'MLSS',lm?lm.mlss:null,'mg/L','n',lm?('MLVSS '+fmtN(lm.mlvss)):'',spark(rows,'mlss',P.series[0]),0);
  kpi(box,'Sludge wastage',lw?lw.waste:null,'m³/d','n','latest logged',spark(rows,'waste',P.series[1]),0);
  kpi(box,'Overall COD removal',lo?lo.overRem:null,'%',oCls,'latest',spark(rows,'overRem',col(oCls)),0);
  var G=PLANT[STATE.cat], vol=CFG.aerVol[STATE.cat];
  if(G&&vol){
    var fmRow=null;
    for(var j=rows.length-1;j>=0;j--){var r=rows[j],sub=(CFG.fmBasis==='COD')?r.primCOD:r.raw[COLS[STATE.cat].primBOD];
      if(r.flow&&sub!=null&&r.mlvss){fmRow={v:(r.flow*sub)/(vol*r.mlvss)};break;}}
    var bd=CFG.fmBand[STATE.cat];
    var fmCls=fmRow?((fmRow.v<bd[0]||fmRow.v>bd[1])?'a':'g'):'n';
    kpi(box,'F/M ratio',fmRow?fmRow.v:null,'',fmCls,'band '+bd[0]+'–'+bd[1]+' · '+CFG.fmBasis,null,3);
  }
  host.appendChild(box);
}

// ---------- controls ----------
function buildControls(){
  var c=$('#controls'); c.innerHTML='';
  var tabs=el('div',{class:'tabs'});
  ['Cat-1','Cat-2','Cat-3'].forEach(function(cat){
    var loaded=!!STATE.books[cat];
    var t=el('div',{class:'tab'+(cat===STATE.cat?' active':'')+(loaded?'':' disabled')});
    t.innerHTML='<span class="k">'+cat+'</span><small>'+CAT_INFO[cat].name+'</small>';
    if(loaded)t.addEventListener('click',function(){STATE.cat=cat;save('cat',cat);buildControls();render();});
    tabs.appendChild(t);
  });
  c.appendChild(tabs);
  var wins=el('div',{class:'winbtns'});
  [['15','15d'],['30','30d'],['60','60d'],['90','90d'],['all','All']].forEach(function(w){
    var b=el('button',null,w[1]); if((STATE.win==='all'&&w[0]==='all')||String(STATE.win)===w[0])b.className='active';
    b.addEventListener('click',function(){STATE.win=w[0]==='all'?'all':+w[0];save('win',STATE.win);buildControls();render();});
    wins.appendChild(b);
  });
  c.appendChild(el('span',{class:'pill'},'Window')); c.appendChild(wins);
  var fb=el('button',{class:'btn small'+(STATE.flow?' on':'')}, (STATE.flow?'✓ ':'')+'Flow overlay');
  fb.addEventListener('click',function(){STATE.flow=!STATE.flow;save('flow',STATE.flow);buildControls();render();});
  c.appendChild(fb);
  c.appendChild(el('span',{class:'spacer'}));
  var cfgBtn=el('button',{class:'btn small'},'⚙ Config'); cfgBtn.addEventListener('click',toggleCfg); c.appendChild(cfgBtn);
  var rl=el('button',{class:'btn small'},'↻ Update files'); rl.addEventListener('click',function(){showLoader(true);}); c.appendChild(rl);
  var rows=computeRows(STATE.cat);
  if(rows.length){
    var last=rows[rows.length-1].date, d=new Date(last+'T00:00:00Z');
    var pretty=d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear();
    var chip=el('span',{class:'pill latest',title:'Most recent day of data in the loaded workbook'});
    chip.innerHTML='<span class="lbl">Latest entry</span><span class="dt">'+pretty+'</span>';
    c.appendChild(chip);
  }
}
function toggleCfg(){var p=$('#cfgpanel'); if(p){p.remove();return;}
  var cat=STATE.cat;
  var p2=el('div',{id:'cfgpanel',class:'card'}); p2.style.margin='0 0 14px';
  p2.innerHTML='<div class="ct"><span>Configuration</span><span class="note">applies live · saved on this computer · persists between sessions</span></div>';
  var bar=el('div',{class:'cfgbar'});
  function grp(t){bar.appendChild(el('div',{class:'cfggrp'},t));}
  function num(lab,val,cb,step){var l=el('label',{class:'fld'},lab);var inp=el('input',{type:'number',step:step||'any'});
    inp.value=val==null?'':val;
    inp.addEventListener('input',function(){cb(inp.value===''?null:parseFloat(inp.value));save('cfg',CFG);render();});
    l.appendChild(inp);bar.appendChild(l);}

  grp('Secondary — aeration targets');
  num('DO target (mg/L)',CFG.DO.low,function(v){CFG.DO.low=v;},'0.1');
  num('DO anoxic below',CFG.DO.anoxic,function(v){CFG.DO.anoxic=v;},'0.1');
  num('MLVSS:MLSS desirable',CFG.VS.desirable,function(v){CFG.VS.desirable=v;},'0.01');
  num('MLVSS:MLSS minimum',CFG.VS.minimum,function(v){CFG.VS.minimum=v;},'0.01');
  num('F/M low — '+cat,CFG.fmBand[cat][0],function(v){CFG.fmBand[cat][0]=v;},'0.01');
  num('F/M high — '+cat,CFG.fmBand[cat][1],function(v){CFG.fmBand[cat][1]=v;},'0.01');
  var bl=el('label',{class:'fld'},'F/M basis');var bs=el('select');['BOD','COD'].forEach(function(o){bs.appendChild(el('option',{value:o},o));});
  bs.value=CFG.fmBasis;bs.addEventListener('change',function(){CFG.fmBasis=bs.value;save('cfg',CFG);render();});bl.appendChild(bs);bar.appendChild(bl);

  grp('Settling & hydraulics');
  num('SVI fair above',CFG.SVI.fair,function(v){CFG.SVI.fair=v;});
  num('SVI bulking above',CFG.SVI.bad,function(v){CFG.SVI.bad=v;});
  num('Primary HRT min (h)',CFG.HRT.primaryMin,function(v){CFG.HRT.primaryMin=v;},'0.1');
  num('Primary SOR max',CFG.SOR.primaryMax,function(v){CFG.SOR.primaryMax=v;});
  num('Secondary SOR max',CFG.SOR.secondaryMax,function(v){CFG.SOR.secondaryMax=v;});
  num('Tertiary SOR max',CFG.SOR.tertiaryMax,function(v){CFG.SOR.tertiaryMax=v;});

  grp('Plant geometry — aeration volume (m³)');
  num('Cat-1',CFG.aerVol['Cat-1'],function(v){CFG.aerVol['Cat-1']=v;});
  num('Cat-2 (pending)',CFG.aerVol['Cat-2'],function(v){CFG.aerVol['Cat-2']=v;});
  num('Cat-3',CFG.aerVol['Cat-3'],function(v){CFG.aerVol['Cat-3']=v;});

  grp('Final effluent — consent limits');
  num('COD limit',CFG.limits.COD,function(v){CFG.limits.COD=v;});
  num('BOD limit',CFG.limits.BOD,function(v){CFG.limits.BOD=v;});
  num('TSS limit',CFG.limits.TSS,function(v){CFG.limits.TSS=v;});

  grp('Settings');
  var row=el('div',{class:'cfgbar'}); row.style.margin='2px 0 0';
  var b1=el('button',{class:'btn small'},'Reset targets to defaults');
  b1.addEventListener('click',function(){
    try{localStorage.removeItem('cetp_cfg');}catch(e){}
    location.reload();
  });
  row.appendChild(b1);
  if(PERSIST_DATA){
    var b2=el('button',{class:'btn small'},'Clear saved workbooks');
    b2.addEventListener('click',function(){
      idbClear().then(function(){STATE.books={};STATE.cat=null;updateTags();showLoader(true);
        var p3=$('#cfgpanel'); if(p3)p3.remove();});
    });
    row.appendChild(b2);
    row.appendChild(el('span',{class:'pill'},'Workbooks stored in this browser (IndexedDB)'));
  } else {
    row.appendChild(el('span',{class:'pill'},'No workbook data is stored — files are loaded each session'));
  }
  p2.appendChild(bar); p2.appendChild(row); $('#controls').after(p2);
}

function applyTheme(t,rerender){var root=document.documentElement||document.body;
  root.setAttribute('data-theme',t); STATE.theme=t; save('theme',t);
  var kn=$('#themeKnob'); if(kn)kn.textContent=(t==='light'?'☀️':'🌙');
  if(rerender&&STATE.cat)render();}

function showLoader(show){$('#loader').classList.toggle('hidden',!show);$('#app').classList.toggle('hidden',show);}
function readFile(file){return new Promise(function(res,rej){var fr=new FileReader();
  fr.onload=function(){try{var parsed=CETP.parseWorkbook(fr.result);var cat=CETP.detectCategory(parsed.keys)||guessCat(file.name);
    res({cat:cat,parsed:parsed,name:file.name});}catch(e){rej({name:file.name,err:e.message});}};
  fr.onerror=function(){rej({name:file.name,err:'read error'});};fr.readAsArrayBuffer(file);});}
function guessCat(n){if(/3/.test(n))return 'Cat-3';if(/2/.test(n))return 'Cat-2';if(/1/.test(n))return 'Cat-1';return null;}
function handleFiles(files){
  var errs=$('#loaderr'); errs.innerHTML='';
  var list=Array.prototype.slice.call(files).filter(function(f){return /\.xlsx$/i.test(f.name);});
  if(!list.length){errs.innerHTML='<div class="errbox">Please drop .xlsx workbook files.</div>';return;}
  Promise.all(list.map(function(f){return readFile(f).catch(function(e){return e;});})).then(function(results){
    var loadedAny=false,msgs=[];
    results.forEach(function(r){if(r.parsed&&r.cat){var bk={records:r.parsed.records,keys:r.parsed.keys,file:r.name};
        STATE.books[r.cat]=bk; if(PERSIST_DATA) idbSave(r.cat,bk); loadedAny=true;msgs.push(r.cat+' ✓ ('+r.parsed.records.length+' days)');}
      else msgs.push((r.name||'file')+': '+(r.err||'unrecognised'));});
    updateTags();
    if(loadedAny){var saved=load('cat',null);
      STATE.cat=(STATE.cat&&STATE.books[STATE.cat])?STATE.cat:(saved&&STATE.books[saved]?saved:(STATE.books['Cat-1']?'Cat-1':Object.keys(STATE.books)[0]));
      showLoader(false);buildControls();render();}
    if(msgs.some(function(m){return /:/.test(m)&&!/✓/.test(m);}))errs.innerHTML='<div class="errbox">'+msgs.join('<br>')+'</div>';
  });
}
function updateTags(){$$('#filetags .tag').forEach(function(t){var cat=t.getAttribute('data-cat');t.classList.toggle('ok',!!STATE.books[cat]);
  t.textContent=cat+(STATE.books[cat]?' ✓':'');});}

function init(){
  var t=STATE.theme||'light';   // light is the default; a saved choice still wins
  applyTheme(t,false);
  var tt=$('#themeToggle'); if(tt)tt.addEventListener('click',function(){applyTheme(STATE.theme==='light'?'dark':'light',true);});
  var dz=$('#drop'), inp=$('#fileinput');
  dz.addEventListener('click',function(){inp.click();});
  inp.addEventListener('change',function(){handleFiles(inp.files);});
  ['dragenter','dragover'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.add('drag');});});
  ['dragleave','drop'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.remove('drag');});});
  dz.addEventListener('drop',function(e){handleFiles(e.dataTransfer.files);});
  window.addEventListener('dragover',function(e){e.preventDefault();});
  window.addEventListener('drop',function(e){e.preventDefault();});
  var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){if(STATE._cards)STATE._cards.forEach(function(c){if(c._render)c._render();});},180);});

  // restore previously loaded workbooks from IndexedDB (only when PERSIST_DATA is on)
  if(!PERSIST_DATA) return;
  idbLoadAll().then(function(saved){
    var cats=Object.keys(saved||{});
    if(!cats.length) return;
    cats.forEach(function(c){STATE.books[c]=saved[c];});
    updateTags();
    var pref=load('cat',null);
    STATE.cat=(pref&&STATE.books[pref])?pref:(STATE.books['Cat-1']?'Cat-1':cats[0]);
    showLoader(false); buildControls(); render();
    var note=$('#restored');
    if(note){note.classList.remove('hidden');
      note.textContent='Restored '+cats.length+' saved workbook'+(cats.length>1?'s':'')+' — use “Update files” after adding new rows in Excel.';
      setTimeout(function(){note.classList.add('fade');},4200);}
  });
}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
})();
