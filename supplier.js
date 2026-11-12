/* طلبيات الموردين — big supplier orders that arrive in several shipments.
   Stored in the same Firestore "orders" collection with type:"supplier" (no rule changes needed).
   Uses helpers from index.html: $, esc, N, money, keyPN, baseA, normPN, fmtD, fmtDay, today, toast, armConfirm, saveBlob, userLabel, readAgency, parseRows, db, role, myId, q, tab, render */

const CUR={SAR:{t:"ريال",rate:1,fr:0},USD:{t:"دولار",rate:3.75,fr:25},EUR:{t:"يورو",rate:4.2,fr:25},AED:{t:"درهم",rate:1.02,fr:10}};
const SST={draft:{t:"بانتظار التأكيد",c:"req"},confirmed:{t:"مؤكدة · توصل دفعات",c:"con"},done:{t:"اكتمل الشحن",c:"ent"},closed:{t:"مقفلة · الباقي ملغي",c:"arr"},cancelled:{t:"ملغاة",c:"can"}};
let supOpen=null, supNew=false, supMode=null, supTabIn="items", supFilter="all", supQ="", supLimit=200, supEditRow=-1;
let sdraft=null, sship=null, sreply=null, srecv=null;

(function(){
  const st=document.createElement("style");
  st.textContent=`
.skpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.skpi .k{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;min-width:0}
.skpi .k span{font-size:12px;color:var(--muted)}
.skpi .k b{font-size:17px;font-variant-numeric:tabular-nums;line-height:1.3;direction:ltr;unicode-bidi:isolate;text-align:start}
.skpi .k small{font-size:11.5px;color:var(--muted)}
.skpi .k.bad b{color:var(--bad)} .skpi .k.ok b{color:var(--ok)} .skpi .k.warn b{color:var(--warn)}
.itabs{display:flex;gap:4px;border-bottom:1px solid var(--line);overflow-x:auto}
.itab{border:none;background:none;border-radius:0;padding:9px 12px;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap}
.itab.on{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
.bar{display:inline-block;width:70px;height:7px;border-radius:4px;background:var(--surface-2);vertical-align:middle;overflow:hidden;margin-inline-end:6px}
.bar i{display:block;height:100%;background:var(--accent)}
.sdrawer{width:min(980px,100%)}
.up{color:var(--bad);font-weight:600} .down{color:var(--ok);font-weight:600}
`;
  document.head.appendChild(st);
  const r=document.createElement("div"); r.id="supRoot"; document.body.appendChild(r);
})();

/* ---------- helpers ---------- */
const sIsO=()=>role==="owner";
const sCur=o=>(CUR[o.currency]||CUR.SAR).t;
const sSar=(o,v)=>v*(N(o.rate)||1)*(1+N(o.freight)/100);
const spill=k=>{const s=SST[k]||SST.draft;return `<span class="pill" style="background:var(--s-${s.c}-bg);color:var(--s-${s.c})">${s.t}</span>`};
const sLate=(o,c)=>o.status==="confirmed"&&o.expected&&o.expected<today()&&c.remN>0;
const sRowsFromPaste=v=>v.split(/\r?\n/).filter(l=>l.trim()).map(l=>l.includes("\t")?l.split("\t"):l.split(/\s{2,}|,|;/).length>1?l.split(/\s{2,}|,|;/):l.trim().split(/\s+/));
const sClean=list=>list.filter(i=>normPN(i.pn)).map(i=>({pn:normPN(i.pn),name:String(i.name||"").trim(),qty:N(i.qty)||0,price:i.price===""||i.price==null||!isFinite(Number(i.price))?null:Math.round(Number(i.price)*10000)/10000}));
const sDiffTxt=(d,o)=>Math.abs(d)<0.005?"—":`<span class="${d>0?"up":"down"} num">${d>0?"+":"−"}${money(Math.abs(d))}</span>`;

function supCalc(o){
  const items=o.items||[], n=items.length, sh=new Array(n).fill(0), rc=new Array(n).fill(0), dm=new Array(n).fill(0);
  let diff=0, invV=0; const diffLines=[], extras=[], short=[];
  (o.shipments||[]).forEach((s,si)=>{
    (s.lines||[]).forEach(l=>{ if(l.i<0||l.i>=n) return; const it=items[l.i], lq=N(l.q), lp=l.p!=null?N(l.p):N(it.price);
      sh[l.i]+=lq; invV+=lq*lp;
      if(s.receivedAt){ const r=l.r!=null?N(l.r):lq; rc[l.i]+=r; dm[l.i]+=N(l.d); if(r<lq||N(l.d)>0) short.push({si,s,l,it,r}) }
      if(l.p!=null&&it.price!=null&&Math.abs(N(l.p)-N(it.price))>0.005){ const d=(N(l.p)-N(it.price))*lq; diff+=d; diffLines.push({si,s,l,it,d}) }
    });
    (s.extras||[]).forEach(x=>{extras.push({si,s,x}); invV+=N(x.q)*N(x.p)});
  });
  let ordV=0, shV=0, remV=0, remQ=0, remN=0, over=0, cutN=0;
  items.forEach((it,i)=>{ const qy=N(it.qty), p=N(it.price); ordV+=qy*p; const rem=Math.max(qy-sh[i]-N(it.cut),0);
    remV+=rem*p; remQ+=rem; if(rem>0) remN++; if(sh[i]>qy) over++; if(N(it.cut)>0) cutN++; shV+=Math.min(sh[i],qy)*p });
  const pendRecv=(o.shipments||[]).filter(s=>!s.receivedAt).length, pendEnt=(o.shipments||[]).filter(s=>s.receivedAt&&!s.enteredAt).length;
  return {sh,rc,dm,diff,diffLines,extras,short,ordV,shV,remV,remQ,remN,over,cutN,invV,pendRecv,pendEnt,pct:ordV?shV/ordV:(n?items.filter((it,i)=>sh[i]>=N(it.qty)).length/n:0)};
}
function supPending(pn){ // used by "فحص قبل الطلب"
  const k=keyPN(pn), out=[];
  sorders.forEach(o=>{ if(!["draft","confirmed"].includes(o.status)) return; const c=supCalc(o);
    (o.items||[]).forEach((it,i)=>{ const p=keyPN(it.pn); if(p===k||baseA(p)===baseA(k)){ const rem=Math.max(N(it.qty)-c.sh[i]-N(it.cut),0); if(rem>0) out.push({o,it,rem}) } }) });
  return out;
}
function supIndex(o){ const idx=new Map(), idxA=new Map();
  (o.items||[]).forEach((it,i)=>{ const k=keyPN(it.pn), a=baseA(k); if(!idx.has(k)) idx.set(k,[]); idx.get(k).push(i); if(!idxA.has(a)) idxA.set(a,[]); idxA.get(a).push(i) });
  return {idx,idxA};
}
function supMatch(o,list){ // shipment lines -> order items
  const c=supCalc(o), alloc=new Array((o.items||[]).length).fill(0), {idx,idxA}=supIndex(o);
  return list.map(x=>{ const k=keyPN(x.pn); let cand=idx.get(k), near=false; if(!cand){ cand=idxA.get(baseA(k)); near=!!cand }
    if(!cand) return {q:x,i:-1};
    const rem=i=>N(o.items[i].qty)-c.sh[i]-alloc[i];
    let i=cand.find(j=>rem(j)>0); if(i==null) i=cand[0];
    const before=Math.max(rem(i),0); alloc[i]+=N(x.qty); const it=o.items[i];
    const pd=x.price!=null&&it.price!=null&&Math.abs(N(x.price)-N(it.price))>0.005;
    return {q:x,i,near,over:Math.max(N(x.qty)-before,0),pd,d:pd?(N(x.price)-N(it.price))*N(x.qty):0};
  });
}
function supMatchReply(o,list){ // supplier confirmation vs draft order
  const {idx,idxA}=supIndex(o), used=new Set(), rows=[];
  list.forEach(x=>{ const k=keyPN(x.pn); const cand=(idx.get(k)||idxA.get(baseA(k))||[]).filter(i=>!used.has(i));
    if(!cand.length){ rows.push({q:x,i:-1}); return } const i=cand[0]; used.add(i); const it=o.items[i];
    rows.push({q:x,i,pc:x.price!=null&&(it.price==null||Math.abs(N(x.price)-N(it.price))>0.005),qc:N(x.qty)!==N(it.qty)}) });
  const missing=(o.items||[]).map((it,i)=>i).filter(i=>!used.has(i));
  return {rows,missing};
}
async function supWrite(o,patch,note){
  if(!db){toast("غير متصل — سجّل الدخول من جديد");return false}
  const now=new Date().toISOString(), data={...patch,updatedAt:now};
  if(note) data.history=[...(o.history||[]).slice(-150),{at:now,by:myId,role,note}];
  try{ if(JSON.stringify({...o,...data}).length>950000){toast("الطلبية كبيرة جداً على مستند واحد — قسّمها على طلبيتين");return false}
    await db.collection("orders").doc(o.id).update(data); setTimeout(renderSupDrawer,0); return true }
  catch(e){ toast(e&&/permission/.test(e.code||"")?"ما عندك صلاحية لهذا الإجراء":"تعذّر الحفظ: "+(e&&e.message||"")); return false }
}

