(function () {
  const WORKER = "https://seo-ai.jeff-552.workers.dev";

  // Turn on verbose logs by default. You can flip this at runtime, too.
  window.seoAiDebug = (typeof window.seoAiDebug === "boolean") ? window.seoAiDebug : true;
  const DEBUG = !!window.seoAiDebug;
  const group = (title) => { if (DEBUG) try { console.groupCollapsed(title); } catch{} };
  const groupEnd = () => { if (DEBUG) try { console.groupEnd(); } catch{} };
  const log = (...a) => { if (DEBUG) console.log(...a); };
  const warn = (...a) => { if (DEBUG) console.warn(...a); };
  const error = (...a) => { if (DEBUG) console.error(...a); };

  let _isUpdating = false, _observer;
  const START = "seo-agent-start", END = "seo-agent-end", ATTR = "data-seo-agent";
  const BAD = new Set(["false","null","undefined","n/a","none","0"]);
  const esc = s => String(s == null ? "" : s).trim();
  const ok  = s => !!esc(s) && !BAD.has(esc(s).toLowerCase());

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

    if (ok(seo.meta_title)){
      const t=document.createElement("title");
      t.setAttribute(ATTR,"true");
      t.textContent=esc(seo.meta_title);
      f.appendChild(t);
    }
    if (ok(seo.meta_description)){
      const d=document.createElement("meta");
      d.setAttribute("name","description");
      d.setAttribute("content",esc(seo.meta_description));
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
    if (ok(seo.meta_title)){
      const ogt=document.createElement("meta");
      ogt.setAttribute("property","og:title");
      ogt.setAttribute("content",esc(seo.meta_title));
      ogt.setAttribute(ATTR,"true");
      f.appendChild(ogt);
    }
    if (ok(seo.meta_description)){
      const ogd=document.createElement("meta");
      ogd.setAttribute("property","og:description");
      ogd.setAttribute("content",esc(seo.meta_description));
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
      startObserver(()=>{ try{ applySeo(seo); }catch(e){ warn("[SEO] reapply error", e); } });
    }
  }

  function logSSRIfPresent() {
    try {
      const ssrTitle = esc(document.title || "");
      const md = document.querySelector('meta[name="description"]');
      const ssrDesc = esc(md ? md.getAttribute("content") : "");
      const kw = esc(document.querySelector('meta[name="keywords"]')?.getAttribute('content')||"");
      group("🧩 SEO (SSR)");
      log("title:", ssrTitle);
      log("description:", ssrDesc);
      if (kw) log("keywords:", kw);
      log("SEO_AGENT_HAS_AI:", !!window.SEO_AGENT_HAS_AI);
      groupEnd();
    } catch (e) { /* ignore */ }
  }

  async function fetchAIAndLogApply(){
    try{
      if (!document.body) {
        await new Promise(r=>addEventListener("DOMContentLoaded", r, {once:true}));
      }

      const safeText = String(document.body.innerText||"").replace(/\s+/g,' ').trim().slice(0,2000);
      const company = window.SEO_COMPANY || { name:"", shop_description:"", shop_url:"", currency:"" };

      group("🔎 SEO (Worker POST)");
      log("POST", WORKER+"/", { pageUrl: location.href, preview: safeText.slice(0,120), company });

      const res = await fetch(WORKER+"/", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ pageUrl: location.href, pageContent: safeText, company })
      });

      const text = await res.text();
      let seo = {};
      try { seo = JSON.parse(text); } catch { seo = {}; }

      log("status:", res.status);
      log("raw:", text);
      log("json:", seo);

      const t = esc(seo.meta_title||"");
      const d = esc(seo.meta_description||"");
      const usable = ok(t) || ok(d);
      log("usable:", usable);
      groupEnd();

      if (!usable) return;
      applySeo(seo);
    } catch (err){
      error("[SEO] Injection failed:", err);
    }
  }

  // Always print SSR snapshot immediately
  logSSRIfPresent();

  // Then fetch AI and log results on page load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(fetchAIAndLogApply, 0);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(fetchAIAndLogApply, 0), { once:true });
  }

  // Also log on Shopify soft navs
  document.addEventListener("shopify:section:load", fetchAIAndLogApply);
  document.addEventListener("shopify:navigation:end", fetchAIAndLogApply);

  // expose for manual testing
  window.__applySeoAgent = applySeo;
})();
