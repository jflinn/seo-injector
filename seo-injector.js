
// --- SEO agent: grouped block injection (title + meta description + keywords + OG) + MutationObserver ---
(function() {
  let _isUpdating = false;
  let _observer;
  const START_MARK = 'seo-agent-start';
  const END_MARK = 'seo-agent-end';
  const DATA_ATTR = 'data-seo-agent';

  function esc(s=''){ return String(s == null ? '' : s).trim(); }

  function findExistingBlock(head) {
    // Find comment node start and end, or fallback to elements with data-seo-agent
    let startNode = null, endNode = null;
    for (const n of head.childNodes) {
      if (n.nodeType === Node.COMMENT_NODE && n.data && n.data.trim() === START_MARK) startNode = n;
      if (n.nodeType === Node.COMMENT_NODE && n.data && n.data.trim() === END_MARK) endNode = n;
      if (startNode && endNode) break;
    }
    if (startNode && endNode) {
      // collect nodes between start and end inclusive
      const nodes = [];
      let cur = startNode;
      while (cur) {
        nodes.push(cur);
        if (cur === endNode) break;
        cur = cur.nextSibling;
      }
      return nodes;
    }
    // fallback: find elements flagged with data-seo-agent
    const flagged = Array.from(head.querySelectorAll(`[${DATA_ATTR}="true"]`));
    return flagged.length ? flagged : null;
  }

  function removeExistingBlock(head) {
    const blockNodes = findExistingBlock(head);
    if (blockNodes && blockNodes.length) {
      for (const n of blockNodes) {
        try { n.remove(); } catch(e) {}
      }
    }
    // Also remove any stray data-seo-agent attributes elsewhere just in case
    Array.from(head.querySelectorAll(`[${DATA_ATTR}="true"]`)).forEach(el => el.remove());
  }

  function buildSeoFragment(seo) {
    const frag = document.createDocumentFragment();
    // start comment
    frag.appendChild(document.createComment(START_MARK));

    // Title element (with marker)
    if (seo.meta_title && seo.meta_title.trim()) {
      const titleEl = document.createElement('title');
      titleEl.setAttribute(DATA_ATTR, 'true');
      titleEl.textContent = esc(seo.meta_title.trim());
      frag.appendChild(titleEl);
    }

    // Description meta
    if (seo.meta_description && seo.meta_description.trim()) {
      const desc = document.createElement('meta');
      desc.setAttribute('name', 'description');
      desc.setAttribute('content', esc(seo.meta_description.trim()));
      desc.setAttribute(DATA_ATTR, 'true');
      frag.appendChild(desc);
    }

    // Keywords meta (if provided)
    if (Array.isArray(seo.keywords) && seo.keywords.length) {
      const kw = document.createElement('meta');
      kw.setAttribute('name', 'keywords');
      kw.setAttribute('content', seo.keywords.map(k => esc(k)).filter(Boolean).join(', '));
      kw.setAttribute(DATA_ATTR, 'true');
      frag.appendChild(kw);
    }

    // OG title + OG description
    if (seo.meta_title && seo.meta_title.trim()) {
      const ogt = document.createElement('meta');
      ogt.setAttribute('property', 'og:title');
      ogt.setAttribute('content', esc(seo.meta_title.trim()));
      ogt.setAttribute(DATA_ATTR, 'true');
      frag.appendChild(ogt);
    }
    if (seo.meta_description && seo.meta_description.trim()) {
      const ogd = document.createElement('meta');
      ogd.setAttribute('property', 'og:description');
      ogd.setAttribute('content', esc(seo.meta_description.trim()));
      ogd.setAttribute(DATA_ATTR, 'true');
      frag.appendChild(ogd);
    }

    // end comment
    frag.appendChild(document.createComment(END_MARK));
    return frag;
  }

  function applySeoBlock(seo) {
    if (!seo) return;
    const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    if (!head) return;

    _isUpdating = true;
    stopHeadObserver();

    try {
      // Remove previous block (if any)
      removeExistingBlock(head);

      // Build new grouped fragment and insert at top of head
      const frag = buildSeoFragment(seo);
      // insert at very top so it is the first meta information
      head.insertBefore(frag, head.firstChild);

      // Also set document.title (keeps title in sync for browsers)
      if (seo.meta_title && seo.meta_title.trim()) {
        document.title = esc(seo.meta_title.trim());
      }
    } finally {
      _isUpdating = false;
      // restart observer to protect the block
      startHeadObserver(() => {
        try { window.__applySeoAgent && window.__applySeoAgent(seo); } catch(e){}
      });
    }
  }

  // Observer that watches for removals/changes to the grouped block and re-applies.
  function startHeadObserver(reapplyFn) {
    if (typeof MutationObserver === 'undefined') return;
    const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    let timer = null;

    _observer = new MutationObserver(mutations => {
      if (_isUpdating) return;
      // if the grouped block is missing or any flagged elements were changed/removed, reapply
      const anyFlagged = head.querySelectorAll(`[${DATA_ATTR}="true"]`).length > 0;
      // detect missing block quickly via comment markers
      let hasStart = false, hasEnd = false;
      for (const n of head.childNodes) {
        if (n.nodeType === Node.COMMENT_NODE && n.data && n.data.trim() === START_MARK) hasStart = true;
        if (n.nodeType === Node.COMMENT_NODE && n.data && n.data.trim() === END_MARK) hasEnd = true;
        if (hasStart && hasEnd) break;
      }
      if (!anyFlagged || !hasStart || !hasEnd) {
        clearTimeout(timer);
        timer = setTimeout(reapplyFn, 150);
        return;
      }

      // Also watch attribute modifications on flagged elements
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target && m.target.matches && m.target.matches(`[${DATA_ATTR}="true"]`)) {
          clearTimeout(timer);
          timer = setTimeout(reapplyFn, 150);
          return;
        }
        if (m.type === 'childList') {
          // additions/removals may have disturbed the block
          if (m.addedNodes.length || m.removedNodes.length) {
            // if any added/removed node is inside head, recheck
            clearTimeout(timer);
            timer = setTimeout(reapplyFn, 150);
            return;
          }
        }
      }
    });

    _observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
  }

  function stopHeadObserver() {
    if (_observer) {
      try { _observer.disconnect(); } catch(e){}
      _observer = null;
    }
  }

  // Expose global helper (keeps compatibility with your existing injectSEO)
  window.__applySeoAgent = function(seo) {
    if (!seo) return;
    applySeoBlock(seo);
  };

  // cleanup on unload
  window.addEventListener('unload', () => { stopHeadObserver(); });
})();



