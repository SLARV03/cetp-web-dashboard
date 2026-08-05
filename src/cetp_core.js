/* CETP core: dependency-free .xlsx reader + schema-drift-proof parser + metrics.
   Runs in both Node (for tests) and the browser (no DOM APIs used).
   xlsx = ZIP(DEFLATE) of OOXML. We implement: tiny-inflate, minimal ZIP, OOXML cell read,
   then the same composite-(stage|param)-key parser as the Python pipeline. */
(function (root) {
  'use strict';

  /* ---------- tiny-inflate (raw DEFLATE), getbit-only model — one consistent bit reader ---------- */
  function Tree(){ this.table=new Uint16Array(16); this.trans=new Uint16Array(288); }
  function Data(s,d){ this.s=s; this.i=0; this.tag=0; this.bitcount=0; this.dest=d; this.destLen=0;
    this.ltree=new Tree(); this.dtree=new Tree(); }
  var sltree=new Tree(), sdtree=new Tree();
  var length_bits=new Uint8Array(30), length_base=new Uint16Array(30);
  var dist_bits=new Uint8Array(30), dist_base=new Uint16Array(30);
  var clcidx=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);
  var code_tree=new Tree(), lengths=new Uint8Array(320);
  function build_bits_base(bits,base,delta,first){ var i,sum;
    for(i=0;i<delta;++i) bits[i]=0;
    for(i=0;i<30-delta;++i) bits[i+delta]=(i/delta)|0;
    for(sum=first,i=0;i<30;++i){ base[i]=sum; sum+=1<<bits[i]; } }
  function build_fixed(lt,dt){ var i;
    for(i=0;i<7;++i) lt.table[i]=0; lt.table[7]=24; lt.table[8]=152; lt.table[9]=112;
    for(i=0;i<24;++i) lt.trans[i]=256+i;
    for(i=0;i<144;++i) lt.trans[24+i]=i;
    for(i=0;i<8;++i) lt.trans[24+144+i]=280+i;
    for(i=0;i<112;++i) lt.trans[24+144+8+i]=144+i;
    for(i=0;i<5;++i) dt.table[i]=0; dt.table[5]=32;
    for(i=0;i<32;++i) dt.trans[i]=i; }
  function build_tree(t,ln,off,num){ var i,sum,offs=new Uint16Array(16);
    for(i=0;i<16;++i) t.table[i]=0;
    for(i=0;i<num;++i) t.table[ln[off+i]]++;
    t.table[0]=0;
    for(sum=0,i=0;i<16;++i){ offs[i]=sum; sum+=t.table[i]; }
    for(i=0;i<num;++i) if(ln[off+i]) t.trans[offs[ln[off+i]]++]=i; }
  // single bit reader: LSB-first, one byte buffered at a time
  function getbit(d){ if(!d.bitcount--){ d.tag=d.s[d.i++]|0; d.bitcount=7; } var b=d.tag&1; d.tag>>=1; return b; }
  function read_bits(d,num,base){ var val=0,i; for(i=0;i<num;++i) val|=getbit(d)<<i; return val+base; }
  function decode_symbol(d,t){ var sum=0,cur=0,len=0;
    do{ cur=2*cur+getbit(d); ++len; sum+=t.table[len]; cur-=t.table[len]; }while(cur>=0);
    return t.trans[sum+cur]; }
  function decode_trees(d,lt,dt){ var hlit,hdist,hclen,i,num,length2;
    hlit=read_bits(d,5,257); hdist=read_bits(d,5,1); hclen=read_bits(d,4,4);
    for(i=0;i<19;++i) lengths[i]=0;
    for(i=0;i<hclen;++i) lengths[clcidx[i]]=read_bits(d,3,0);
    build_tree(code_tree,lengths,0,19);
    for(num=0;num<hlit+hdist;){ var sym=decode_symbol(d,code_tree);
      switch(sym){
        case 16:{ var prev=lengths[num-1]; for(length2=read_bits(d,2,3);length2;--length2) lengths[num++]=prev; break; }
        case 17:{ for(length2=read_bits(d,3,3);length2;--length2) lengths[num++]=0; break; }
        case 18:{ for(length2=read_bits(d,7,11);length2;--length2) lengths[num++]=0; break; }
        default: lengths[num++]=sym; break; } }
    build_tree(lt,lengths,0,hlit); build_tree(dt,lengths,hlit,hdist); }
  function inflate_block(d,lt,dt){ while(1){ var sym=decode_symbol(d,lt);
      if(sym===256) return;
      if(sym<256){ d.dest[d.destLen++]=sym; }
      else{ var i,length2,dist,offs; sym-=257;
        length2=read_bits(d,length_bits[sym],length_base[sym]);
        dist=decode_symbol(d,dt);
        offs=d.destLen-read_bits(d,dist_bits[dist],dist_base[dist]);
        for(i=offs;i<offs+length2;++i) d.dest[d.destLen++]=d.dest[i]; } } }
  function inflate_uncompressed(d){ // align to byte boundary, then copy LEN bytes
    d.bitcount=0; d.tag=0;
    var len=(d.s[d.i]|0)|((d.s[d.i+1]|0)<<8);
    var nlen=(d.s[d.i+2]|0)|((d.s[d.i+3]|0)<<8);
    if(len!==((~nlen)&0xffff)) throw new Error('inflate: bad uncompressed block');
    d.i+=4; for(var k=0;k<len;k++) d.dest[d.destLen++]=d.s[d.i++]; }
  function inflate(source,dest){ var d=new Data(source,dest),bfinal,btype;
    do{ bfinal=getbit(d); btype=read_bits(d,2,0);
      if(btype===0) inflate_uncompressed(d);
      else if(btype===1) inflate_block(d,sltree,sdtree);
      else if(btype===2){ decode_trees(d,d.ltree,d.dtree); inflate_block(d,d.ltree,d.dtree); }
      else throw new Error('inflate: bad block type'); }while(!bfinal);
    return d.destLen<dest.length ? dest.subarray(0,d.destLen) : dest; }
  build_fixed(sltree,sdtree); build_bits_base(length_bits,length_base,4,3);
  build_bits_base(dist_bits,dist_base,2,1); length_bits[28]=0; length_base[28]=258;

  /* ---------- minimal ZIP ---------- */
  function u8(ab){ return ab instanceof Uint8Array ? ab : new Uint8Array(ab); }
  function decodeUTF8(bytes){
    if (typeof TextDecoder!=='undefined') return new TextDecoder('utf-8').decode(bytes);
    var s=''; for(var i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
    try{ return decodeURIComponent(escape(s)); }catch(e){ return s; } }
  function readZip(arrayBuffer){
    var bytes=u8(arrayBuffer);
    var dv=new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd=-1;
    for(var i=bytes.length-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
    if(eocd<0) throw new Error('Not a .xlsx (no ZIP end record)');
    var cdCount=dv.getUint16(eocd+10,true), cdOff=dv.getUint32(eocd+16,true), files={}, p=cdOff;
    for(var n=0;n<cdCount;n++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      var method=dv.getUint16(p+10,true), compSize=dv.getUint32(p+20,true),
          uncompSize=dv.getUint32(p+24,true), nameLen=dv.getUint16(p+28,true),
          extraLen=dv.getUint16(p+30,true), commentLen=dv.getUint16(p+32,true),
          localOff=dv.getUint32(p+42,true);
      var name=decodeUTF8(bytes.subarray(p+46,p+46+nameLen));
      files[name]={method:method,compSize:compSize,uncompSize:uncompSize,localOff:localOff};
      p+=46+nameLen+extraLen+commentLen;
    }
    function read(name){
      var f=files[name]; if(!f) return null;
      var lp=f.localOff;
      if(dv.getUint32(lp,true)!==0x04034b50) throw new Error('bad local header for '+name);
      var lnameLen=dv.getUint16(lp+26,true), lextraLen=dv.getUint16(lp+28,true);
      var start=lp+30+lnameLen+lextraLen;
      var comp=bytes.subarray(start,start+f.compSize);
      if(f.method===0) return comp;
      if(f.method===8) return inflate(comp, new Uint8Array(f.uncompSize));
      throw new Error('unsupported zip method '+f.method);
    }
    function readText(name){ var b=read(name); return b?decodeUTF8(b):null; }
    return {files:files, read:read, readText:readText};
  }

  /* ---------- OOXML helpers ---------- */
  function unescapeXml(s){ return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
      .replace(/&apos;/g,"'").replace(/&#39;/g,"'").replace(/&#(\d+);/g,function(_,d){return String.fromCharCode(+d);})
      .replace(/&amp;/g,'&'); }
  function attr(tag,name){ var m=tag.match(new RegExp(name+'="([^"]*)"')); return m?m[1]:null; }
  function colToNum(ref){ var m=ref.match(/^([A-Z]+)(\d+)$/); if(!m) return null;
    var c=0,letters=m[1]; for(var i=0;i<letters.length;i++) c=c*26+(letters.charCodeAt(i)-64);
    return {col:c,row:parseInt(m[2],10)}; }

  function parseSharedStrings(zip){
    var xml=zip.readText('xl/sharedStrings.xml'); if(!xml) return [];
    var out=[], re=/<si>([\s\S]*?)<\/si>/g, m;
    while((m=re.exec(xml))){
      var inner=m[1], t='', tre=/<t[^>]*>([\s\S]*?)<\/t>/g, tm;
      while((tm=tre.exec(inner))) t+=tm[1];
      out.push(unescapeXml(t));
    }
    return out;
  }
  function parseDateStyles(zip){
    var xml=zip.readText('xl/styles.xml'); if(!xml) return {};
    var custom={}; var nf=/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, m;
    while((m=nf.exec(xml))) custom[m[1]]=unescapeXml(m[2]);
    function isDateFmt(id){
      id=parseInt(id,10);
      if((id>=14&&id<=22)||(id>=45&&id<=47)) return true;
      var code=custom[id]; if(!code) return false;
      var stripped=code.replace(/\[[^\]]*\]/g,'').replace(/"[^"]*"/g,'');
      return /[ymdhs]/i.test(stripped) && !/^[#0.,%]+$/.test(stripped);
    }
    var xfsBlock=xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
    var styleIsDate=[];
    if(xfsBlock){ var xf=/<xf\b[^>]*>|<xf\b[^>]*\/>/g, xm, idx=0;
      while((xm=xf.exec(xfsBlock[1]))){ var id=attr(xm[0],'numFmtId'); styleIsDate[idx++]=id!=null?isDateFmt(id):false; } }
    return styleIsDate;
  }
  function resolveSheets(zip){
    var wb=zip.readText('xl/workbook.xml'), rels=zip.readText('xl/_rels/workbook.xml.rels');
    var relMap={}, rre=/<Relationship\b[^>]*>/g, rm;
    while((rm=rre.exec(rels||''))){ var id=attr(rm[0],'Id'), tgt=attr(rm[0],'Target'); if(id&&tgt) relMap[id]=tgt; }
    var sheets=[], sre=/<sheet\b[^>]*>/g, sm;
    while((sm=sre.exec(wb||''))){
      var name=unescapeXml(attr(sm[0],'name')||'');
      var rid=attr(sm[0],'r:id')||attr(sm[0],'id');
      var tgt=relMap[rid]||''; tgt=tgt.replace(/^\//,'').replace(/^xl\//,'');
      sheets.push({name:name, path:'xl/'+tgt});
    }
    return sheets;
  }
  function excelSerialToISO(serial){
    var ms=Math.round(serial*86400000)+Date.UTC(1899,11,30);
    var d=new Date(ms);
    var y=d.getUTCFullYear(), mo=('0'+(d.getUTCMonth()+1)).slice(-2), da=('0'+d.getUTCDate()).slice(-2);
    return y+'-'+mo+'-'+da;
  }
  function parseSheet(zip, path, shared, styleIsDate){
    var xml=zip.readText(path); if(!xml) return {maxCol:0, cells:{}, dateCells:{}};
    // strip to sheetData
    var sd=xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/); var body=sd?sd[1]:xml;
    var cells={}, dateCells={}, maxCol=0;
    var cre=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
    while((cm=cre.exec(body))){
      var at=cm[1], inner=cm[2]||'';
      var ref=attr(at,'r'); if(!ref) continue;
      var rc=colToNum(ref); if(!rc) continue;
      if(rc.col>maxCol) maxCol=rc.col;
      var t=attr(at,'t'), sIdx=attr(at,'s');
      var val=null, isDate=false;
      var vm=inner.match(/<v>([\s\S]*?)<\/v>/);
      if(t==='s'){ if(vm) val=shared[parseInt(vm[1],10)]; }
      else if(t==='inlineStr'||t==='str'){ var im=inner.match(/<t[^>]*>([\s\S]*?)<\/t>/); val=im?unescapeXml(im[1]):(vm?unescapeXml(vm[1]):null); }
      else { if(vm){ var num=vm[1];
          if(sIdx!=null && styleIsDate[parseInt(sIdx,10)]){ isDate=true; val=excelSerialToISO(parseFloat(num)); }
          else { val=num; } } }
      cells[rc.row+','+rc.col]=val;
      if(isDate) dateCells[rc.row+','+rc.col]=true;
    }
    return {maxCol:maxCol, cells:cells, dateCells:dateCells};
  }

  /* ---------- composite-key parser (mirrors Python parse_cetp.py) ---------- */
  function norm(s){ if(s==null) return null; s=(''+s).replace(/\s+/g,' ').trim(); return s.length?s:null; }
  var SKIP={Blank:1, Sheet1:1};
  function isPlaceholder(v){ if(v==null) return true;
    if(typeof v==='string'){ var t=v.trim(); return t===''||t==='-'||t==='--'||/^n\/?a$/i.test(t)||t==='nil'||t.charAt(0)==='#'; }
    return false; }

  function parseWorkbook(arrayBuffer){
    var zip=readZip(arrayBuffer);
    var shared=parseSharedStrings(zip), styleIsDate=parseDateStyles(zip), sheets=resolveSheets(zip);
    var records=[]; // {date, key->value(number|null)}
    var keysSeen={};
    for(var si=0; si<sheets.length; si++){
      var sh=sheets[si]; if(SKIP[sh.name]) continue;
      var g=parseSheet(zip, sh.path, shared, styleIsDate);
      var cells=g.cells, dateCells=g.dateCells, maxCol=g.maxCol;
      if(maxCol<2) continue;
      // forward-fill row1 (stage) and read row2 (param)
      var stages=[], params=[], keys=[], last=null;
      for(var c=1;c<=maxCol;c++){
        var s1=norm(cells['1,'+c]); if(s1) last=s1; stages[c]=last;
        params[c]=norm(cells['2,'+c]);
      }
      for(var c2=1;c2<=maxCol;c2++){
        var pa=params[c2]; if(pa==null){ keys[c2]=null; continue; }
        var st=stages[c2];
        keys[c2]=(st==null||st===pa)?pa:(st+' | '+pa);
        if(keys[c2]) keysSeen[keys[c2]]=1;
      }
      // data rows: col1 is a date cell
      var maxRow=1; for(var key in cells){ var r=parseInt(key,10); if(r>maxRow) maxRow=r; }
      for(var r2=3;r2<=maxRow;r2++){
        if(!dateCells[r2+',1']) continue;
        var iso=cells[r2+',1'];
        var rec={date:iso, v:{}};
        for(var c3=2;c3<=maxCol;c3++){
          var k=keys[c3]; if(!k) continue;
          var raw=cells[r2+','+c3];
          var num=null;
          if(!isPlaceholder(raw)){ var f=parseFloat(raw); if(!isNaN(f)&&isFinite(f)) num=f; }
          if(num!=null) rec.v[k]=num;
        }
        records.push(rec);
      }
    }
    records.sort(function(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); });
    return {records:records, keys:Object.keys(keysSeen).sort()};
  }

  /* ---------- metric column maps (mirror Python) ---------- */
  var MAP={
    'Cat-1':{ flow:'Cat I Equalization Tank | Total Effluent Received (m3/d)',
      inCODu:'Cat I Equalization Tank | Unfiltered COD (mg/L)', inCODf:'Cat I Equalization Tank | Filtered COD (mg/L)',
      inBOD:'Cat I Equalization Tank | BOD (mg/L)', primCOD:'Pre-Settler I o/f | COD (mg/L)',
      scCOD:'Secondary Clarifier o/f | COD (mg/L)', finCOD:'Tertiary Clariflocculator o/f | COD (mg/L)',
      finBOD:'Tertiary Clariflocculator o/f | BOD (mg/L)', finTSS:'Tertiary Clariflocculator o/f | TSS (mg/L)',
      finNH4:'Tertiary Clariflocculator o/f | NH4-N (mg/L)',
      DO:['Inside Aeration Tank (Chamber 1) | DO (mg/L)','Inside Aeration Tank (Chamber 9) | DO (mg/L)','Inside Aeration Tank (Chamber-16) | DO (mg/L)'],
      MLSS:['Inside Aeration Tank (Chamber 1) | MLSS (mg/L)','Inside Aeration Tank (Chamber 9) | MLSS (mg/L)','Inside Aeration Tank (Chamber-16) | MLSS (mg/L)'],
      MLVSS:['Inside Aeration Tank (Chamber 1) | MLVSS (mg/L)','Inside Aeration Tank (Chamber 9) | MLVSS (mg/L)','Inside Aeration Tank (Chamber-16) | MLVSS (mg/L)'],
      SVI:['Inside Aeration Tank (Chamber 1) | SVI  (ml/g)','Inside Aeration Tank (Chamber 9) | SVI  (ml/g)','Inside Aeration Tank (Chamber-16) | SVI  (ml/g)'] },
    'Cat-2':{ flow:'Cat II Equalization Tank | Total Effluent Received (m3/d)',
      inCODu:'Cat II Equalization Tank | Unfiltered COD (mg/L)', inCODf:'Cat II Equalization Tank | Filtered COD (mg/L)',
      inBOD:'Cat II Equalization Tank | BOD (mg/L)', primCOD:'Tube Settler o/f | COD (mg/L)',
      scCOD:'Secondary Clarifier o/f | COD (mg/L)', finCOD:'Tertiary Tube Settler o/f | COD (mg/L)',
      finBOD:'Tertiary Tube Settler o/f | BOD (mg/L)', finTSS:'Tertiary Tube Settler o/f | TSS (mg/L)',
      finNH4:'Tertiary Tube Settler o/f | NH4-N (mg/L)',
      DO:['Inside Aeration Tank | DO (mg/L)'], MLSS:['Inside Aeration Tank | MLSS (mg/L)'],
      MLVSS:['Inside Aeration Tank | MLVSS (mg/L)'], SVI:['Inside Aeration Tank | SVI (mL/g)'] },
    'Cat-3':{ flow:'Cat III Equalization Tank | Cat III Effluent Received (m3/d)',
      inCODu:'Cat III Equalization Tank | Unfiltered COD (mg/L)', inCODf:'Cat III Equalization Tank | Filtered COD (mg/L)',
      inBOD:'Cat III Equalization Tank | BOD (mg/L)', primCOD:'Pre-Settler I o/f | COD (mg/L)',
      scCOD:'Secondary Clarifier o/f | COD (mg/L)', finCOD:'Tertiary Clariflocculator o/f | COD (mg/L)',
      finBOD:'Tertiary Clariflocculator o/f | BOD (mg/L)', finTSS:'Tertiary Clariflocculator o/f | TSS (mg/L)',
      finNH4:'Secondary Clarifier o/f | NH4-N (mg/L)',
      DO:['Inside Aeration Tank (Chamber 1) | DO','Inside Aeration Tank (Chamber 5) | DO','Inside Aeration Tank (Chamber 8) | DO'],
      MLSS:['Inside Aeration Tank (Chamber 1) | MLSS (mg/L)','Inside Aeration Tank (Chamber 5) | MLSS (mg/L)','Inside Aeration Tank (Chamber 8) | MLSS (mg/L)'],
      MLVSS:['Inside Aeration Tank (Chamber 1) | MLVSS (mg/L)','Inside Aeration Tank (Chamber 5) | MLVSS (mg/L)','Inside Aeration Tank (Chamber 8) | MLVSS (mg/L)'],
      SVI:['Inside Aeration Tank (Chamber 1) | SVI  (mL/g)','Inside Aeration Tank (Chamber 5) | SVI  (mL/g)','Inside Aeration Tank (Chamber 8) | SVI  (mL/g)'] }
  };
  function detectCategory(keys){
    var s=keys.join('||');
    if(/Cat I Equalization Tank/.test(s)) return 'Cat-1';
    if(/Cat II Equalization Tank/.test(s)) return 'Cat-2';
    if(/Cat III Equalization Tank/.test(s)) return 'Cat-3';
    return null;
  }

  root.CETP={ inflate:inflate, readZip:readZip, parseWorkbook:parseWorkbook, MAP:MAP, detectCategory:detectCategory,
    _excelSerialToISO:excelSerialToISO };
  if(typeof module!=='undefined' && module.exports) module.exports=root.CETP;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