/* ---------- list ---------- */
function renderSup(m){
  if(supNew&&sIsO()){ renderSupNew(m); return }
  const ql=q.trim(), qk=keyPN(q), calc=new Map(sorders.map(o=>[o.id,supCalc(o)]));
  let list=sorders.slice().sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")); const hits=[];
  if(ql){ list=list.filter(o=>(o.ref||"").includes(ql)||(o.supplier||"").includes(ql)||(o.shipments||[]).some(s=>(s.no||"").includes(ql))||(qk.length>=4&&(o.items||[]).some(it=>keyPN(it.pn).includes(qk))));
    if(qk.length>=5) sorders.forEach(o=>{const c=calc.get(o.id); (o.items||[]).forEach((it,i)=>{ if(keyPN(it.pn).includes(qk)) hits.push({o,it,i,c}) })}) }
  const act=sorders.filter(o=>o.status==="confirmed"), sum=f=>act.reduce((a,o)=>a+f(o,calc.get(o.id)),0);
  const allDiff=sorders.filter(o=>o.status!=="cancelled").reduce((a,o)=>a+sSar(o,calc.get(o.id).diff),0);
  const late=act.filter(o=>sLate(o,calc.get(o.id))).length, pr=sorders.reduce((a,o)=>a+calc.get(o.id).pendRecv,0), pe=sorders.reduce((a,o)=>a+calc.get(o.id).pendEnt,0);
  const head=`<div class="skpi" style="margin-block:14px">
    <div class="k"><span>طلبيات مؤكدة مفتوحة</span><b>${act.length}</b><small>${sorders.filter(o=>o.status==="draft").length} بانتظار التأكيد</small></div>
    <div class="k"><span>قيمة الباقي ما وصل</span><b>${money(sum((o,c)=>sSar(o,c.remV)))}</b><small>ريال واصل · ${sum((o,c)=>c.remN)} صنف</small></div>
    <div class="k ${allDiff>0.5?"bad":allDiff<-0.5?"ok":""}"><span>فروقات الأسعار عن المثبت</span><b>${allDiff>0?"+":""}${money(allDiff)}</b><small>ريال · ${sorders.reduce((a,o)=>a+calc.get(o.id).diffLines.length,0)} سطر</small></div>
    <div class="k ${late?"bad":""}"><span>طلبيات متأخرة</span><b>${late}</b><small>عدّت تاريخ الوصول المتوقع</small></div>
    <div class="k ${pr?"warn":""}"><span>دفعات بانتظار استلام المستودع</span><b>${pr}</b><small>${pe} بانتظار الإدخال بالنظام</small></div></div>`;
  const tb=`<div class="toolbar"><span class="sub">${list.length} طلبية${ql?` · بحث: ${esc(ql)}`:""}</span><span class="spacer"></span>${sIsO()?`<button class="primary" data-sa="new">+ طلبية مورد جديدة</button>`:""}</div>`;
  if(!sorders.length){ m.innerHTML=head+`<div class="panel">${tb}<div class="empty"><h3>ما فيه طلبيات موردين بعد</h3>
    <p class="hint">المدير يرفع ملف الطلبية الكبيرة ويثبّت الأسعار. بعدها كل دفعة توصل تنخصم من الطلبية، والبرنامج يحسب الباقي ويقارن سعر كل دفعة بالسعر المثبت.</p>
    ${sIsO()?`<p><button class="primary" data-sa="new">إضافة أول طلبية</button></p>`:""}</div></div>`; return }
  m.innerHTML=head+`<div class="panel">${tb}
   ${hits.length?`<div class="tbl-wrap"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>الطلبية</th><th>المورد</th><th>مطلوب</th><th>انشحن</th><th>الباقي</th><th>السعر المثبت</th></tr></thead><tbody>
     ${hits.slice(0,100).map(h=>`<tr class="click" data-sa="open" data-sid="${esc(h.o.id)}"><td class="pn">${esc(h.it.pn)}</td><td class="wrapcell">${esc(h.it.name||"")}</td><td>${esc(h.o.ref||"")}</td><td>${esc(h.o.supplier||"")}</td>
       <td class="num">${N(h.it.qty)}</td><td class="num">${h.c.sh[h.i]}</td><td class="num">${Math.max(N(h.it.qty)-h.c.sh[h.i]-N(h.it.cut),0)}</td><td class="num">${h.it.price!=null?money(h.it.price):"—"} ${sCur(h.o)}</td></tr>`).join("")}</tbody></table></div>`:""}
   <div class="tbl-wrap"><table><thead><tr><th>الطلبية</th><th>المورد</th><th>التاريخ</th><th>الأصناف</th><th>قيمة الطلبية</th><th>انشحن</th><th>قيمة الباقي</th><th>فرق السعر</th><th>الدفعات</th><th>الحالة</th><th>الوصول المتوقع</th></tr></thead><tbody>
   ${list.map(o=>{const c=calc.get(o.id); return `<tr class="click" data-sa="open" data-sid="${esc(o.id)}"><td><b>${esc(o.ref||"")}</b></td><td>${esc(o.supplier||"")}</td><td class="num">${fmtDay(o.createdAt)}</td>
     <td class="num">${(o.items||[]).length}</td><td class="num">${money(c.ordV)} ${sCur(o)}</td>
     <td><span class="bar"><i style="width:${Math.round(c.pct*100)}%"></i></span><span class="num">${Math.round(c.pct*100)}%</span></td>
     <td class="num">${c.remN?money(c.remV):"—"}</td><td>${sDiffTxt(c.diff,o)}</td>
     <td class="num">${(o.shipments||[]).length}${c.pendRecv?` <span class="flag warn">${c.pendRecv} للاستلام</span>`:""}${c.pendEnt?` <span class="flag info">${c.pendEnt} للإدخال</span>`:""}</td>
     <td>${spill(o.status)}${sLate(o,c)?` <span class="flag bad">متأخرة</span>`:""}</td><td class="num sub">${o.expected?fmtDay(o.expected):"—"}</td></tr>`}).join("")||`<tr><td colspan="11" class="empty">ما فيه نتائج</td></tr>`}
   </tbody></table></div></div>`;
}

