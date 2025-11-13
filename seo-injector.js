/*!
 * SEO Injector (SSR-only, quiet version)
 * - NO calls to the Worker from the browser.
 * - Uses window.__lastSeoAi set by Liquid/SSR.
 * - Applies meta tags to <head> and re-applies on Shopify soft navigation events.
 * - Console output:
 *    - ONLY when metadata is applied:
 *        [SEO AI] Applied SSR metadata: { ...json... }
 *        [SEO AI] Fields applied: meta_title, meta_description, ...
 */

(function () {
  "use strict";

  /*** CONFIG ***/
  // Debug flag (can be pre-set via window.seoAiDebug = true)
  // Default: false to keep console clean.
  var DEBUG = (typeof window.seoAiDebug === "boolean") ? window.seoAiDebug : false;

  /*** LOG HELPERS (only used when DEBUG=true, except final applied logs) ***/
  var log   = function () { if (DEBUG) console.log.apply(console, arguments); };
  var warn  = function () { if (DEBUG) console.warn.apply(console, arguments); };
  var error = function () { if (DEBUG) console.error.apply(console, arguments); };

  /*** GLOBAL HOOKS ***/
  // Last SEO object and helper to reprint it manually if you want.
  window.__lastSeoAi = window.__lastSeoAi || null;
  window.__printSeoAi = function () {
    try {
      if (!window.__lastSeoAi) {
        console.log("{}");
        return;
      }
      console.log(JSON.stringify(window.__lastSeoAi, null, 4));
    } catch (e) {
      console.log("{}");
    }
  };

  /*** UTILITIES ***/
  var START = "seo-agent-start",
      END   = "seo-agent-end",
      ATTR  = "data-seo-agent";

  var BAD = new Set(["false", "null", "undefined", "n/a", "none", "0"]);

  var esc = function (s) { return String(s == null ? "" : s).trim(); };
  var ok  = function (s) {
    var v = esc(s);
    return !!v && !BAD.has(v.toLowerCase());
  };

  function removeBlock(head) {
    var start = null, end = null;

    // Find our comment block markers
    for (var i = 0; i < head.childNodes.length; i++) {
      var n = head.childNodes[i];
      if (n.nodeType === 8 && n.data && n.data.trim() === START) start = n;
      if (n.nodeType === 8 && n.data && n.data.trim() === END)   end   = n;
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

  var _observer = null;
  var _isUpdating = false;

  function startObserver(reapply) {
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

      // If our block vanished, reapply SSR meta
      if (!flagged || !hasS || !hasE) {
        clearTimeout(timer);
        timer = setTimeout(reapply, 150);
      }
    });

    _observer.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["content"]
    });
  }

  function stopObserver() {
    if (_observer) {
      try { _observer.disconnect(); } catch (e) {}
      _observer = null;
    }
  }

  function applySeo(seo) {
    var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    if (!head || !seo) return;

    _isUpdating = true;
    stopObserver();

    try {
      removeBlock(head);
      head.insertBefore(buildFrag(seo), head.firstChild);
      if (ok(seo.meta_title)) {
        document.title = esc(seo.meta_title);
      }
    } finally {
      _isUpdating = false;
      startObserver(function () {
        try { applySeo(seo); }
        catch (e) { warn("[SEO] reapply error", e); }
      });
    }
  }

  // === SSR-only apply: use window.__lastSeoAi, no Worker calls ===
  function applyFromSSR() {
    try {
      var seo = window.__lastSeoAi || {};

      var titleOk = ok(seo.meta_title);
      var descOk  = ok(seo.meta_description);
      var usable  = titleOk || descOk;

      if (!usable) {
        log("[SEO AI] No usable SSR metadata (window.__lastSeoAi).");
        return;
      }

      var appliedFields = [];
      if (titleOk) appliedFields.push("meta_title");
      if (descOk)  appliedFields.push("meta_description");
      if (Array.isArray(seo.keywords) && seo.keywords.length) appliedFields.push("keywords");
      if (Array.isArray(seo.tags) && seo.tags.length)         appliedFields.push("tags");

      applySeo(seo);

      window.__lastSeoAi = seo;
      console.log("[SEO AI] Applied SSR metadata:", JSON.stringify(seo, null, 2));
      console.log("[SEO AI] Fields applied:", appliedFields.join(", "));

    } catch (err) {
      error("[SEO] SSR injection failed:", err);
    }
  }

  // Run once DOM is ready, using SSR data only
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(applyFromSSR, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(applyFromSSR, 0);
    }, { once: true });
  }

  // Re-run on Shopify soft navigations using the SAME SSR payload
  document.addEventListener("shopify:section:load", applyFromSSR);
  document.addEventListener("shopify:navigation:end", applyFromSSR);

  // Manual hook for testing
  window.__applySeoAgent = applySeo;
})();
