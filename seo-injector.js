/*!
 * SEO Injector (SSR-safe logger)
 *
 * Modes:
 *  - SSR-only (default for your setup):
 *      window.SEO_AGENT_SSR_ONLY = true (set in meta-tags snippet)
 *      → Does NOT mutate <head>, only logs Worker response.
 *
 *  - Hybrid:
 *      window.SEO_AGENT_SSR_ONLY = false (or undefined)
 *      → CAN still apply client-side meta overrides if desired.
 *
 * Behavior:
 *   - POSTs page content to Worker
 *   - Logs ONE structured console item per page:
 *       { source, pageUrl, prompt, ssr, worker, appliedClientSide, mode }
 *   - Re-runs on Shopify soft navigation events
 *
 * Optional:
 *   window.seoAiDebug = true;  // extra dev logging
 */

(function () {
  "use strict";

  /*** CONFIG ***/
  var WORKER = "https://seo-ai.jeff-552.workers.dev";

  // Debug flag (can be pre-set via window.seoAiDebug = true)
  // DEFAULT: false so we only log the single summary item.
  var DEBUG = (typeof window.seoAiDebug === "boolean") ? window.seoAiDebug : false;

  // SSR-only flag set by Liquid snippet:
  //   window.SEO_AGENT_SSR_ONLY = true;
  var SSR_ONLY = !!window.SEO_AGENT_SSR_ONLY;

  /*** LOG HELPERS ***/
  var group = function (t) { if (DEBUG) try { console.groupCollapsed(t); } catch (e) {} };
  var groupEnd = function () { if (DEBUG) try { console.groupEnd(); } catch (e) {} };
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
  var BAD = new Set(["false", "null", "undefined", "n/a", "none", "0"]);
  var esc = function (s) { return String(s == null ? "" : s).trim(); };
  var ok = function (s) { var v = esc(s); return !!v && !BAD.has(v.toLowerCase()); };

  function removeBlock(head) {
    var start = null, end = null;
    // Find our comment block markers
    for (var i = 0; i < head.childNodes.length; i++) {
      var n = head.childNodes[i];
      if (n.nodeType === 8 && n.data && n.data.trim() === START) start = n;
      if (n.nodeType === 8 && n.data && n.data.trim() === END)   end = n;
      if (start && end) break;
    }
    // Remove marked block
    if (start && end) {
      var cur = start;
      while (cur) {
        var nxt = cur.nextSibling;
        try { cur.remove(); } catch (e) {}
        if (cur === end) break;
        cur = nxt;
      }
    }
    // Remove any previous injected meta elements
    var flagged = head.querySelectorAll("[" + ATTR + '="true"]');
    for (var j = 0; j < flagged.length; j++) {
      try { flagged[j].remove(); } catch (e) {}
    }
  }

  function buildFrag(seo) {
    var f = document.createDocumentFragment();
    f.appendChild(document.createComment(START));

    if (ok(seo.meta_title)) {
      var t = document.createElement("title");
      t.setAttribute(ATTR, "true");
      t.textContent = esc(seo.meta_title);
      f.appendChild(t);
    }
    if (ok(seo.meta_description)) {
      var d = document.createElement("meta");
      d.setAttribute("name", "description");
      d.setAttribute("content", esc(seo.meta_description));
      d.setAttribute(ATTR, "true");
      f.appendChild(d);
    }
    if (Array.isArray(seo.keywords) && seo.keywords.length) {
      var k = document.createElement("meta");
      k.setAttribute("name", "keywords");
      k.setAttribute("content", seo.keywords.map(esc).filter(Boolean).join(", "));
      k.setAttribute(ATTR, "true");
      f.appendChild(k);
    }
    if (ok(seo.meta_title)) {
      var ogt = document.createElement("meta");
      ogt.setAttribute("property", "og:title");
      ogt.setAttribute("content", esc(seo.meta_title));
      ogt.setAttribute(ATTR, "true");
      f.appendChild(ogt);
    }
    if (ok(seo.meta_description)) {
      var ogd = document.createElement("meta");
      ogd.setAttribute("property", "og:description");
      ogd.setAttribute("content", esc(seo.meta_description));
      ogd.setAttribute(ATTR, "true");
      f.appendChild(ogd);
    }

    f.appendChild(document.createComment(END));
    return f;
  }

  var _observer = null, _isUpdating = false;
  function startObserver(reapply) {
    if (SSR_ONLY) return; // In SSR-only mode, no need to watch <head> mutations.
    if (typeof MutationObserver === "undefined") return;

    var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    var timer = null;
    _observer = new MutationObserver(function () {
      if (_isUpdating) return;
      var flagged = head.querySelectorAll("[" + ATTR + '="true"]').length > 0;
      var hasS = false, hasE = false;
      for (var i = 0; i < head.childNodes.length; i++) {
        var n = head.childNodes[i];
        if (n.nodeType === 8 && n.data && n.data.trim() === START) hasS = true;
        if (n.nodeType === 8 && n.data && n.data.trim() === END)   hasE = true;
        if (hasS && hasE) break;
      }
      if (!flagged || !hasS || !hasE) {
        clearTimeout(timer);
        timer = setTimeout(reapply, 150);
      }
    });
    _observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
  }
  function stopObserver() { if (_observer) { try { _observer.disconnect(); } catch (e) {} _observer = null; } }

  function applySeo(seo) {
    // In SSR-only mode we do not mutate <head> at all.
    if (SSR_ONLY) {
      window.__seoAiAppliedClientSide = false;
      return;
    }

    var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    if (!head || !seo) return;
    _isUpdating = true; stopObserver();
    try {
      removeBlock(head);
      head.insertBefore(buildFrag(seo), head.firstChild);
      if (ok(seo.meta_title)) document.title = esc(seo.meta_title);
      window.__seoAiAppliedClientSide = true;
    } finally {
      _isUpdating = false;
      startObserver(function () {
        try { applySeo(seo); } catch (e) { warn("[SEO] reapply error", e); }
      });
    }
  }

  // Capture SSR snapshot (no logging)
  function captureSSRSnapshot() {
    try {
      var ssrTitle = esc(document.title || "");
      var md = document.querySelector('meta[name="description"]');
      var ssrDesc = esc(md ? md.getAttribute("content") : "");
      var kwMeta = document.querySelector('meta[name="keywords"]');
      var kw = esc(kwMeta ? kwMeta.getAttribute("content") : "");
      return {
        title: ssrTitle,
        description: ssrDesc,
        keywords: kw,
        hadAi: !!window.SEO_AGENT_HAS_AI
      };
    } catch (e) {
      return {
        title: "",
        description: "",
        keywords: "",
        hadAi: !!window.SEO_AGENT_HAS_AI
      };
    }
  }

  async function fetchAIAndLogApply() {
    try {
      if (!document.body) {
        await new Promise(function (r) {
          addEventListener("DOMContentLoaded", r, { once: true });
        });
      }

      var ssrSnapshot = captureSSRSnapshot();

      var safeText = String(document.body.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);

      var company = window.SEO_COMPANY || {
        name: "",
        shop_description: "",
        shop_url: "",
        currency: ""
      };

      var preview = safeText.slice(0, 400);

      group("🔎 SEO (Worker POST)");
      log("mode:", SSR_ONLY ? "ssr-only" : "hybrid");
      log("POST", WORKER + "/", { pageUrl: location.href, preview: preview, company: company });

      var res = await fetch(WORKER + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: location.href,
          pageContent: safeText,
          company: company
        })
      });

      var text = await res.text();
      var seo = {};
      try { seo = JSON.parse(text); } catch (e) { seo = {}; }

      window.__lastSeoAi = seo;

      var usable = (ok(seo.meta_title) || ok(seo.meta_description));
      log("status:", res.status);
      log("usable:", usable);
      groupEnd();

      // Only apply client-side overrides when NOT in SSR-only mode.
      if (usable && !SSR_ONLY) {
        applySeo(seo);
      }

      var appliedClientSide = !!window.__seoAiAppliedClientSide;

      // 🔥 SINGLE CONSOLE ITEM:
      // prompt + results + SSR vs client-side info
      console.log(JSON.stringify({
        source: "seo-ai",
        pageUrl: location.href,
        mode: SSR_ONLY ? "ssr-only" : "hybrid",
        prompt: {
          preview: preview,
          company: company
        },
        ssr: ssrSnapshot,
        worker: {
          status: res.status,
          seo: seo
        },
        appliedClientSide: appliedClientSide
      }, null, 2));

    } catch (err) {
      error("[SEO] Injection failed:", err);
    }
  }

  // Run on load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(fetchAIAndLogApply, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(fetchAIAndLogApply, 0);
    }, { once: true });
  }

  // Re-run on Shopify soft navigations
  document.addEventListener("shopify:section:load", fetchAIAndLogApply);
  document.addEventListener("shopify:navigation:end", fetchAIAndLogApply);

  // Manual hook for testing (respects SSR_ONLY flag inside applySeo)
  window.__applySeoAgent = applySeo;
})();
