// ======================= highlight-content.js =======================
// Inyectado en la HCE. Resalta términos positivos y negados acumulativamente.
// Clases CSS usadas:
//  - .medreg-hl      -> hallazgos positivos
//  - .medreg-hl-neg  -> hallazgos negados

(function () {
  const CLS_POS = 'medreg-hl';
  const CLS_NEG = 'medreg-hl-neg';

  // Inserta estilos una sola vez
  function ensureStyles() {
    if (document.getElementById('medreg-hl-style')) return;
    const st = document.createElement('style');
    st.id = 'medreg-hl-style';
    st.textContent = `
      .${CLS_POS} { background: #fff59d; outline: 1px solid rgba(0,0,0,.15); padding: 0 .05em; border-radius: 2px; }
      .${CLS_NEG} { background: #ffcccc; outline: 1px solid rgba(0,0,0,.15); padding: 0 .05em; border-radius: 2px; }
      .medreg-hl-scrollfocus { animation: medreg-pulse 1.2s ease-out 1; }
      @keyframes medreg-pulse {
        0% { box-shadow: 0 0 0 0 rgba(33,150,243,.6); }
        100% { box-shadow: 0 0 0 6px rgba(33,150,243,0); }
      }
    `;
    document.documentElement.appendChild(st);
  }
  ensureStyles();

  // Limpia TODOS los resaltados o solo por clase
  function clearHighlights(cls) {
    const sel = cls ? `.${cls}` : `.${CLS_POS}, .${CLS_NEG}`;
    document.querySelectorAll(sel).forEach(sp => {
      const parent = sp.parentNode;
      if (!parent) return;
      // Reemplaza el span por su contenido de texto
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
      parent.normalize && parent.normalize();
    });
  }

  // Escapa regex
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Crea un TreeWalker para texto visible
  function textWalker(root) {
    return document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          // evitar inputs, scripts, styles, etc
          const ban = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|TEXTAREA|INPUT|SELECT|OPTION)$/;
          if (ban.test(tag)) return NodeFilter.FILTER_REJECT;
          // evitar ya resaltados
          if (p.classList && (p.classList.contains(CLS_POS) || p.classList.contains(CLS_NEG))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );
  }

  // Marca términos con una clase (ACUMULATIVO). No limpia aquí.
  function markWithClass(terms, cls, { scroll } = {}, root = document.body) {
    if (!terms || !terms.length) return 0;

    // Normaliza y deduplica términos
    const uniq = Array.from(new Set(
      terms.map(t => (t || '').trim()).filter(Boolean)
    ));
    if (!uniq.length) return 0;

    let total = 0;
    const rx = new RegExp(`\\b(${uniq.map(esc).join('|')})\\b`, 'gi');

    const tw = textWalker(root);
    const nodes = [];
    while (tw.nextNode()) nodes.push(tw.currentNode);

    nodes.forEach(node => {
      const text = node.nodeValue;
      if (!rx.test(text)) return;
      rx.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = rx.exec(text)) !== null) {
        const before = text.slice(last, m.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const span = document.createElement('span');
        span.className = cls;
        span.textContent = m[0];
        frag.appendChild(span);

        last = m.index + m[0].length;
        total++;
      }
      const after = text.slice(last);
      if (after) frag.appendChild(document.createTextNode(after));

      node.parentNode.replaceChild(frag, node);
    });

    if (scroll && total) {
      const target = document.querySelector(`.${cls}`);
      if (target) {
        target.classList.add('medreg-hl-scrollfocus');
        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        setTimeout(() => target.classList.remove('medreg-hl-scrollfocus'), 1200);
      }
    }
    return total;
  }

  // ==== Mensajería ====
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (!msg || !msg.action) return;
      if (msg.action === 'clearHighlights') {
        // limpia todo o por clase si viene msg.cls
        clearHighlights(msg.cls);
        sendResponse && sendResponse({ ok: true });
        return;
      }
      if (msg.action === 'highlightMany') {
        ensureStyles();
        const count = markWithClass(msg.terms || [], CLS_POS, { scroll: !!msg.scroll });
        sendResponse && sendResponse({ ok: true, count });
        return;
      }
      if (msg.action === 'highlightNegados') {
        ensureStyles();
        const count = markWithClass(msg.terms || [], CLS_NEG, { scroll: !!msg.scroll });
        sendResponse && sendResponse({ ok: true, count });
        return;
      }
    } catch (e) {
      sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
    }
  });
})();
