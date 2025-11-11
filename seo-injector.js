
// --- SEO agent injector (client) ---
(function () {
  const WORKER = "https://seo-ai.jeff-552.workers.dev";

  let _isUpdating = false, _observer;
  const START = "seo-agent-start", END = "seo-agent-end", ATTR = "data-seo-agent";
  const esc = s => String(s == null ? "" : s).trim();

  function removeBlock(head){
    // remove between START/END or any flagged nodes
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

    if (seo.meta_title && seo.meta_title.trim()){
      const t=document.createElement("title");
      t.setAttribute(ATTR,"true");
      t.textContent=esc(seo.meta_title);
      f.appendChild(t);
    }
    if (seo.meta_description && seo.meta_description.trim()){
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
    if (seo.meta_title){
      const ogt=document.createElement("meta");
      ogt.setAttribute("property","og:title");
      ogt.setAttribute("content",esc(seo.meta_title));
      ogt.setAttribute(ATTR,"true");
      f.appendChild(ogt);
    }
    if (seo.meta_description){
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
      if (seo.meta_title) document.title=esc(seo.meta_title);
    } finally {
      _isUpdating=false;
      startObserver(()=>{ try{ applySeo(seo); }catch{} });
    }
  }

  async function injectSEO(){
    try{
      // If server already produced AI tags, do nothing.
      if (window.SEO_AGENT_HAS_AI === true) {
        console.debug("[SEO] Server-side AI present; injector skipped.");
        return;
      }

      if (!document.body) {
        await new Promise(r=>addEventListener("DOMContentLoaded", r, {once:true}));
      }

      const safeText = (document.body.innerText||"").slice(0,2000);
      const company = window.SEO_COMPANY || { name:"", shop_description:"", shop_url:"", currency:"" };

      const res = await fetch(WORKER+"/", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          pageUrl: location.href,
          pageContent: safeText,
          company
        })
      });

      let seo={};
      try { seo = await res.json(); } catch(e){ console.warn("[SEO] Worker returned non-JSON.", e); return; }

      // Validate before applying to avoid flashes
      const bad = new Set(["false","null","undefined","n/a","none","0"]);
      const t = (seo.meta_title||"").trim();
      const d = (seo.meta_description||"").trim();
      const ok = (t && !bad.has(t.toLowerCase())) || (d && !bad.has(d.toLowerCase()));

      console.debug("[SEO] Injector received:", seo, "ok:", ok);

      if (!ok) return;
      applySeo(seo);
    } catch (err){
      console.error("[SEO] Injection failed:", err);
    }
  }

  // run + listen for Shopify events
  injectSEO();
  document.addEventListener("shopify:section:load", injectSEO);
  document.addEventListener("shopify:navigation:end", injectSEO);

  // expose for debugging if needed
  window.__applySeoAgent = applySeo;
})();
