/*!
 * SEO Injector (SSR-safe logger, NO client-side <head> mutations)
 *
 * Modes:
 *  - This theme: SSR-only
 *      → Injector never mutates <head>; it only POSTs to Worker + logs.
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

  // This theme runs in SSR-only mode: injector NEVER mutates <head>.
  var SSR_ONLY = true;

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
  var BAD = new Set(["false", "null", "undefined", "n/a", "none", "0"]);
  var esc = function (s) { return String(s == null ? "" : s).trim(); };
  var ok = function (s) { var v = esc(s); return !!v && !BAD.has(v.toLowerCase()); };

// Apply Worker SEO to <head>, making it the priority over SSR.
function applySeo(seo, ssrSnapshot) {
  try {
    var used = false;
    if (!seo) {
      window.__seoAiAppliedClientSide = false;
      return;
    }

    // --- TITLE ---
    if (ok(seo.meta_title)) {
      var newTitle = esc(seo.meta_title);
      var currentTitle = esc(document.title || "");

      if (newTitle && newTitle !== currentTitle) {
        document.title = newTitle;
        used = true;
      }
    }

    // --- DESCRIPTION ---
    if (ok(seo.meta_description)) {
      var newDesc = esc(seo.meta_description);
      var md = document.querySelector('meta[name="description"]');
      if (!md) {
        md = document.createElement("meta");
        md.setAttribute("name", "description");
        document.head.appendChild(md);
      }
      var currentDesc = esc(md.getAttribute("content") || "");

      if (newDesc && newDesc !== currentDesc) {
        md.setAttribute("content", newDesc);
        used = true;
      }
    }

    if (Array.isArray(seo.keywords) && seo.keywords.length) {
      var kwMeta = document.querySelector('meta[name="keywords"]');
      if (!kwMeta) {
        kwMeta = document.createElement("meta");
        kwMeta.setAttribute("name", "keywords");
        document.head.appendChild(kwMeta);
      }
      kwMeta.setAttribute("content", seo.keywords.join(", "));
      used = true;
    }

    window.__seoAiAppliedClientSide = used;
  } catch (e) {
    window.__seoAiAppliedClientSide = false;
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
      log("mode:", "ssr-only");
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

      // NEVER apply client-side overrides in this theme.
      applySeo(seo);

      var appliedClientSide = !!window.__seoAiAppliedClientSide;

      // 🔁 Make a shallow copy for logging and add human-readable date, if available
      var seoForLog = seo || {};
      try {
        if (typeof seoForLog.last_generated === "number") {
          // last_generated expected to be ms since epoch
          seoForLog.last_generated_human = new Date(seoForLog.last_generated).toISOString();
        }
      } catch (e) {
        // If anything goes wrong, just don't add the human-readable field
      }

      // 🔥 SINGLE CONSOLE ITEM:
      // prompt + results + SSR vs client-side info
      console.log(JSON.stringify({
        source: "srm-seo-agent",   // renamed from "seo-ai"
        pageUrl: location.href,
        mode: "ssr-only",
        prompt: {
          preview: preview,
          company: company
        },
        ssr: ssrSnapshot,
        worker: {
          status: res.status,
          seo: seoForLog
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

  // Manual hook for testing (respects SSR-only no-op behavior)
  window.__applySeoAgent = applySeo;
})();
