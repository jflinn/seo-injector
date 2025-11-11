
(function () {
  const WORKER = "https://seo-ai.jeff-552.workers.dev";

  // ========= instant cache =========
  const CACHE_NS = "seo_ai_cache_v2";          // bump to invalidate
  const TTL_MS   = 7 * 24 * 60 * 60 * 1000;    // 7 days
  const MAX_ITEMS = 100;
  const BAD = new Set(["false","null","undefined","n/a","none","0"]);
  const esc = s => String(s == null ? "" : s).trim();
  const ok  = s => !!esc(s) && !BAD.has(esc(s).toLowerCase());
  const now = () => Date.now();

  function normalizeKey(u) {
    try {
      const url = new URL(u, location.origin);
      url.search = ""; url.hash = "";
      let p = url.pathname.replace(/\/(?:index(?:\.(?:html?|php))?)$/i,"/");
      if (p.length > 1 && p.endsWith("/")) p = p.slice(0,-1);
      return (url.origin.replace(/^https?:\/\//,"").replace(/^www\./,"") + p).toLowerCase();
    } catch { return (location.hostname + location.pathname).toLowerCase(); }
  }
  const PAGE_KEY = normalizeKey(location.href);

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_NS);
      if (!raw) return { v:CACHE_NS, items:{} };
      const j = JSON.parse(raw);
      if (!j || j.v !== CACHE_NS || typeof j.items !== "object") return { v:CACHE_NS, items:{} };
      return j;
    } catch { return { v:CACHE_NS, items:{} }; }
  }
  function saveCache(db) {
    try {
      const keys = Object.keys(db.items||{});
      if (keys.length > MAX_ITEMS) {
        keys.sort((a,b)=>(db.items[a].t||0)-(db.items[b].t||0));
        for (let i=0;i<keys.length-MAX_ITEMS;i++) delete db.items[keys[i]];
      }
      localStorage.setItem(CACHE_NS, JSON.stringify({ v:CACHE_NS, items: db.items||{} }));
    } catch {
      try {
        const keys = Object.keys(db.items||{});
        keys.sort((a,b)=>(db.items[a].t||0)-(db.items[b].t||0));
        for (let i=0;i<Math.min(10,keys.length);i++) delete db.items[keys[i]];
        localStorage.setItem(CACHE_NS, JSON.stringify({ v:CACHE_NS, items: db.items||{} }));
      } catch {}
    }
  }
  function getCached(key) {
    const db = loadCache();
    const rec = db.items[key];
    if (!rec) return null;
    if ((now() - (rec.t||0)) > TTL_MS) {
      delete db.items[key]; saveCache(db); return null;
    }
    return rec.data || null;
  }
  function setCached(key, data) {
    const db = loadCache();
    db.items[key] = { t: now(), data };
    saveCache(db);
    try {
      if ("BroadcastChannel" in window) {
        const bc = new BroadcastChannel("seo_ai_bc");
        bc.postMessage({ key, data }); bc.close();
      }
    } catch {}
  }

  // ========= DOM block management (your original logic) =========
  let _isUpdating = false, _observer;
  const START = "seo-agent-start", END = "seo-agent-end", ATTR = "data-seo-agent";

  function removeBlock(head){
    let start=null,end=null;
    for (const n of head.childNodes) {
      if (n.nodeType===8 && n.data && n.data.trim()===START) start=n;
      if (n.nodeType===8 && n.data && n.data.trim()===END)   end=n;
      if (start && end) break;
    }
    if (start && end){
      let cur=start;
      while (cur){ const nxt=cur.nextSibling; try{cur.remove();}catch{} if(cur===end) break; cur=nxt; }
    }
    head.querySelectorAll(`[${ATTR}="true"]`).forEach(el=>{ try{el.remove();}catch{} });
  }

  function buildFrag(seo){
    const f=document.createDocumentFragment();
    f.appendChild(document.createComment(START));
    const title = esc(seo.meta_title||"");
    const desc  = esc(seo.meta_description||"");

    if (ok(title)){
      const t=document.createElement("title");
      t.setAttribute(ATTR,"true");
      t.textContent=title;
      f.appendChild(t);
    }
    if (ok(desc)){
      const d=document.createElement("meta");
      d.setAttribute("name","description");
      d.setAttribute("content",desc);
      d.setAttribute(ATTR,"true");
      f.appendChild(d);
    }
    if (Array.isArray(seo.keywords) && seo.keywords.length){
      const k=document.createElement("meta");
      k.setAttribute("name","keywords");
      k.setAttribute("content", seo.keywords.map(esc).filter(Boolean).join(", "));
      k.setAttribute(ATTR,"true");
      f.appendChild(k);
    }
    if (ok(title)){
      const ogt=document.createElement("meta");
      ogt.setAttribute("property","og:title");
      ogt.setAttribute("content",title);
      ogt.setAttribute(ATTR,"true");
      f.appendChild(ogt);
    }
    if (ok(desc)){
      const ogd=document.createElement("meta");
      ogd.setAttribute("property","og:description");
      ogd.setAttribute("content",desc);
      ogd.setAttribute(ATTR,"true");
      f.appendChild(ogd);
    }
    f.appendChild(document.createComment(END));
    return f;
  }

  function startObserver(reapply){
    if (typeof MutationObserver==="undefined") return;
    const head=document.head||document.getElementsByTagName("head")[0]||document.documentElement;
    let timer=null;
    _observer=new MutationObserver(()=>{
      if (_isUpdating) return;
      const flagged=head.querySelectorAll(`[${ATTR}="true"]`).length>0;
      let hasS=false,hasE=false;
      for (const n of head.childNodes){
        if (n.nodeType===8 && n.data && n.data.trim()===START) hasS=true;
        if (n.nodeType===8 && n.data && n.data.trim()===END)   hasE=true;
        if (hasS && hasE) break;
      }
      if (!flagged || !hasS || !hasE){
        clearTimeout(timer);
        timer=setTimeout(reapply,150);
      }
    });
    _observer.observe(head,{childList:true,subtree:true,attributes:true,attributeFilter:["content"]});
  }
  function stopObserver(){ if(_observer){ try{_observer.disconnect();}catch{} _observer=null; } }

  function applySeo(seo){
    const head=document.head||document.getElementsByTagName("head")[0]||document.documentElement;
    if (!head || !seo) return;
    _isUpdating=true; stopObserver();
    try{
      removeBlock(head);
      head.insertBefore(buildFrag(seo), head.firstChild);
      if (ok(seo.meta_title)) document.title=esc(seo.meta_title);
    } finally {
      _isUpdating=false;
      startObserver(()=>{ try{ applySeo(seo); }catch{} });
    }
  }
  // expose for debugging
  window.__applySeoAgent = applySeo;

  // ========= bootstrap: 1) use cache immediately, 2) seed from SSR, 3) refresh in background =========
  // 1) apply cached (instant for repeat visits & SPA)
  const cached = getCached(PAGE_KEY);
  if (cached && (ok(cached.meta_title) || ok(cached.meta_description))) {
    applySeo(cached);
  }

  // 2) if server already rendered AI/fallback, seed cache from DOM (so next nav is instant)
  try {
    if (window.SEO_AGENT_HAS_AI === true) {
      const ssrTitle = esc(document.title || "");
      const md = document.querySelector('meta[name="description"]');
      const ssrDesc = esc(md ? md.getAttribute("content") : "");
      if (ok(ssrTitle) || ok(ssrDesc)) {
        setCached(PAGE_KEY, {
          meta_title: ssrTitle,
          meta_description: ssrDesc,
          keywords: (document.querySelector('meta[name="keywords"]')?.getAttribute('content')||"")
            .split(",").map(s=>esc(s)).filter(Boolean)
        });
      }
    }
  } catch {}

  // 3) background refresh (only if server didn’t produce AI OR we want to update stale cache)
  async function refreshSEO() {
    try{
      const safeText = (document.body && document.body.innerText) ? String(document.body.innerText).replace(/\s+/g,' ').trim().slice(0,2000) : "";
      const company = window.SEO_COMPANY || { name:"", shop_description:"", shop_url:"", currency:"" };

      const res = await fetch(WORKER + "/", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          pageUrl: location.href,
          pageContent: safeText,
          company
        })
      });
      let seo = {};
      try { seo = await res.json(); } catch { seo = {}; }

      const t = esc(seo.meta_title||"");
      const d = esc(seo.meta_description||"");
      const usable = ok(t) || ok(d);
      if (!usable) return;

      // write cache & apply if changed
      const prev = getCached(PAGE_KEY);
      setCached(PAGE_KEY, {
        meta_title: t,
        meta_description: d,
        keywords: Array.isArray(seo.keywords) ? seo.keywords.map(esc).filter(Boolean) : []
      });
      if (!prev || t !== esc(prev.meta_title||"") || d !== esc(prev.meta_description||"")) {
        applySeo(seo);
      }
    } catch {}
  }

  // If server already rendered AI, we’ve seeded cache; we still refresh quietly to improve future visits
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(refreshSEO, 0);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(refreshSEO, 0), { once:true });
  }

  // Shopify SPA/pjax
  document.addEventListener("shopify:section:load", () => { 
    const hit = getCached(PAGE_KEY);
    if (hit && (ok(hit.meta_title) || ok(hit.meta_description))) applySeo(hit);
    refreshSEO();
  });
  document.addEventListener("shopify:navigation:end", () => {
    const key = normalizeKey(location.href);
    const hit = getCached(key);
    if (hit && (ok(hit.meta_title) || ok(hit.meta_description))) applySeo(hit);
    refreshSEO();
  });

  // Cross-tab sync (another tab updates the same page key)
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel("seo_ai_bc");
      bc.onmessage = (ev) => {
        if (ev && ev.data && ev.data.key === PAGE_KEY && ev.data.data) applySeo(ev.data.data);
      };
    }
  } catch {}

})();