/* --- Your injectSEO (unchanged behavior) --- */
async function injectSEO() {
  try {
    if (!document.body) {
      await new Promise(resolve => window.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const safePageContent = (document.body && (document.body.innerText || "")) ? String(document.body.innerText).slice(0, 2000) : "";

    const company = window.SEO_COMPANY || {
      name: '',
      description: '',
      email: '',
      phone: '',
      url: '',
      currency: ''
    };

    const res = await fetch("https://seo-ai.jeff-552.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageUrl: window.location.href,
        pageContent: safePageContent,
        company
      })
    });

    let seo = {};
    try { seo = await res.json(); } catch (e) { console.warn("SEO Worker returned non-JSON or invalid body:", e); return; }

    console.log("SRM SEO AI Agent return:", seo);

    // Apply grouped SEO block
    try { if (window.__applySeoAgent && seo) window.__applySeoAgent(seo); } catch (e) { console.warn('Applying SEO via __applySeoAgent failed:', e); }

    // Fallback: keywords handling (kept for compatibility)
    const existingKeywordsEl = document.querySelector('meta[name="keywords"]');
    if (seo && Array.isArray(seo.keywords) && seo.keywords.length > 0) {
      let kwTag = existingKeywordsEl;
      if (!kwTag) {
        kwTag = document.createElement('meta');
        kwTag.setAttribute('name', 'keywords');
        document.head.appendChild(kwTag);
      }
      kwTag.setAttribute('content', seo.keywords.map(k => String(k).trim()).filter(Boolean).join(', '));
    }
  } catch (err) {
    console.error("SEO injection failed:", err);
  }
}

injectSEO();
document.addEventListener('shopify:section:load', injectSEO);
document.addEventListener('shopify:navigation:end', injectSEO);
