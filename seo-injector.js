/*!
 * SEO Injector
 * - Logs AI SEO JSON to console (pretty-printed)
 * - Applies meta tags to <head>
 * - Reapplies on Shopify soft navigation events
 *
 * Usage:
 * <script>window.seoAiDebug = true; // optional</script>
 * <script src="https://cdn.jsdelivr.net/gh/your-org/your-repo/injector.js"></script>
 */

(function () {
  "use strict";

  /*** CONFIG ***/
  var WORKER = "https://seo-ai.jeff-552.workers.dev"; // <-- change if needed

  // Debug flag (can be pre-set via window.seoAiDebug = true)
  var DEBUG = (typeof window.seoAiDebug === "boolean") ? window.seoAiDebug : true;

  /*** LOG HELPERS ***/
  var group = function (t) { if (DEBUG) try { console.groupCollapsed(t); } catch {} };
  var groupEnd = function () { if (DEBUG) try { console.groupEnd(); } catch {} };
  var log = function () { if (DEBUG) console.log.apply(console, arguments); };
  var warn = function () { if (DEBUG) console.warn.apply(console, arguments); };
  var error = function () { if (DEBUG) console.error.apply(console, arguments); };

  /*** GLOBAL HOOKS ***/
  // Last SEO object and helper to reprint it
  window.__lastSeoAi = null;
  window.__printSeoAi = function () {
    try {
      if (!window.__lastSeoAi) { console.log("{}"); return; }
      console.log(JSON.stringify(window.__lastSeoAi, null, 4));
    } catch (e) { console.log("{}"); }
  };

  /*** UTILITIES ***/
  var START = "seo-agent-start", END = "seo-agent-end", ATTR = "data-seo-agent";
  var BAD = new Set(["false","null","undefined","n/a","none","0"]);
  var esc = function (s) { return String(s == null ? "" : s).trim(); };
  var ok  = function (s) { var v = esc(s); return !!v && !BAD.has(v.toLowerCase()); };

  function removeBlock(head){
    var start=null,end=null;
    // Find our comment block markers
    for (var i=0;i<head.childNodes.length;i++){
      var n=head.childNodes[i];
      if (n.nodeType===8 && n.data && n.data.trim()===START) start=n;
      if (n.nodeType===8 && n.data && n.data.trim()===END)   end=n;
      if (start && end) break;
    }
    // Remove marked block
    if (start && end){
      var cur=start;
      while (cur){
        var nxt=cur.nextSibling;
        try { cur.remove(); } catch {}
        if (cur===end) break;
        cur=nxt;
      }
    }
    // Remove any previous injected meta elements
    var flagged = head.querySelectorAll("[" + ATTR + '="true"]');
    for (var j=0;j<flagged.length;j++){
      try { flagged[j].remove(); } catch {}
    }
  }

  function buildFrag(seo){
    var f=document.createDocumentFragment();
    f.appendChild(document.createComment(START));

    if (ok(seo.meta_title)){
      var t=document.createElement("title");
      t.setAttribute(ATTR,"true");
      t.textContent=esc(seo.meta_title);
      f.appendChild(t);
    }
    if (ok(seo.meta_description)){
      var d=document.createElement("meta");
      d.setAttribute("name","description");
      d.setAttribute("content",esc(seo.meta_description));
      d.setAttribute(ATTR,"true");
      f.appendChild(d);
    }
    if (Array.isArray(seo.keywords) && seo.keywords.length){
      var k=document.createElement("meta");
      k.setAttribute("name","keywords");
      k.setAttribute("content", seo.keywords.map(esc).filter(Boolean).join(", "));
      k.setAttribute(ATTR,"true");
      f.appendChild(k);
    }
    if (ok(seo.meta_title)){
      var ogt=document.createElement("meta");
      ogt.setAttribute("property","og:title");
      ogt.setAttribute("content",esc(seo.meta_title));
      ogt.setAttribute(ATTR,"true");
      f.appendChild(ogt);
    }
    if (ok(seo.meta_description)){
      var ogd=document.createElement("meta");
      ogd.setAttribute("property","og:description");
      ogd.setAttribute("content",esc(seo.meta_description));
      ogd.setAttribute(ATTR,"true");
      f.appendChild(ogd);
    }

    f.appendChild(document.createComment(END));
    return f;
  }

  var _observer=null, _isUpdating=false;
  function startObserver(reapply){
    if (typeof MutationObserver==="undefined") return;
    var head=document.head||document.getElementsByTagName("head")[0]||document.documentElement;
    var timer=null;
    _observer=new MutationObserver(function(){
      if (_isUpdating) return;
      var flagged = head.querySelectorAll("[" + ATTR + '="true"]').length>0;
      var hasS=false,hasE=false;
      for (var i=0;i<head.childNodes.length;i++){
        var n=head.childNodes[i];
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
    var head=document.head||document.getElementsByTagName("head")[0]||document.documentElement;
    if (!head || !seo) return;
    _isUpdating=true; stopObserver();
    try{
      removeBlock(head);
      head.insertBefore(buildFrag(seo), head.firstChild);
      if (ok(seo.meta_title)) document.title=esc(seo.meta_title);
    } finally {
      _isUpdating=false;
      startObserver(function(){ try{ applySeo(seo); }catch(e){ warn("[SEO] reapply error", e); } });
    }
  }

  function logSSRIfPresent() {
    try {
      var ssrTitle = esc(document.title || "");
      var md = document.querySelector('meta[name="description"]');
      var ssrDesc = esc(md ? md.getAttribute("content") : "");
      var kwMeta = document.querySelector('meta[name="keywords"]');
      var kw = esc(kwMeta ? kwMeta.getAttribute('content') : "");
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
        await new Promise(function(r){ addEventListener("DOMContentLoaded", r, {once:true}); });
      }

      var safeText = String(document.body.innerText||"").replace(/\s+/g,' ').trim().slice(0,2000);
      var company = window.SEO_COMPANY || { name:"", shop_description:"", shop_url:"", currency:"" };

      group("🔎 SEO (Worker POST)");
      log("POST", WORKER+"/", { pageUrl: location.href, preview: safeText.slice(0,120), company });

      var res = await fetch(WORKER+"/", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ pageUrl: location.href, pageContent: safeText, company })
      });

      var text = await res.text();
      var seo = {};
      try { seo = JSON.parse(text); } catch { seo = {}; }

      // Save & ALWAYS print ONLY the JSON object (pretty)
      window.__lastSeoAi = seo;
      console.log(JSON.stringify(seo, null, 4)); // <— exact console output you requested

      // Optional developer logs
      log("status:", res.status);
      log("usable:", (ok(seo.meta_title)||ok(seo.meta_description)));
      groupEnd();

      // Apply if usable
      var t = esc(seo.meta_title||"");
      var d = esc(seo.meta_description||"");
      if (ok(t) || ok(d)) applySeo(seo);

    } catch (err){
      error("[SEO] Injection failed:", err);
    }
  }

  // Initial SSR snapshot
  logSSRIfPresent();

  // Run on load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(fetchAIAndLogApply, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ setTimeout(fetchAIAndLogApply, 0); }, { once:true });
  }

  // Re-run on Shopify soft navigations
  document.addEventListener("shopify:section:load", fetchAIAndLogApply);
  document.addEventListener("shopify:navigation:end", fetchAIAndLogApply);

  // Manual hook for testing
  window.__applySeoAgent = applySeo;
})();