/* ---------- new order ---------- */
function sBlank(){ return {ref:"",supplier:"",currency:"USD",rate:3.75,freight:25,expected:"",note:"",items:[],file:"",paste:""} }
function renderSupNew(m){
  sdraft=sdraft||sBlank(); const d=sdraft, sups=[...new Set(sorders.map(o=>o.supplier).filter(Boolean))];
  m.innerHTML=`<div class="panel sec" style="margin-top:14px"><div class="row"><h2>طلبية مورد جديدة</h2><span class="spacer"></span><button class="ghost" data-sa="cancelNew">رجوع</button></div>
   <div class="grid2">
     <label class="f" for="sRef">رقم أو اسم الطلبية *<input id="sRef" type="text" value="${esc(d.ref)}" placeholder="مثال: PO-2026-11 دبي"></label>
     <label class="f" for="sSup">المورد *<input id="sSup" type="text" list="sSups" value="${esc(d.supplier)}"><datalist id="sSups">${sups.map(s=>`<option value="${esc(s)}">`).join("")}</datalist></label>
     <label class="f" for="sExp">تاريخ الوصول المتوقع<input id="sExp" type="date" value="${esc(d.expected)}"></label>
     <label class="f" for="sCurr">العملة<select id="sCurr">${Object.keys(CUR).map(k=>`<option value="${k}" ${d.currency===k?"selected":""}>${CUR[k].t} (${k})</option>`).join("")}</select></label>
     <label class="f" for="sRate">سعر الصرف للريال<input id="sRate" type="number" step="0.0001" min="0" value="${d.rate}"></label>
     <label class="f" for="sFr">نسبة الشحن والمصاريف %<input id="sFr" type="number" step="0.5" min="0" value="${d.freight}"></label>
   </div>
   <label class="f" for="sNote">ملاحظة<input id="sNote" type="text" value="${esc(d.note)}" placeholder="اختياري"></label>
   <div class="dropzone" id="sDz">اسحب ملف الطلبية هنا (Excel أو PDF) أو <label style="color:var(--accent);cursor:pointer;text-decoration:underline">اختر ملف<input id="sFile" type="file" accept=".xlsx,.xls,.csv,.pdf" hidden></label>
     <div class="hint" style="margin-top:4px">يقرأ رقم القطعة والاسم والكمية والسعر${d.file?` · الملف الحالي: ${esc(d.file)}`:""}</div></div>
   <label class="f" for="sPaste">أو الصق من Excel: رقم القطعة ⇥ الاسم ⇥ الكمية ⇥ السعر<textarea id="sPaste" placeholder="11044-7S002&#9;وجه راس&#9;50&#9;14.5">${esc(d.paste)}</textarea></label>
   <div class="row"><button data-sa="addPaste">أضف الملصوق</button>${d.items.length?`<button class="ghost" data-sa="clearItems">تفريغ الأصناف</button>`:""}</div>
   ${sDraftTable(d)}
   <div class="row"><span class="sub">تنحفظ «بانتظار التأكيد». الأسعار تتثبت لما تضغط تأكيد الطلبية.</span><span class="spacer"></span><button class="primary" data-sa="saveNew" id="sSaveNew" ${!d.ref.trim()||!d.supplier.trim()||!d.items.length?"disabled":""}>حفظ الطلبية</button></div></div>`;
}
function sDraftTable(d){
  if(!d.items.length) return `<p class="hint">ما أضفت أصناف بعد.</p>`;
  const cnt={}; d.items.forEach(i=>{const k=keyPN(i.pn); cnt[k]=(cnt[k]||0)+1}); const dup=Object.values(cnt).filter(n=>n>1).length, nop=d.items.filter(i=>i.price==null).length;
  const tot=d.items.reduce((a,i)=>a+N(i.qty)*N(i.price),0), qty=d.items.reduce((a,i)=>a+N(i.qty),0), t=CUR[d.currency].t;
  return `<div class="skpi"><div class="k"><span>الأصناف</span><b>${d.items.length}</b><small>${qty} حبة</small></div>
     <div class="k"><span>قيمة الطلبية</span><b>${money(tot)}</b><small>${t}</small></div>
     <div class="k"><span>واصلة بالريال</span><b>${money(tot*N(d.rate)*(1+N(d.freight)/100))}</b><small>صرف ${d.rate} + شحن ${d.freight}%</small></div></div>
   ${dup?`<div class="banner">${dup} رقم مكرر بالملف — كل سطر ينحفظ لحاله (تنبيه بس).</div>`:""}${nop?`<div class="banner">${nop} صنف بدون سعر — تقدر تحدّثها برد المورد قبل التأكيد.</div>`:""}
   <div class="tbl-wrap panel"><table><thead><tr><th>#</th><th>رقم القطعة</th><th>الاسم</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
   ${d.items.slice(0,60).map((i,x)=>`<tr><td class="num">${x+1}</td><td class="pn">${esc(i.pn)}${cnt[keyPN(i.pn)]>1?` <span class="flag warn">مكرر</span>`:""}</td><td class="wrapcell">${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${i.price!=null?money(i.price):"—"}</td><td class="num">${i.price!=null?money(i.qty*i.price):"—"}</td></tr>`).join("")}
   ${d.items.length>60?`<tr><td colspan="6" class="sub">… و ${d.items.length-60} صنف ثاني</td></tr>`:""}</tbody></table></div>`;
}
async function sSaveNew(btn){
  const d=sdraft; if(!d||!d.ref.trim()||!d.supplier.trim()||!d.items.length) return;
  if(sorders.some(o=>(o.ref||"").trim()===d.ref.trim()&&o.supplier===d.supplier.trim())&&!armConfirm(btn,"نفس الاسم موجود — اضغط مرة ثانية للحفظ")) return;
  const now=new Date().toISOString(), id="s-"+Date.now().toString(36);
  const body={type:"supplier",ref:d.ref.trim(),supplier:d.supplier.trim(),currency:d.currency,rate:N(d.rate)||1,freight:N(d.freight),expected:d.expected||"",note:d.note.trim(),file:d.file||"",
    status:"draft",items:sClean(d.items),shipments:[],createdAt:now,updatedAt:now,createdBy:myId,history:[{at:now,by:myId,role,note:`إنشاء الطلبية · ${d.items.length} صنف`}]};
  if(JSON.stringify(body).length>950000){toast("الطلبية كبيرة جداً — قسّمها على طلبيتين");return}
  btn.disabled=true;
  try{ await db.collection("orders").doc(id).set(body); sdraft=null; supNew=false; supOpen=id; supMode=null; supTabIn="items"; toast("انحفظت الطلبية"); render() }
  catch(e){ btn.disabled=false; toast(e&&/permission/.test(e.code||"")?"إضافة الطلبيات للمدير فقط":"تعذّر الحفظ: "+(e&&e.message||"")) }
}

/* ---------- drawer ---------- */
function renderSupDrawer(){
  const root=$("#supRoot"); if(!root) return; const o=sorders.find(x=>x.id===supOpen);
  if(!o||tab!=="sup"){ root.innerHTML=""; return }
  const old=root.querySelector(".drawer"), sc=old?old.scrollTop:0, c=supCalc(o), cur=sCur(o), locked=o.status!=="draft";
  const canShip=canWrite&&(sIsO()||role==="entry")&&["confirmed","done"].includes(o.status);
  let body;
  if(supMode==="ship"&&sship&&sship.oid===o.id) body=sShipPanel(o,c);
  else if(supMode==="reply"&&sreply&&sreply.oid===o.id) body=sReplyPanel(o);
  else if(supMode==="recv"&&srecv&&srecv.oid===o.id) body=sRecvPanel(o);
  else body=`
    <div class="panel sec"><div class="row" style="gap:6px 18px">
      <span class="sub">العملة: <b>${cur}</b> · صرف <b class="num">${o.rate}</b> · شحن <b class="num">${o.freight}%</b></span>
      <span class="sub">أُنشئت: <span class="num">${fmtDay(o.createdAt)}</span></span><span class="sub">الوصول المتوقع: <b class="num">${o.expected?fmtDay(o.expected):"—"}</b></span>
      ${o.lockedAt?`<span class="sub">ثُبّتت الأسعار: <span class="num">${fmtD(o.lockedAt)}</span> · ${esc(userLabel(o.lockedBy))}</span>`:""}${o.note?`<span class="sub">ملاحظة: ${esc(o.note)}</span>`:""}</div>
      <div class="row">${sActions(o,c,canShip)}</div></div>
    <div class="itabs">${[["items",`الأصناف (${(o.items||[]).length})`],["ships",`الدفعات (${(o.shipments||[]).length})`],["diff",`فروقات الأسعار (${c.diffLines.length})`],["claims",`نواقص ومطالبات (${c.short.length+c.extras.length+c.over})`],["log","السجل"]]
      .map(([k,t])=>`<button class="itab ${supTabIn===k?"on":""}" data-sa="itab" data-v="${k}">${t}</button>`).join("")}</div>
    ${supTabIn==="items"?sItemsTab(o,c,locked):supTabIn==="ships"?sShipsTab(o,c):supTabIn==="diff"?sDiffTab(o,c):supTabIn==="claims"?sClaimsTab(o,c):sLogTab(o)}`;
  root.innerHTML=`<div class="scrim" data-sa="close"></div><aside class="drawer sdrawer" role="dialog" aria-label="طلبية المورد">
    <div class="dh"><button class="ghost" data-sa="close" aria-label="إغلاق">✕</button><div><div class="sub">${esc(o.supplier||"")}</div><b style="font-size:18px">${esc(o.ref||"")}</b></div>${spill(o.status)}${sLate(o,c)?`<span class="flag bad">متأخرة</span>`:""}
      <span class="spacer"></span><button data-sa="export">تصدير Excel</button></div>
    <div class="db">
     <div class="skpi">
      <div class="k"><span>قيمة الطلبية</span><b>${money(c.ordV)}</b><small>${cur} · ${money(sSar(o,c.ordV))} ريال واصل</small></div>
      <div class="k"><span>انشحن</span><b>${Math.round(c.pct*100)}%</b><small>${money(c.shV)} ${cur} · ${(o.shipments||[]).length} دفعة</small></div>
      <div class="k ${c.remN?"warn":"ok"}"><span>الباقي ما وصل</span><b>${money(c.remV)}</b><small>${cur} · ${c.remN} صنف · ${c.remQ} حبة</small></div>
      <div class="k ${c.diff>0.005?"bad":c.diff<-0.005?"ok":""}"><span>فرق السعر عن المثبت</span><b>${c.diff>0?"+":""}${money(c.diff)}</b><small>${cur} · ${c.diffLines.length} سطر${c.diff>0.005?" · المورد زوّد":""}</small></div>
     </div>
     ${body}
    </div></aside>`;
  const nw=root.querySelector(".drawer"); if(nw) nw.scrollTop=sc;
}
function sActions(o,c,canShip){
  const b=[];
  if(!canWrite) return `<span class="sub">صلاحية عرض فقط</span>`;
  if(o.status==="draft"&&sIsO()) b.push(`<button class="primary" data-sa="confirm">تأكيد الطلبية وتثبيت الأسعار</button>`,
    `<label class="mini" style="cursor:pointer;border:1px solid var(--line);border-radius:6px;padding:7px 14px;font-weight:500">رفع رد المورد (تحديث الأسعار والكميات)<input id="sReplyFile" type="file" accept=".xlsx,.xls,.csv,.pdf" hidden></label>`);
  if(canShip) b.push(`<button class="primary" data-sa="shipStart">+ دفعة واصلة</button>`);
  if(o.status==="confirmed"&&sIsO()&&c.remN) b.push(`<button data-sa="closeRest">قفل الطلبية (الباقي ما راح يجي)</button>`);
  if(["closed","done"].includes(o.status)&&sIsO()&&c.cutN) b.push(`<button data-sa="reopen">إعادة فتح الباقي</button>`);
  if(sIsO()&&["draft","confirmed"].includes(o.status)) b.push(`<span class="spacer"></span><button class="danger" data-sa="cancel">إلغاء الطلبية</button>`);
  if(sIsO()&&o.status==="cancelled") b.push(`<button data-sa="uncancel">إرجاعها</button>`);
  if(o.status==="draft"&&!sIsO()) b.push(`<span class="sub">بانتظار تأكيد المدير وتثبيت الأسعار.</span>`);
  return b.join("")||`<span class="sub">ما فيه إجراء لك الآن.</span>`;
}
function sItemRows(o,c,locked){
  const k=keyPN(supQ), t=supQ.trim();
  let rows=(o.items||[]).map((it,i)=>({it,i,rem:Math.max(N(it.qty)-c.sh[i]-N(it.cut),0)}));
  if(supFilter==="rem") rows=rows.filter(r=>r.rem>0); else if(supFilter==="done") rows=rows.filter(r=>r.rem===0&&!N(r.it.cut));
  else if(supFilter==="over") rows=rows.filter(r=>c.sh[r.i]>N(r.it.qty)); else if(supFilter==="cut") rows=rows.filter(r=>N(r.it.cut)>0); else if(supFilter==="nop") rows=rows.filter(r=>r.it.price==null);
  if(t) rows=rows.filter(r=>(k&&keyPN(r.it.pn).includes(k))||(r.it.name||"").includes(t));
  const total=rows.length; rows=rows.slice(0,supLimit);
  const canEdit=canWrite&&sIsO()&&o.status!=="cancelled";
  return {total,html:rows.map(({it,i,rem})=>{ const ed=supEditRow===i&&canEdit;
    return `<tr><td class="num sub">${i+1}</td><td class="pn">${esc(it.pn)}</td><td class="wrapcell">${esc(it.name||"")}${N(it.cut)>0?` <span class="flag bad">ملغي ${N(it.cut)}</span>`:""}</td>
     <td>${ed&&!locked?`<input type="number" min="0" id="sEq" value="${N(it.qty)}">`:`<span class="num">${N(it.qty)}</span>`}</td>
     <td>${ed?`<input type="number" min="0" step="0.0001" id="sEp" value="${it.price??""}">`:`<span class="num">${it.price!=null?money(it.price):"—"}</span>`}</td>
     <td class="num">${c.sh[i]||"—"}${c.sh[i]>N(it.qty)?` <span class="flag warn">زيادة ${c.sh[i]-N(it.qty)}</span>`:""}</td><td class="num">${c.rc[i]||"—"}${c.dm[i]?` <span class="flag bad">تالف ${c.dm[i]}</span>`:""}</td>
     <td class="num">${rem||`<span class="flag ok">تم</span>`}</td><td class="num">${rem&&it.price!=null?money(rem*N(it.price)):"—"}</td>
     <td>${ed?`<button class="primary mini" data-sa="rowSave" data-i="${i}">حفظ</button><button class="ghost mini" data-sa="rowCancel">إلغاء</button>`:canEdit?`<button class="ghost mini" data-sa="rowEdit" data-i="${i}">${locked?"تعديل السعر":"تعديل"}</button>`:""}</td></tr>`}).join("")};
}
function sItemsTab(o,c,locked){
  const r=sItemRows(o,c,locked);
  return `<div class="panel"><div class="toolbar"><select id="sFlt" aria-label="تصفية الأصناف">
     ${[["all","كل الأصناف"],["rem","الباقي ما وصل"],["done","اللي اكتمل"],["over","زيادة عن الطلب"],["cut","الملغي"],["nop","بدون سعر"]].map(([k,t])=>`<option value="${k}" ${supFilter===k?"selected":""}>${t}</option>`).join("")}</select>
     <input type="text" id="sQ" placeholder="بحث برقم القطعة أو الاسم" value="${esc(supQ)}" style="max-width:240px" class="num"><span class="sub" id="sCount">${r.total} صنف</span>
     ${locked?`<span class="spacer"></span><span class="flag info">الأسعار مثبتة</span>`:""}</div>
   <div class="tbl-wrap"><table><thead><tr><th>#</th><th>رقم القطعة</th><th>الاسم</th><th>مطلوب</th><th>السعر ${locked?"المثبت":""}</th><th>انشحن</th><th>استلم المستودع</th><th>الباقي</th><th>قيمة الباقي</th><th></th></tr></thead>
   <tbody id="sItemsBody">${r.html}</tbody></table></div>
   ${r.total>supLimit?`<div class="toolbar"><button data-sa="more">عرض المزيد (${r.total-supLimit} باقي)</button></div>`:""}</div>`;
}
function sShipsTab(o,c){
  const sh=o.shipments||[]; if(!sh.length) return `<div class="panel empty"><h3>ما وصلت دفعات بعد</h3><p class="hint">لما توصل دفعة، ارفع فاتورتها أو قائمة التعبئة. البرنامج يخصمها من الطلبية ويقارن أسعارها بالمثبت.</p></div>`;
  return `<div class="panel sec">${sh.map((s,si)=>{ const q=(s.lines||[]).reduce((a,l)=>a+N(l.q),0), v=(s.lines||[]).reduce((a,l)=>a+N(l.q)*(l.p!=null?N(l.p):N((o.items[l.i]||{}).price)),0)+(s.extras||[]).reduce((a,x)=>a+N(x.q)*N(x.p),0);
     const dl=c.diffLines.filter(d=>d.si===si), dv=dl.reduce((a,d)=>a+d.d,0), shr=c.short.filter(x=>x.si===si).length;
     return `<div class="batch"><div class="row"><b>دفعة ${si+1}</b>${s.no?`<span class="sub">فاتورة <span class="num">${esc(s.no)}</span></span>`:""}<span class="sub num">${s.date?fmtDay(s.date):fmtDay(s.at)}</span><span class="sub">${esc(userLabel(s.by))}</span><span class="spacer"></span>
        ${s.enteredAt?`<span class="flag ok">دخلت النظام${s.sysInv?` · ${esc(s.sysInv)}`:""}</span>`:s.receivedAt?`<span class="flag info">استلمها المستودع</span>`:`<span class="flag warn">بانتظار استلام المستودع</span>`}</div>
      <div class="row" style="gap:6px 16px"><span class="sub">${(s.lines||[]).length} صنف · ${q} حبة</span><span class="sub">القيمة: <b class="num">${money(v)}</b> ${sCur(o)}</span>
        ${dl.length?`<span class="sub">فرق السعر: ${sDiffTxt(dv,o)} (${dl.length} سطر)</span>`:`<span class="flag ok">الأسعار مطابقة</span>`}
        ${(s.extras||[]).length?`<span class="flag warn">${s.extras.length} خارج الطلبية</span>`:""}${shr?`<span class="flag bad">${shr} نقص/تالف</span>`:""}${s.file?`<span class="sub">${esc(s.file)}</span>`:""}</div>
      <div class="row">${!s.receivedAt&&canWrite&&(role==="store"||sIsO())?`<button class="primary mini" data-sa="recvAll" data-si="${si}">وصلت كاملة وسليمة</button><button class="mini" data-sa="recvStart" data-si="${si}">استلام مع فروقات</button>`:""}
        ${s.receivedAt&&canWrite&&(role==="store"||sIsO())&&!s.enteredAt?`<button class="ghost mini" data-sa="recvStart" data-si="${si}">تعديل الاستلام</button>`:""}
        ${s.receivedAt&&!s.enteredAt&&canWrite&&(role==="entry"||sIsO())?`<input type="text" id="sInv-${si}" placeholder="رقم فاتورة الشراء بالنظام" style="max-width:220px"><button class="primary mini" data-sa="entered" data-si="${si}">دخلت النظام</button>`:""}
        ${s.receivedAt?`<span class="sub">استلمها ${esc(userLabel(s.receivedBy))} <span class="num">${fmtD(s.receivedAt)}</span></span>`:""}
        <span class="spacer"></span>${sIsO()&&canWrite?`<button class="ghost mini" data-sa="shipDel" data-si="${si}" style="color:var(--bad)">حذف الدفعة</button>`:""}</div></div>`}).join("")}</div>`;
}
function sDiffTab(o,c){
  if(!c.diffLines.length) return `<div class="panel empty"><h3>ما فيه فروقات أسعار</h3><p class="hint">كل الدفعات جت بنفس السعر المثبت بالطلبية.</p></div>`;
  const up=c.diffLines.filter(d=>d.d>0).reduce((a,d)=>a+d.d,0), dn=c.diffLines.filter(d=>d.d<0).reduce((a,d)=>a+d.d,0);
  return `<div class="panel"><div class="toolbar"><span class="flag bad">زيادة علينا: ${money(up)} ${sCur(o)}</span><span class="flag ok">أقل من المثبت: ${money(Math.abs(dn))} ${sCur(o)}</span><span class="sub">الصافي: ${sDiffTxt(c.diff,o)}</span></div>
   <div class="tbl-wrap"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>الدفعة</th><th>الكمية</th><th>السعر المثبت</th><th>سعر الفاتورة</th><th>الفرق للحبة</th><th>إجمالي الفرق</th></tr></thead><tbody>
   ${c.diffLines.slice().sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,500).map(d=>`<tr><td class="pn">${esc(d.it.pn)}</td><td class="wrapcell">${esc(d.it.name||"")}</td><td class="sub">دفعة ${d.si+1}${d.s.no?` · ${esc(d.s.no)}`:""}</td><td class="num">${N(d.l.q)}</td>
     <td class="num">${money(d.it.price)}</td><td class="num">${money(d.l.p)}</td><td>${sDiffTxt(N(d.l.p)-N(d.it.price),o)} <span class="sub num">(${((N(d.l.p)-N(d.it.price))/N(d.it.price)*100).toFixed(1)}%)</span></td><td>${sDiffTxt(d.d,o)}</td></tr>`).join("")}
   </tbody></table></div></div>`;
}
function sClaimsTab(o,c){
  const over=(o.items||[]).map((it,i)=>({it,i})).filter(x=>c.sh[x.i]>N(x.it.qty));
  if(!c.short.length&&!c.extras.length&&!over.length) return `<div class="panel empty"><h3>ما فيه نواقص ولا مطالبات</h3><p class="hint">هنا يطلع اللي انفوتر وما وصل، والتالف، واللي جاء زيادة أو خارج الطلبية.</p></div>`;
  const sv=c.short.reduce((a,x)=>a+(N(x.l.q)-x.r)*(x.l.p!=null?N(x.l.p):N(x.it.price)),0);
  return `<div class="panel sec">
   ${c.short.length?`<h2>مفوتر وما وصل أو وصل تالف <span class="flag bad">${money(sv)} ${sCur(o)}</span></h2><div class="tbl-wrap"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>الدفعة</th><th>مفوتر</th><th>وصل سليم</th><th>ناقص</th><th>تالف</th><th>قيمة المطالبة</th></tr></thead><tbody>
     ${c.short.map(x=>{const p=x.l.p!=null?N(x.l.p):N(x.it.price); return `<tr><td class="pn">${esc(x.it.pn)}</td><td class="wrapcell">${esc(x.it.name||"")}</td><td class="sub">دفعة ${x.si+1}${x.s.no?` · ${esc(x.s.no)}`:""}</td><td class="num">${N(x.l.q)}</td><td class="num">${x.r-0}</td><td class="num">${Math.max(N(x.l.q)-x.r-N(x.l.d),0)||"—"}</td><td class="num">${N(x.l.d)||"—"}</td><td class="num">${money((N(x.l.q)-x.r)*p)}</td></tr>`}).join("")}</tbody></table></div>`:""}
   ${over.length?`<h2>انشحن أكثر من المطلوب</h2><div class="tbl-wrap"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>مطلوب</th><th>انشحن</th><th>الزيادة</th></tr></thead><tbody>
     ${over.map(x=>`<tr><td class="pn">${esc(x.it.pn)}</td><td class="wrapcell">${esc(x.it.name||"")}</td><td class="num">${N(x.it.qty)}</td><td class="num">${c.sh[x.i]}</td><td class="num">${c.sh[x.i]-N(x.it.qty)}</td></tr>`).join("")}</tbody></table></div>`:""}
   ${c.extras.length?`<h2>أصناف جت وما هي بالطلبية</h2><div class="tbl-wrap"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>الدفعة</th><th>الكمية</th><th>السعر</th></tr></thead><tbody>
     ${c.extras.map(e=>`<tr><td class="pn">${esc(e.x.pn)}</td><td class="wrapcell">${esc(e.x.name||"")}</td><td class="sub">دفعة ${e.si+1}</td><td class="num">${N(e.x.q)}</td><td class="num">${e.x.p!=null?money(e.x.p):"—"}</td></tr>`).join("")}</tbody></table></div>`:""}</div>`;
}
function sLogTab(o){ return `<div class="panel sec"><ul class="log">${(o.history||[]).slice().reverse().map(h=>`<li><time>${fmtD(h.at)}</time><span class="sub">${esc(userLabel(h.by))}</span><span>${esc(h.note||"")}</span></li>`).join("")}</ul></div>` }

/* ---------- shipment panel ---------- */
function sShipPanel(o,c){
  const p=sship, has=p.rows&&p.rows.length;
  let rev="";
  if(has){ const R=p.rows, inO=R.filter(r=>r.i>=0), ex=R.filter(r=>r.i<0), pd=R.filter(r=>r.pd), ov=R.filter(r=>r.over>0), nr=R.filter(r=>r.near);
    const val=R.reduce((a,r)=>a+N(r.q.qty)*N(r.q.price!=null?r.q.price:(r.i>=0?o.items[r.i].price:0)),0), dv=pd.reduce((a,r)=>a+r.d,0), nop=R.filter(r=>r.q.price==null).length;
    const prob=[...pd,...ov.filter(r=>!r.pd),...ex,...nr.filter(r=>!r.pd&&!r.over)];
    rev=`<div class="row"><span class="flag ok">${inO.length} بالطلبية</span>${pd.length?`<span class="flag bad">${pd.length} سعرها غير المثبت</span>`:`<span class="flag ok">الأسعار مطابقة للمثبت</span>`}${ov.length?`<span class="flag warn">${ov.length} أكثر من الباقي</span>`:""}${ex.length?`<span class="flag warn">${ex.length} مو بالطلبية</span>`:""}${nop?`<span class="flag info">${nop} بدون سعر بالملف</span>`:""}</div>
     <div class="skpi"><div class="k"><span>قيمة الدفعة</span><b>${money(val)}</b><small>${sCur(o)} · ${R.reduce((a,r)=>a+N(r.q.qty),0)} حبة</small></div>
       <div class="k ${dv>0.005?"bad":dv<-0.005?"ok":""}"><span>فرق السعر عن المثبت</span><b>${dv>0?"+":""}${money(dv)}</b><small>${sCur(o)}${dv>0.005?" · المورد زوّد":""}</small></div>
       <div class="k"><span>الباقي بعد هذي الدفعة</span><b>${money(Math.max(c.remV-inO.reduce((a,r)=>a+Math.min(N(r.q.qty),N(r.q.qty)-r.over)*N(o.items[r.i].price),0),0))}</b><small>${sCur(o)}</small></div></div>
     ${prob.length?`<div class="tbl-wrap panel"><table><thead><tr><th>رقم القطعة</th><th>الكمية</th><th>السعر المثبت</th><th>سعر الفاتورة</th><th>الفرق</th><th>ملاحظة</th></tr></thead><tbody>
       ${prob.slice(0,300).map(r=>{const it=r.i>=0?o.items[r.i]:null; return `<tr><td class="pn">${esc(r.q.pn)}</td><td class="num">${N(r.q.qty)}</td><td class="num">${it&&it.price!=null?money(it.price):"—"}</td><td class="num">${r.q.price!=null?money(r.q.price):"—"}</td><td>${r.pd?sDiffTxt(r.d,o):"—"}</td>
         <td>${r.i<0?`<span class="flag warn">مو بالطلبية</span>`:""}${r.over?`<span class="flag warn">زيادة ${r.over} عن الباقي</span>`:""}${r.near?` <span class="flag info">طابق ${esc(it.pn)}</span>`:""}</td></tr>`}).join("")}</tbody></table></div>`:`<p class="hint">ما فيه ملاحظات — كل الأصناف بالطلبية وبنفس السعر المثبت.</p>`}`;
  }
  return `<div class="panel sec"><h2>دفعة واصلة جديدة</h2>
    <div class="grid2"><label class="f" for="shNo">رقم فاتورة المورد<input id="shNo" type="text" value="${esc(p.no||"")}" class="num"></label>
      <label class="f" for="shDate">تاريخ الدفعة<input id="shDate" type="date" value="${esc(p.date||today())}"></label><span></span></div>
    <div class="dropzone">ارفع فاتورة الدفعة أو قائمة التعبئة (Excel أو PDF) <label style="color:var(--accent);cursor:pointer;text-decoration:underline">اختر ملف<input id="shFile" type="file" accept=".xlsx,.xls,.csv,.pdf" hidden></label>${p.file?`<div class="hint">الملف: ${esc(p.file)}</div>`:""}</div>
    <label class="f" for="shPaste">أو الصق: رقم القطعة ⇥ الكمية ⇥ السعر<textarea id="shPaste" style="min-height:70px">${esc(p.paste||"")}</textarea></label>
    <div class="row"><button data-sa="shipPaste">اقرأ الملصوق</button></div>
    ${rev}
    <div class="row"><button class="primary" data-sa="shipSave" ${has?"":"disabled"}>حفظ الدفعة وخصمها من الطلبية</button><button class="ghost" data-sa="modeOff">إلغاء</button></div></div>`;
}
function sReplyPanel(o){
  const p=sreply, R=p.m.rows, pc=R.filter(r=>r.i>=0&&r.pc), qc=R.filter(r=>r.i>=0&&r.qc), nw=R.filter(r=>r.i<0), ms=p.m.missing;
  const li=(a,f)=>`<div class="sub" style="line-height:1.9">${a.slice(0,80).map(f).join(" · ")}${a.length>80?` … +${a.length-80}`:""}</div>`;
  return `<div class="panel sec"><h2>رد المورد: ${esc(p.file)}</h2>
    <div class="row"><span class="flag ok">${R.filter(r=>r.i>=0).length} مطابق</span><span class="flag info">${pc.length} سعر يتحدّث</span>${qc.length?`<span class="flag warn">${qc.length} كمية تغيّرت</span>`:""}${ms.length?`<span class="flag bad">${ms.length} ما جت بالرد</span>`:""}${nw.length?`<span class="flag info">${nw.length} جديد</span>`:""}</div>
    ${qc.length?`<b style="font-size:13px">كميات عدّلها المورد</b>${li(qc,r=>`<span class="pn">${esc(o.items[r.i].pn)}</span> ${N(o.items[r.i].qty)}→${N(r.q.qty)}`)}`:""}
    ${ms.length?`<b style="font-size:13px">بالطلبية وما جت برد المورد</b>${li(ms,i=>`<span class="pn">${esc(o.items[i].pn)}</span>`)}<label class="row" style="font-size:13px"><input type="checkbox" id="rpDrop"> احذفها من الطلبية</label>`:""}
    ${nw.length?`<b style="font-size:13px">برد المورد وما هي بالطلبية</b>${li(nw,r=>`<span class="pn">${esc(r.q.pn)}</span> × ${N(r.q.qty)}`)}<label class="row" style="font-size:13px"><input type="checkbox" id="rpAdd"> أضفها للطلبية</label>`:""}
    <label class="row" style="font-size:13px"><input type="checkbox" id="rpQty" checked> حدّث الكميات حسب رد المورد</label>
    <div class="row"><button class="primary" data-sa="replyApply">تطبيق على الطلبية</button><button class="ghost" data-sa="modeOff">إلغاء</button></div></div>`;
}
function sRecvPanel(o){
  const s=o.shipments[srecv.si]; if(!s) return "";
  return `<div class="panel sec"><h2>استلام دفعة ${srecv.si+1}${s.no?` · فاتورة ${esc(s.no)}`:""}</h2>
    <p class="hint">الكمية السليمة معبّاة بكمية الفاتورة. عدّل بس الأصناف اللي فيها نقص أو تالف.</p>
    <div class="tbl-wrap panel"><table><thead><tr><th>رقم القطعة</th><th>الاسم</th><th>بالفاتورة</th><th>وصل سليم</th><th>تالف</th></tr></thead><tbody>
    ${(s.lines||[]).map((l,k)=>{const it=o.items[l.i]||{}; return `<tr><td class="pn">${esc(it.pn||"")}</td><td class="wrapcell">${esc(it.name||"")}</td><td class="num">${N(l.q)}</td>
      <td><input type="number" min="0" id="sr-${k}" data-sr="${k}" value="${l.r!=null?N(l.r):N(l.q)}"></td><td><input type="number" min="0" id="sd-${k}" data-sd="${k}" value="${N(l.d)||""}" placeholder="0"></td></tr>`}).join("")}
    </tbody></table></div>
    <div class="row"><button class="primary" data-sa="recvSave">حفظ الاستلام</button><button class="ghost" data-sa="modeOff">إلغاء</button></div></div>`;
}

/* ---------- export ---------- */
function sExport(o){
  if(typeof XLSX==="undefined"){toast("مكتبة Excel غير محمّلة");return}
  const c=supCalc(o), wb=XLSX.utils.book_new(); wb.Workbook={Views:[{RTL:true}]};
  const add=(name,rows)=>{const ws=XLSX.utils.aoa_to_sheet(rows); ws["!cols"]=rows[0].map(()=>({wch:16})); XLSX.utils.book_append_sheet(wb,ws,name)};
  const H=["رقم القطعة","الاسم","مطلوب","السعر المثبت","انشحن","استلم المستودع","ملغي","الباقي","قيمة الباقي","واصل بالريال للحبة"];
  const all=(o.items||[]).map((it,i)=>{const rem=Math.max(N(it.qty)-c.sh[i]-N(it.cut),0); return [it.pn,it.name||"",N(it.qty),it.price??"",c.sh[i],c.rc[i],N(it.cut)||"",rem,it.price!=null?rem*N(it.price):"",it.price!=null?Math.round(sSar(o,N(it.price))*100)/100:""]});
  add("الطلبية",[H,...all]); add("الباقي",[H,...all.filter(r=>r[7]>0)]);
  add("فروقات الأسعار",[["رقم القطعة","الاسم","الدفعة","فاتورة المورد","الكمية","السعر المثبت","سعر الفاتورة","الفرق للحبة","إجمالي الفرق"],...c.diffLines.map(d=>[d.it.pn,d.it.name||"",d.si+1,d.s.no||"",N(d.l.q),N(d.it.price),N(d.l.p),Math.round((N(d.l.p)-N(d.it.price))*10000)/10000,Math.round(d.d*100)/100])]);
  add("المطالبات",[["النوع","رقم القطعة","الاسم","الدفعة","فاتورة المورد","مفوتر","وصل سليم","تالف","السعر","القيمة"],
    ...c.short.map(x=>{const p=x.l.p!=null?N(x.l.p):N(x.it.price); return ["نقص/تالف",x.it.pn,x.it.name||"",x.si+1,x.s.no||"",N(x.l.q),x.r,N(x.l.d)||"",p,(N(x.l.q)-x.r)*p]}),
    ...c.extras.map(e=>["خارج الطلبية",e.x.pn,e.x.name||"",e.si+1,e.s.no||"",N(e.x.q),"","",e.x.p??"",e.x.p!=null?N(e.x.q)*N(e.x.p):""])]);
  add("الدفعات",[["الدفعة","فاتورة المورد","التاريخ","رقم القطعة","الكمية","السعر","وصل سليم","تالف","فاتورة النظام"],...(o.shipments||[]).flatMap((s,si)=>(s.lines||[]).map(l=>[si+1,s.no||"",s.date||"",(o.items[l.i]||{}).pn||"",N(l.q),l.p??"",s.receivedAt?(l.r!=null?N(l.r):N(l.q)):"",N(l.d)||"",s.sysInv||""]))]);
  saveBlob(new Blob([XLSX.write(wb,{type:"array",bookType:"xlsx"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`طلبية-${(o.ref||"").replace(/[\\/:*?"<>|]/g,"-")}-${today()}.xlsx`);
}

/* ---------- events ---------- */
async function sReadInto(f,cb){ try{ const r=await readAgency(f); cb(sClean(r.list),r.meta||{}) }catch(e){ toast(e&&e.message||"تعذّر قراءة الملف") } }
document.addEventListener("click",async ev=>{
  const t=ev.target.closest("[data-sa]"); if(!t) return; const a=t.dataset.sa, o=sorders.find(x=>x.id===supOpen);
  switch(a){
    case "new": supNew=true; sdraft=sdraft||sBlank(); return render();
    case "cancelNew": supNew=false; return render();
    case "clearItems": sdraft.items=[]; sdraft.file=""; return render();
    case "addPaste": { const list=sClean(parseRows(sRowsFromPaste($("#sPaste").value))); if(!list.length){toast("ما لقيت أرقام قطع");return} sdraft.items.push(...list); sdraft.paste=""; toast(`أُضيف ${list.length} صنف`); return render() }
    case "saveNew": return sSaveNew(t);
    case "open": supOpen=t.dataset.sid; supMode=null; supTabIn="items"; supFilter="all"; supQ=""; supLimit=200; supEditRow=-1; return renderSupDrawer();
    case "close": supOpen=null; supMode=null; return renderSupDrawer();
    case "itab": supTabIn=t.dataset.v; supEditRow=-1; return renderSupDrawer();
    case "more": supLimit+=400; return renderSupDrawer();
    case "modeOff": supMode=null; sship=sreply=srecv=null; return renderSupDrawer();
    case "export": return o&&sExport(o);
  }
  if(!o) return;
  switch(a){
    case "confirm": { const nop=o.items.filter(i=>i.price==null).length;
      if(!armConfirm(t,nop?`فيه ${nop} صنف بدون سعر — اضغط للتأكيد`:"اضغط مرة ثانية لتثبيت الأسعار")) return;
      if(await supWrite(o,{status:"confirmed",lockedAt:new Date().toISOString(),lockedBy:myId},`تأكيد الطلبية وتثبيت الأسعار · ${o.items.length} صنف · ${money(supCalc(o).ordV)} ${sCur(o)}`)) toast("تأكدت الطلبية وتثبتت الأسعار"); return }
    case "cancel": if(armConfirm(t,"اضغط مرة ثانية للإلغاء")&&await supWrite(o,{status:"cancelled",prevStatus:o.status},"إلغاء الطلبية")) toast("انلغت"); return;
    case "uncancel": if(await supWrite(o,{status:o.prevStatus||"draft"},"إرجاع الطلبية")) toast("رجعت"); return;
    case "closeRest": { if(!armConfirm(t,"تأكيد: الباقي ما راح يجي")) return; const c=supCalc(o); const items=o.items.map((it,i)=>({...it,cut:Math.max(N(it.qty)-c.sh[i],0)}));
      if(await supWrite(o,{items,status:"closed"},`قفل الطلبية · الباقي الملغي ${c.remN} صنف بقيمة ${money(c.remV)} ${sCur(o)}`)) toast("انقفلت الطلبية"); return }
    case "reopen": { const items=o.items.map(it=>({...it,cut:0})); if(await supWrite(o,{items,status:"confirmed"},"إعادة فتح الباقي")) toast("انفتح الباقي من جديد"); return }
    case "rowEdit": supEditRow=+t.dataset.i; return renderSupDrawer();
    case "rowCancel": supEditRow=-1; return renderSupDrawer();
    case "rowSave": { const i=+t.dataset.i, items=o.items.map(x=>({...x})), it=items[i], op=it.price, oq=it.qty;
      const pv=$("#sEp").value; it.price=pv===""?null:Math.round(Number(pv)*10000)/10000; if($("#sEq")) it.qty=N($("#sEq").value);
      const locked=o.status!=="draft", ch=[]; if(op!==it.price) ch.push(`السعر ${op??"—"}→${it.price??"—"}`); if(oq!==it.qty) ch.push(`الكمية ${oq}→${it.qty}`);
      if(!ch.length){supEditRow=-1; return renderSupDrawer()}
      if(await supWrite(o,{items},`${locked?"تعديل سعر مثبت":"تعديل"} ${it.pn}: ${ch.join(" · ")}`)){ supEditRow=-1; toast("انحفظ") } return }
    case "shipStart": sship={oid:o.id,no:"",date:today(),file:"",paste:"",rows:null,list:null}; supMode="ship"; return renderSupDrawer();
    case "shipPaste": { const list=sClean(parseRows(sRowsFromPaste($("#shPaste").value))); if(!list.length){toast("ما لقيت أرقام قطع");return}
      sship.no=$("#shNo").value.trim(); sship.date=$("#shDate").value; sship.paste=$("#shPaste").value; sship.list=list; sship.rows=supMatch(o,list); return renderSupDrawer() }
    case "shipSave": { const p=sship; if(!p||!p.rows) return; p.no=$("#shNo").value.trim(); p.date=$("#shDate").value;
      if(p.no&&(o.shipments||[]).some(s=>s.no===p.no)&&!armConfirm(t,"رقم الفاتورة مسجّل قبل — اضغط مرة ثانية")) return;
      const rows=supMatch(o,p.list), lines=rows.filter(r=>r.i>=0).map(r=>({i:r.i,q:N(r.q.qty),p:r.q.price})), extras=rows.filter(r=>r.i<0).map(r=>({pn:r.q.pn,name:r.q.name||"",q:N(r.q.qty),p:r.q.price}));
      const ship={id:"h"+Date.now().toString(36),no:p.no,date:p.date||today(),file:p.file||"",at:new Date().toISOString(),by:myId,lines,extras};
      const shipments=[...(o.shipments||[]),ship], c2=supCalc({...o,shipments}), dv=rows.filter(r=>r.pd).reduce((x,r)=>x+r.d,0);
      t.disabled=true;
      if(await supWrite(o,{shipments,status:c2.remN===0?"done":o.status},`دفعة ${shipments.length}${p.no?` · فاتورة ${p.no}`:""}: ${lines.length} صنف${Math.abs(dv)>0.005?` · فرق السعر ${dv>0?"+":""}${money(dv)}`:""}${extras.length?` · ${extras.length} خارج الطلبية`:""}`)){
        sship=null; supMode=null; supTabIn=Math.abs(dv)>0.005?"diff":"ships"; toast("انحفظت الدفعة وانخصمت من الطلبية") } else t.disabled=false; return }
    case "shipDel": { if(!armConfirm(t,"تأكيد حذف الدفعة")) return; const si=+t.dataset.si, shipments=o.shipments.filter((_,k)=>k!==si);
      if(await supWrite(o,{shipments,status:o.status==="done"?"confirmed":o.status},`حذف دفعة ${si+1}${o.shipments[si].no?` · فاتورة ${o.shipments[si].no}`:""}`)) toast("انحذفت الدفعة ورجعت كمياتها للباقي"); return }
    case "recvAll": { const si=+t.dataset.si, shipments=o.shipments.map((s,k)=>k===si?{...s,lines:s.lines.map(l=>({...l,r:N(l.q),d:0})),receivedAt:new Date().toISOString(),receivedBy:myId}:s);
      if(await supWrite(o,{shipments},`استلام دفعة ${si+1} كاملة وسليمة`)) toast("تسجّل الاستلام"); return }
    case "recvStart": srecv={oid:o.id,si:+t.dataset.si}; supMode="recv"; return renderSupDrawer();
    case "recvSave": { const si=srecv.si, s=o.shipments[si]; let sh=0, dm=0;
      const lines=s.lines.map((l,k)=>{ const d=Math.max(N(($("#sd-"+k)||{}).value),0); let r=Math.max(N(($("#sr-"+k)||{}).value),0); if(r+d>N(l.q)) r=Math.max(N(l.q)-d,0); if(r+d<N(l.q)) sh++; if(d) dm++; return {...l,r,d} });
      const shipments=o.shipments.map((x,k)=>k===si?{...x,lines,receivedAt:new Date().toISOString(),receivedBy:myId}:x);
      if(await supWrite(o,{shipments},`استلام دفعة ${si+1}${sh?` · ${sh} صنف ناقص`:""}${dm?` · ${dm} تالف`:""}${!sh&&!dm?" كاملة":""}`)){ srecv=null; supMode=null; supTabIn=sh||dm?"claims":"ships"; toast("تسجّل الاستلام") } return }
    case "entered": { const si=+t.dataset.si, inv=(($("#sInv-"+si)||{}).value||"").trim(), shipments=o.shipments.map((s,k)=>k===si?{...s,enteredAt:new Date().toISOString(),enteredBy:myId,sysInv:inv}:s);
      if(await supWrite(o,{shipments},`إدخال دفعة ${si+1} بالنظام${inv?` · فاتورة ${inv}`:""}`)) toast("تسجّل الإدخال"); return }
    case "replyApply": { const p=sreply; if(!p) return; const m=supMatchReply(o,p.list), upQ=$("#rpQty")&&$("#rpQty").checked, drop=$("#rpDrop")&&$("#rpDrop").checked, addN=$("#rpAdd")&&$("#rpAdd").checked;
      let items=o.items.map(x=>({...x})); m.rows.forEach(r=>{ if(r.i<0) return; const it=items[r.i]; if(r.q.price!=null) it.price=r.q.price; if(upQ) it.qty=N(r.q.qty); if(!it.name&&r.q.name) it.name=r.q.name });
      if(drop){ const ms=new Set(m.missing); items=items.filter((_,i)=>!ms.has(i)) }
      if(addN) m.rows.filter(r=>r.i<0).forEach(r=>items.push({pn:r.q.pn,name:r.q.name||"",qty:N(r.q.qty),price:r.q.price}));
      if(await supWrite(o,{items},`رد المورد ${p.file}: ${m.rows.filter(r=>r.i>=0&&r.pc).length} سعر · ${upQ?m.rows.filter(r=>r.i>=0&&r.qc).length:0} كمية${drop?` · حذف ${m.missing.length}`:""}${addN?` · إضافة ${m.rows.filter(r=>r.i<0).length}`:""}`)){ sreply=null; supMode=null; toast("تحدّثت الطلبية — راجعها واضغط تأكيد") } return }
  }
});
document.addEventListener("change",ev=>{
  const t=ev.target, o=sorders.find(x=>x.id===supOpen);
  if(t.id==="sFile"&&t.files[0]){ const f=t.files[0]; t.value=""; sReadInto(f,list=>{ sdraft.items.push(...list); sdraft.file=f.name; if(!sdraft.ref) sdraft.ref=f.name.replace(/\.[^.]+$/,"").replace(/_/g," "); toast(`انقرأ ${list.length} صنف`); render() }); return }
  if(t.id==="sCurr"&&sdraft){ sdraft.currency=t.value; sdraft.rate=CUR[t.value].rate; sdraft.freight=CUR[t.value].fr; render(); return }
  if(t.id==="sFlt"){ supFilter=t.value; supLimit=200; renderSupDrawer(); return }
  if(t.id==="shFile"&&t.files[0]&&o&&sship){ const f=t.files[0]; t.value=""; sship.no=$("#shNo").value.trim(); sship.date=$("#shDate").value;
    sReadInto(f,(list,meta)=>{ sship.file=f.name; sship.list=list; sship.rows=supMatch(o,list); if(!sship.no&&(meta.invoiceNo||meta.docNo)) sship.no=meta.invoiceNo||meta.docNo; renderSupDrawer() }); return }
  if(t.id==="sReplyFile"&&t.files[0]&&o){ const f=t.files[0]; t.value=""; sReadInto(f,list=>{ sreply={oid:o.id,file:f.name,list,m:supMatchReply(o,list)}; supMode="reply"; renderSupDrawer() }); return }
});
document.addEventListener("input",ev=>{
  const t=ev.target, map={sRef:"ref",sSup:"supplier",sExp:"expected",sNote:"note",sRate:"rate",sFr:"freight",sPaste:"paste"};
  if(map[t.id]&&sdraft){ sdraft[map[t.id]]=t.value; const b=$("#sSaveNew"); if(b) b.disabled=!sdraft.ref.trim()||!sdraft.supplier.trim()||!sdraft.items.length; return }
  if(t.id==="sQ"){ supQ=t.value; supLimit=200; const o=sorders.find(x=>x.id===supOpen); if(!o) return; const r=sItemRows(o,supCalc(o),o.status!=="draft"); const b=$("#sItemsBody"); if(b) b.innerHTML=r.html; const c=$("#sCount"); if(c) c.textContent=r.total+" صنف"; return }
  if(t.id==="shPaste"&&sship){ sship.paste=t.value; return }
});
document.addEventListener("dragover",ev=>{const dz=ev.target.closest&&ev.target.closest("#sDz");if(dz){ev.preventDefault();dz.classList.add("over")}});
document.addEventListener("drop",ev=>{const dz=ev.target.closest&&ev.target.closest("#sDz");if(dz&&sdraft){ev.preventDefault();dz.classList.remove("over");const f=ev.dataTransfer.files[0];if(f)sReadInto(f,list=>{sdraft.items.push(...list);sdraft.file=f.name;if(!sdraft.ref)sdraft.ref=f.name.replace(/\.[^.]+$/,"").replace(/_/g," ");render()})}});
document.addEventListener("keydown",ev=>{ if(ev.key==="Escape"&&supOpen&&!supMode){ supOpen=null; renderSupDrawer() } });
