// ===================== MedReg Sidebar  medreg_local_demo.js =====================

let estudios = JSON.parse(localStorage.getItem("estudiosMedReg") || "{}");
// terminología base (archivo) + terminología agregada por el usuario
let baseAutocompletado = [];
const USER_TERMS_KEY = 'medreg.userTerms_v1';

let terminologiaMedica = {};
const STORAGE_KEY_EXTRACT = "medreg.extractions";
const API_BASE = (localStorage.getItem('medreg_api') || 'https://medreg-backend.onrender.com').replace(/\/+$/,'');
const NOTAS_KEY = 'medreg_notas_v1';

// ===== Registro de casos (sesiÃ³n)
const SESSION_ROWS_KEY = 'medreg.session_rows_v1';



async function loadUserTerms() {
  let extra = [];
  try {
    const st = await chrome?.storage?.sync?.get(USER_TERMS_KEY) || {};
    if (Array.isArray(st[USER_TERMS_KEY])) extra = st[USER_TERMS_KEY];
  } catch (e) {
    try {
      extra = JSON.parse(localStorage.getItem(USER_TERMS_KEY) || "[]");
    } catch (_) {}
  }
  return extra;
}

async function saveUserTerms(extra) {
  try {
    await chrome?.storage?.sync?.set({ [USER_TERMS_KEY]: extra });
  } catch (e) {
    try {
      localStorage.setItem(USER_TERMS_KEY, JSON.stringify(extra));
    } catch (_) {}
  }
}


// ===================== Drag&Drop para Extracciones y Chat =====================
(function enableDragDropForExtractionsAndChat(){
  function normalizeText(s){
    if(!s) return '';
    return s.replace(/\u00A0/g,' ')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
  }
  async function getTextFromDataTransfer(dt){
    let t = dt.getData?.('text/plain');
    if(t) return t;
    if(dt.items && dt.items.length){
      for(const it of dt.items){
        if(it.kind === 'string' && it.type === 'text/plain'){
          t = await new Promise(res=>it.getAsString(res));
          if(t) return t;
        }
      }
    }
    if(dt.files && dt.files.length){
      const f = dt.files[0];
      if(f && f.type.startsWith('text/')) return await f.text();
    }
    const html = dt.getData?.('text/html');
    if(html){
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || '';
    }
    return '';
  }
  function makeDropTarget(rootEl, {onText, highlightClass='dragover'}){
    if(!rootEl) return;
    const onEnterOver = (e)=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      rootEl.classList.add(highlightClass);
    };
    const onLeaveEnd = ()=> rootEl.classList.remove(highlightClass);

    rootEl.addEventListener('dragenter', onEnterOver, {capture:true});
    rootEl.addEventListener('dragover', onEnterOver, {capture:true});
    rootEl.addEventListener('dragleave', onLeaveEnd, {capture:true});
    rootEl.addEventListener('dragend', onLeaveEnd, {capture:true});
    rootEl.addEventListener('drop', async (e)=>{
      e.preventDefault(); onLeaveEnd();
      const raw = await getTextFromDataTransfer(e.dataTransfer);
      const txt = normalizeText(raw);
      if(txt) onText(txt);
    }, {capture:true});
    rootEl.addEventListener('paste', (e)=>{
      const pasted = e.clipboardData?.getData('text/plain');
      if(pasted){
        e.preventDefault();
        const txt = normalizeText(pasted);
        if(txt) onText(txt);
      }
    });
  }

  // handler real para agregar extracciÃ³n
  const addExtraction =
    window.addManualExtraction
    || window.addToExtractionList
    || function(txt){
         window.dispatchEvent(new CustomEvent('medreg:addExtraction', {detail:{ text: txt }}));
       };

  const extractionBox = document.getElementById('extractionList') || document.getElementById('extractionsList');
if (extractionBox) {
  makeDropTarget(extractionBox, { onText: (txt)=> addExtraction(txt) });


  window.makeDropTarget = makeDropTarget;
}

// Chat: permitir Pegar, pero bloquear Drag&Drop para evitar duplicados
const chatBox = document.getElementById('ai-chat-composer');
const chatInput =
  document.querySelector('#ai_question, #chatInput, #chat-textarea, textarea#chat, #iaInput, .ai-input textarea, #aiChatInput, #ai-chat-input')
  || document.querySelector('#ai-chat-composer textarea, #ai-chat-composer input[type="text"]');

if (chatBox) {
  // bloquear dragover/drop
  chatBox.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='none'; }, {capture:true});
  chatBox.addEventListener('drop', (e)=>{ e.preventDefault(); }, {capture:true});

  // pero permitir Pegar (clipboard → al input)
  chatBox.addEventListener('paste', (e)=>{
    const pasted = e.clipboardData?.getData('text/plain');
    if (pasted && chatInput) {
      e.preventDefault();
      const sep = chatInput.value?.trim()?.length ? '\n\n' : '';
      chatInput.value = (chatInput.value || '') + sep + pasted.trim();
      try{ chatInput.focus(); }catch(_){}
    }
  }, {capture:true});
}})();

async function addManualExtractionImpl(txt, meta = {}) {
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    tabId: meta.tabId || null,
    title: meta.title || "Pegado / Drop manual",
    url: meta.url || "",
    timestamp: Date.now(),
    rawText: String(txt || ""),
    classified: null,
  };
  const list = await loadExtractions();
  list.unshift(item);
  await saveExtractions(list);
  renderExtractions(list);
}
window.addManualExtraction = addManualExtractionImpl;

window.addEventListener('medreg:addExtraction', async (e)=>{
  const txt = e.detail?.text;
  if(!txt) return;
  await addManualExtractionImpl(txt);
});


function syncExtractionWidth(){
  // Mantener 100% por CSS; no fuerces width en px para evitar 0px en montajes tempranos
  const panel = document.getElementById('extractionList');
  if (panel) panel.style.width = ''; // limpia cualquier width inline previo
}
window.addEventListener('resize', syncExtractionWidth);
document.addEventListener('DOMContentLoaded', syncExtractionWidth);
setTimeout(syncExtractionWidth, 200);



//////////////////////////////////////////////////////////////////////////// 01-11
// Al final del IIFE de drag&drop o en DOMContentLoaded:
(function enableDnDInvestigador(){
  const root = document.getElementById('extractionListInv');
  if (!root) return;

  function addInv(text) {
    window.dispatchEvent(new CustomEvent('medreg:addExtractionInv', { detail: { text } }));
  }
  // Reuso la infra existente de DnD/paste
  if (typeof makeDropTarget === 'function') {
    makeDropTarget(root, { onText: (txt) => addInv(txt) });
  }

  // Handler para agregar items a la lista INV
  window.addEventListener('medreg:addExtractionInv', async (e) => {
    const text = (e.detail?.text || '').trim();
    if (!text) return;
    const all = await loadInvExtractions();
    all.unshift({ id: crypto.randomUUID(), rawText: text, ts: Date.now() });
    await saveInvExtractions(all);
    renderInvExtractions(all);
  });
})();



document.getElementById('btnExtractHCInv')?.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !isInjectableUrl(tab.url)) {
      alert('Abrí la HCE en una pestaña http/https para extraer.');
      return;
    }
    const ok = await ensureContentScript(tab.id);
    if (!ok) { alert('No pude conectar con la página. Probá recargar.'); return; }

    const resp = await new Promise(res => {
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'MEDREG_EXTRACT_DOM' },
        r => { void chrome.runtime.lastError; res(r || null); }
      );
    });


    
    const raw = (resp?.rawText || resp?.text || '').trim();
    if (!raw) { alert('No encontré texto en la HCE.'); return; }

const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// ...luego de obtener `raw`:
const all = await loadInvExtractions();

// 🚫 Si ya existe una extracción igual, no la agregamos
if (all.some(x => norm(x.rawText) === norm(raw))) {
  toast('Esa extracción ya estaba en la lista', 'warn');
  return;
}

all.unshift({ id: (crypto.randomUUID?.() || String(Date.now())), rawText: raw, ts: Date.now() });
await saveInvExtractions(all);
renderInvExtractions(all);

    // asegurar que quede visible el bloque de extracciones y el row de análisis
    document.getElementById('investigadorExtractions')?.style.removeProperty('display');
  document.getElementById('investigadorAnalisisRow')?.style.removeProperty('display');
  SidebarBscrollottom(); // hacer scroll al final del sidebar
  } catch (e) {
    console.error('[MedReg] Extraer HC (Inv):', e);
  }
});


document.getElementById('btnAnalizar')?.addEventListener('click', () => {
  // damos un pequeño margen para que aparezca la nueva extracción y luego scrolleamos
  setTimeout(scrollSidebarBottom, 150);
  document.getElementById('investigadorExtractions')?.style.removeProperty('display');
  document.getElementById('investigadorAnalisisRow')?.style.removeProperty('display');
    SidebarBscrollottom(); // hacer scroll al final del sidebar
});

///////////////////////////////////////////////////////////////////////////////////////


// === Negaciones v3: misma lÃ­nea + â€œno â€¦, X, ni Yâ€ ===
const NEGADORES = ["niega","niega:","no","sin","descarta","niega antecedentes","niega antecedentes de"];
const ANULADORES = ["excepto","pero","aunque","salvo","sin embargo"];
function negacionListaNiega(beforeText) { return /\bniega(\s+antecedentes(\s+de)?)?\b\s*:?\s*$/i.test(beforeText); }
function negadorAntesEnMismaLinea(beforeText) {
  const rxNeg = /\b(niega(?:\s+antecedentes(?:\s+de)?)?|no|sin|descarta)\b/gi;
  let m, lastIdx = -1;
  while ((m = rxNeg.exec(beforeText)) !== null) lastIdx = m.index;
  if (lastIdx < 0) return false;
  const scope = beforeText.slice(lastIdx);
  if (/\b(excepto|pero|aunque|salvo|sin embargo)\b/i.test(scope)) return false;
  return true;
}
function isNegatedForTerm(text, matchIndex) {
  const raw = text || "";
  const lineStart = raw.lastIndexOf("\n", matchIndex);
  const lineEnd   = raw.indexOf("\n", matchIndex);
  const start = lineStart === -1 ? 0 : lineStart + 1;
  const end   = lineEnd   === -1 ? raw.length : lineEnd;
  const lineFull = raw.slice(start, end);
  const before   = sinAcentos(lineFull.slice(0, matchIndex - start));
  if (negacionListaNiega(before)) return true;
  if (negadorAntesEnMismaLinea(before)) return true;
  return false;
}

// ===================== Utils =====================
function sinAcentos(s) { return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
function fmt(ts) { try { return new Date(ts).toLocaleString(); } catch { return String(ts); } }
function lev(a, b) {
  a = sinAcentos(a); b = sinAcentos(b);
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i - 1] === a[j - 1]
        ? m[i - 1][j - 1]
        : Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + 1);
    }
  }
  return m[b.length][a.length];
}

// ===================== Carga de terminologÃ­a (incluye subcategorÃ­a) =====================
// ===================== Carga de terminologÃ­a (+sub2 y otros Ã­ndices) =====================
// ===== Ã­ndices globales =====
let termIndex = {
  byKey: new Map(),      // keyNorm -> { categoria, clave, sinonimos[], subcategoria, sub2 }
  byCat: new Map(),      // catNorm -> Map(keyNorm -> ref)
  bySub2: new Map(),     // sub2Norm -> Set<string> (claves y sinÃ³nimos)
  bySubcat: new Map()    // subcatNorm -> Set<string> (claves)
};
let canonIndex = new Map(); // termNorm -> clave canÃ³nica

function putCanon(term, claveCanon) {
  if (!term) return;
  const k = sinAcentos(term);
  if (!canonIndex.has(k)) canonIndex.set(k, claveCanon);
}
function resolveCanon(term) {
  return canonIndex.get(sinAcentos(term)) || term;
}

async function cargarTerminologia() {
  if (Object.keys(terminologiaMedica).length) return baseAutocompletado;

  const resp = await fetch("terminologia_medica.json");
  const lista = await resp.json();

  terminologiaMedica = {};
  termIndex = { byKey: new Map(), byCat: new Map(), bySub2: new Map(), bySubcat: new Map() };
  canonIndex = new Map();
  const base = [];

  for (const item of lista) {
    const cat = item.categoria;
    const subcat = item.subcategoria || cat;
    const sub2 = item.sub2 || "";
    const clave = item.clave;
    const sinonimos = (item.sinonimos || []).filter(Boolean);

    const catNorm = sinAcentos(cat || "");
    const keyNorm = sinAcentos(clave);
    const subcatNorm = sinAcentos(subcat);
    const sub2Norm = sinAcentos(sub2);

    // estructura para UI
    if (!terminologiaMedica[cat]) terminologiaMedica[cat] = {};
    terminologiaMedica[cat][clave] = sinonimos;
    base.push({ categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    // Ã­ndices
    if (!termIndex.byCat.has(catNorm)) termIndex.byCat.set(catNorm, new Map());
    termIndex.byCat.get(catNorm).set(keyNorm, { categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    termIndex.byKey.set(keyNorm, { categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    // bySub2: familia â†’ claves+sinÃ³nimos
    if (sub2) {
      if (!termIndex.bySub2.has(sub2Norm)) termIndex.bySub2.set(sub2Norm, new Set());
      termIndex.bySub2.get(sub2Norm).add(clave);
      sinonimos.forEach(s => termIndex.bySub2.get(sub2Norm).add(s));
    }

    // bySubcat: subcategorÃ­a â†’ claves
    if (!termIndex.bySubcat.has(subcatNorm)) termIndex.bySubcat.set(subcatNorm, new Set());
    termIndex.bySubcat.get(subcatNorm).add(clave);

    // canonizador: clave y sinÃ³nimos â†’ clave canÃ³nica
    putCanon(clave, clave);
    sinonimos.forEach(s => putCanon(s, clave));
  }

    // Después de armar la base desde terminologia_medica.json
  const extras = await loadUserTerms();
  const norm = s => sinAcentos(s || '');
  const seen = new Set(base.map(it => `${norm(it.categoria)}|${norm(it.clave)}`));

  for (const item of extras) {
    if (!item || !item.categoria || !item.clave) continue;
    const key = `${norm(item.categoria)}|${norm(item.clave)}`;
    if (seen.has(key)) continue;   // no duplicar
    seen.add(key);

    const cat      = item.categoria;
    const subcat   = item.subcategoria || cat;
    const sub2     = item.sub2 || "";
    const clave    = item.clave;
    const sinonimos = (item.sinonimos || []).filter(Boolean);

    base.push({ categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    // actualizar índices igual que hacés con la base
    const catNorm    = sinAcentos(cat || "");
    const keyNorm    = sinAcentos(clave);
    const subcatNorm = sinAcentos(subcat);
    const sub2Norm   = sinAcentos(sub2);

    if (!terminologiaMedica[cat]) terminologiaMedica[cat] = {};
    if (!terminologiaMedica[cat][clave]) terminologiaMedica[cat][clave] = sinonimos;

    if (!termIndex.byCat.has(catNorm)) termIndex.byCat.set(catNorm, new Map());
    termIndex.byCat.get(catNorm).set(keyNorm, { categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    termIndex.byKey.set(keyNorm, { categoria: cat, clave, sinonimos, subcategoria: subcat, sub2 });

    if (sub2) {
      if (!termIndex.bySub2.has(sub2Norm)) termIndex.bySub2.set(sub2Norm, new Set());
      termIndex.bySub2.get(sub2Norm).add(clave);
      sinonimos.forEach(s => termIndex.bySub2.get(sub2Norm).add(s));
    }

    if (!termIndex.bySubcat.has(subcatNorm)) termIndex.bySubcat.set(subcatNorm, new Set());
    termIndex.bySubcat.get(subcatNorm).add(clave);

    putCanon(clave, clave);
    sinonimos.forEach(s => putCanon(s, clave));
  }

  baseAutocompletado = base;
  localStorage.setItem("baseAutocompletado", JSON.stringify(baseAutocompletado));

  try { if (typeof rebuildIndices === "function") rebuildIndices(); } catch(e) { console.warn("rebuildIndices error", e); }
  return baseAutocompletado;
}


// Devuelve una LISTA de claves canÃ³nicas destino para un criterio elegido
function resolverDestinosParaCriterio(categoria, elegido) {
  const out = new Set();
  const eNorm = sinAcentos(elegido || "");
  const catNorm = sinAcentos(categoria || "");

  // 1) Â¿Es una clave o sinÃ³nimo? â†’ clave canÃ³nica
  const canon = canonIndex.get(eNorm);
  if (canon) {
    out.add(canon);
    return Array.from(out);
  }

  // 2) Â¿Coincide con una subcategorÃ­a? â†’ todas sus claves
  const sBySubcat = termIndex.bySubcat.get(eNorm);
  if (sBySubcat && sBySubcat.size) {
    sBySubcat.forEach(k => out.add(k));
    return Array.from(out);
  }

  // 3) Â¿Coincide con un sub2? â†’ todas sus claves (via bySub2 pero filtrar a la categorÃ­a si querÃ©s)
  const sBySub2 = termIndex.bySub2.get(eNorm);
  if (sBySub2 && sBySub2.size) {
    // agrego SOLO claves (no sinÃ³nimos) cuando existan en la categorÃ­a
    const catMap = termIndex.byCat.get(catNorm) || new Map();
    for (const t of sBySub2) {
      const tNorm = sinAcentos(typeof t === "string" ? t : "");
      const row = catMap.get(tNorm) || termIndex.byKey.get(tNorm);
      if (row?.clave) out.add(row.clave);
    }
    if (out.size) return Array.from(out);
  }

  // 4) Fallback: si nada matchea, devolvemos el propio texto como â€œclaveâ€
  out.add(elegido);
  return Array.from(out);
}

// ===================== Reglas de cruce (inferencias) =====================
// ===================== Reglas de cruce (inferencias) =====================
let reglasInferIndex = new Map(); // destinoNorm -> Set(orÃ­genes a buscar)

async function cargarReglasCruce() {
  try {
    const r = await fetch("reglas_cruce.json", { cache: "no-store" });
    const json = await r.json();

    reglasInferIndex = new Map();

    // utilidades
    const norm = (s)=> (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const ensureSet = (dest) => {
      const d = norm(dest);
      if (!reglasInferIndex.has(d)) reglasInferIndex.set(d, new Set());
      return reglasInferIndex.get(d);
    };
    const addTerm = (set, t) => { if (t) set.add(t); };

    // expande el "if" a una lista de tÃ©rminos reales (claves + sinÃ³nimos)
    function expandIfToTerms(src){
      const out = new Set();
      if (!src?.cat) return Array.from(out);
      const catNorm = norm(src.cat);

      // 1) por clave explÃ­cita
      if (src.clave) {
        const row = termIndex.byKey.get(norm(src.clave));
        if (row) {
          addTerm(out, row.clave);
          (row.sinonimos||[]).forEach(s => addTerm(out, s));
        } else {
          addTerm(out, src.clave);
        }
      }

      // 2) por subcategoria
      const subcat = src.subcategoria || src.sub; // aceptar ambos nombres
      if (subcat) {
        const sc = termIndex.bySubcat.get(norm(subcat));
        if (sc && sc.size) {
          sc.forEach(k=>{
            const row = termIndex.byKey.get(norm(k));
            if (row && norm(row.categoria)===catNorm){
              addTerm(out, row.clave);
              (row.sinonimos||[]).forEach(s=> addTerm(out, s));
            }
          });
        }
      }

      // 3) por sub2 (familia)
      if (src.sub2) {
        const fam = termIndex.bySub2.get(norm(src.sub2));
        if (fam && fam.size) {
          fam.forEach(t=>{
            const row = termIndex.byKey.get(norm(t));
            if (row && norm(row.categoria)===catNorm){
              addTerm(out, row.clave);
              (row.sinonimos||[]).forEach(s=> addTerm(out, s));
            } else {
              addTerm(out, t);
            }
          });
        }
      }
      return Array.from(out);
    }

    // A) soporte formato if/then (el actual)
    if (Array.isArray(json)) {
      for (const rule of json) {
        if (!rule?.if || !Array.isArray(rule?.then)) continue;
        const origenes = expandIfToTerms(rule.if);
        for (const dst of rule.then) {
          if (!dst?.clave) continue;
          const set = ensureSet(dst.clave);
          origenes.forEach(t => set.add(t));
        }
      }
    }

    // B) compatibilidad con formatos viejos (opcionales)
    if (json && !Array.isArray(json)) {
      for (const [dest, arr] of Object.entries(json || {})) {
        const set = ensureSet(dest);
        (arr||[]).forEach(t => set.add(t));
      }
    }

  } catch (e) {
    console.warn("[MedReg] No pude cargar reglas_cruce.json:", e);
  }
}

// ===================== NavegaciÃ³n entre secciones =====================
function showOnly(section) {
  const map = {
    registro: document.getElementById("registroLocalSection"),
    protocolos: document.getElementById("protocolosSection"),
    chat: document.getElementById("chatSection"),
    notas: document.getElementById("notasSection"),
    agenda: document.getElementById("agendaSection"),
        agente: document.getElementById("agenteDeepSection"),
  };
  Object.values(map).forEach(el => { if (el) el.style.display = "none"; });
  if (section && map[section]) map[section].style.display = "";

  const btns = [
    ["btnRegistroLocal","registro"],
    ["btnProtocolos","protocolos"],
    ["btnChatIA","chat"],
    ["btnNotas","notas"],
    ["btnAgenda","agenda"],
       ["btnAgenteDeep","agente"],
  ];
  btns.forEach(([id, sec]) => {
    const b = document.getElementById(id);
    if (!b) return;
    if (section === sec) b.classList.add("active"); else b.classList.remove("active");
  });
}

// ===================== Extracciones (historial) =====================
async function loadExtractions() {
  const { [STORAGE_KEY_EXTRACT]: arr } = await chrome.storage.local.get(STORAGE_KEY_EXTRACT);
  return Array.isArray(arr) ? arr : [];
}
async function saveExtractions(list) { await chrome.storage.local.set({ [STORAGE_KEY_EXTRACT]: list }); }
function renderExtractions(list) {
  const cont = document.getElementById("extractionsList");
  const empty = document.getElementById("extractionsEmpty");
  if (!cont || !empty) return;

  cont.innerHTML = "";
  if (!list.length) { empty.style.display = ""; return; }
  empty.style.display = "none";

  const trimTxt = (s, n=70)=> {
    const t = String(s||'').replace(/\s+/g,' ').trim();
    return t.length>n ? t.slice(0,n) + "…" : t;
  };

  for (const item of list) {
const div = document.createElement("div");
div.className = "ex-item";
div.dataset.id = item.id;

const name = document.createElement("div");
name.className = "ex-name";
const isManual = !item.url || (item.title||"").toLowerCase().includes("pegado / drop");
const trimTxt = (s, n=70)=> {
  const t = String(s||'').replace(/\s+/g,' ').trim();
  return t.length>n ? t.slice(0,n) + "…" : t;
};
name.textContent = isManual ? trimTxt(item.rawText) : (item.title || "Extracción");
name.title = isManual ? (item.rawText||'').slice(0,500) : (item.title||'');

const actions = document.createElement("div");
actions.className = "ex-actions";
const btnDel = document.createElement("button");
btnDel.textContent = "×"; // X clara
btnDel.setAttribute('aria-label','Eliminar');
btnDel.title = "Eliminar extracción";
btnDel.addEventListener("click", async () => {
  const all = await loadExtractions();
  const next = all.filter((x) => x.id !== item.id);
  await saveExtractions(next);
  renderExtractions(next);
});

actions.appendChild(btnDel);
div.appendChild(name);
div.appendChild(actions);
cont.appendChild(div);
  }
}

(function setupLiveRefresh() {
  const KEY = "medreg.extractions";
  let rafId = null;
  function scheduleRender(list) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { renderExtractions(Array.isArray(list) ? list : []); });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    const next = changes[KEY].newValue || [];
    scheduleRender(next);
  });
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg && msg.type === "MEDREG_STORAGE_UPDATED") {
      const { [KEY]: arr } = await chrome.storage.local.get(KEY);
      scheduleRender(arr || []);
    }
  });
})();

//////////////////////////////////////////////////////////////////////////////////////////////// 01-11 - Investigador

// --- Investigador: storage y helpers independientes del chat ---
const STORAGE_KEY_EXTRACT_INV = "medreg.extractions.inv";

async function loadInvExtractions() {
  const { [STORAGE_KEY_EXTRACT_INV]: arr } = await chrome.storage.local.get(STORAGE_KEY_EXTRACT_INV);
  return Array.isArray(arr) ? arr : [];
}
async function saveInvExtractions(list) {
  await chrome.storage.local.set({ [STORAGE_KEY_EXTRACT_INV]: Array.isArray(list) ? list : [] });
  // NO disparamos MEDREG_STORAGE_UPDATED para no mezclar con el chat
}

function renderInvExtractions(list) {
  const cont = document.getElementById('extractionsListInv');
  const empty = document.getElementById('extractionsEmptyInv');
  if (!cont || !empty) return;

  cont.innerHTML = '';
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  arr.forEach(item => {
    const row = document.createElement('div');
    row.className = 'extraction-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:space-between';

    const txt = document.createElement('div');
    txt.textContent = (item.rawText || '').slice(0, 200);
    txt.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Eliminar';
    del.style.cssText = 'width:auto;background:#ef4444;border:none;color:#fff;padding:2px 8px;border-radius:6px';
    del.addEventListener('click', async () => {
      const all = await loadInvExtractions();
      const next = all.filter(x => x.id !== item.id);
      await saveInvExtractions(next);
      renderInvExtractions(next);
    });

    row.appendChild(txt);
    row.appendChild(del);
    cont.appendChild(row);
  });
}



function limpiarAnalisisINV(){
  // limpiar lista de extracciones INV
  saveInvExtractions([]);
  renderInvExtractions([]);

  // limpiar salida IA
  const out = document.getElementById('iaAnalisisOutInv');
  if (out){
    if (out.tagName === 'TEXTAREA' || out.tagName === 'INPUT') out.value = '';
    else out.textContent = '';
  }
}

document.getElementById('btnLimpiarAnalisisInv')?.addEventListener('click', limpiarAnalisisINV);


// --- Init de extracciones del Investigador al abrir el sidebar ---
async function initInvExtractionsFromStorage() {
  try {
    const items = await loadInvExtractions();  // lee medreg.extractions.inv
    renderInvExtractions(items);               // pinta la lista

    // Si hay extracciones previas, mostramos el bloque y la fila de análisis
    if (items && items.length) {
      document.getElementById('investigadorExtractions')?.style.removeProperty('display');
      document.getElementById('investigadorAnalisisRow')?.style.removeProperty('display');
    }
  } catch (e) {
    console.error('[MedReg] initInvExtractionsFromStorage:', e);
  }
}

// Nos aseguramos de ejecutarlo tanto si el DOM ya está listo como si no
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInvExtractionsFromStorage);
} else {
  initInvExtractionsFromStorage();
}


// ===================== Protocolos (backend) =====================
const PROTO_URL = "https://raw.githubusercontent.com/nicoredo/medex-backend/main/criterios_estudios_textual.json";
const PROTO_CACHE_KEY = "medreg.protocolos_cache";
const PROTO_TTL_MS = 60 * 60 * 1000;
const PROTO_SEL_KEY = "medreg.protocolos_selected";

async function getSelectedProtocolos() {
  const { [PROTO_SEL_KEY]: arr } = await chrome.storage.local.get(PROTO_SEL_KEY);
  return new Set(Array.isArray(arr) ? arr : []);
}
async function setSelectedProtocolos(setIds) { await chrome.storage.local.set({ [PROTO_SEL_KEY]: Array.from(setIds || []) }); }
async function getCachedProtocolos() {
  const { [PROTO_CACHE_KEY]: cache } = await chrome.storage.local.get(PROTO_CACHE_KEY);
  if (!cache) return null;
  if (!cache.ts || Date.now() - cache.ts > PROTO_TTL_MS) return null;
  return cache.data || null;
}
async function setCachedProtocolos(data) { await chrome.storage.local.set({ [PROTO_CACHE_KEY]: { ts: Date.now(), data } }); }
function normalizeEstudio(item, idx = 0) {
  const nombre = item?.nombre || item?.name || item?.titulo || item?.title || `Estudio ${idx + 1}`;
  const descripcion = item?.descripcion || item?.descripcion_larga || item?.description || item?.detalle || "";
  return { nombre: String(nombre), descripcion: String(descripcion) };
}
async function renderProtocolosList(data) {
  const cont = document.getElementById("protocolosSection");
  if (!cont) return;
  if (!cont.querySelector("#protoHeader")) {
    const header = document.createElement("div");
    header.id = "protoHeader";
    header.className = "categoria";
    header.innerHTML = `
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>Estudios vigentes</span>
        <span style="display:flex;gap:6px;align-items:center">
          <span id="protoCount" style="font-size:12px;color:#475569"></span>
          <button id="btnProtoRefresh" title="Recargar">âŸ³</button>
        </span>
      </label>
      <div style="display:flex;gap:8px;margin:6px 0 0 0">
        <button id="btnProtoAll">Seleccionar todo</button>
        <button id="btnProtoNone">Ninguno</button>
      </div>
      <div id="protoList" style="margin-top:6px;"></div>
    `;
    cont.prepend(header);
    header.querySelector("#btnProtoRefresh").addEventListener("click", async () => { await loadProtocolos({ force: true }); });
    header.querySelector("#btnProtoAll").addEventListener("click", async () => {
      const setSel = new Set(data.map((_, i) => i));
      await setSelectedProtocolos(setSel);
      await renderProtocolosList(data);
    });
    header.querySelector("#btnProtoNone").addEventListener("click", async () => {
      await setSelectedProtocolos(new Set());
      await renderProtocolosList(data);
    });
  }
  const list = cont.querySelector("#protoList");
  const counter = cont.querySelector("#protoCount");
  list.innerHTML = "";
  const selected = await getSelectedProtocolos();

  if (!Array.isArray(data) || data.length === 0) {
    list.innerHTML = `<div style="font-size:13px;color:#64748b">No se encontraron estudios.</div>`;
    if (counter) counter.textContent = "";
    return;
  }
  const normalized = data
    .map((item, i) => ({ i, ...normalizeEstudio(item, i) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  normalized.forEach((est) => {
    const card = document.createElement("label");
    card.style.cssText =
      "display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:8px 0; cursor:pointer;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(est.i);
    cb.setAttribute("data-idx", String(est.i));
    cb.style.marginTop = "3px";
    const info = document.createElement("div");
    info.style.flex = "1";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;color:#0d47a1;margin-bottom:4px";
    title.textContent = est.nombre;
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:13px;color:#475569;white-space:pre-wrap";
    desc.textContent = est.descripcion || "<sin descripciÃ³n>";
    info.appendChild(title); info.appendChild(desc);
    card.appendChild(cb); card.appendChild(info); list.appendChild(card);
    cb.addEventListener("change", async (e) => {
      const idx = Number(e.currentTarget.getAttribute("data-idx"));
      const setSel = await getSelectedProtocolos();
      if (e.currentTarget.checked) setSel.add(idx); else setSel.delete(idx);
      await setSelectedProtocolos(setSel);
      if (counter) counter.textContent = `${setSel.size} seleccionado(s)`;
    });
  });
  if (counter) counter.textContent = `${selected.size} seleccionado(s)`;
}
async function fetchProtocolosRaw() {
  const resp = await fetch(PROTO_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const arr = Array.isArray(json) ? json : Array.isArray(json?.estudios) ? json.estudios : [];
  return arr;
}
async function loadProtocolos({ force = false } = {}) {
  const cont = document.getElementById("protoList");
  if (cont) cont.innerHTML = `<div style="font-size:13px;color:#64748b">Cargandoâ€¦</div>`;
  try {
    let data = null;
    if (!force) data = await getCachedProtocolos();
    if (!data) { data = await fetchProtocolosRaw(); await setCachedProtocolos(data); }
    renderProtocolosList(data);
  } catch (e) {
    console.error("[MedReg] Error cargando protocolos:", e);
    if (cont) {
      cont.innerHTML = `
        <div style="font-size:13px;color:#b91c1c;background:#fee2e2;border:1px solid #fecaca;padding:8px;border-radius:8px">
          No se pudo cargar la lista desde el backend.<br/>
          RevisÃ¡ permisos de red o abrÃ­ el JSON en otra pestaÃ±a para confirmar:
          <a href="${PROTO_URL}" target="_blank" rel="noreferrer">criterios_estudios_textual.json</a>
        </div>`;
    }
  }
}

// ===================== IntegraciÃ³n con la HCE =====================
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function isInjectableUrl(url = "") { return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url); }
function pingContentScript(tabId, timeoutMs = 600) {
  return new Promise((resolve) => {
    let done = false;
    try {
      chrome.tabs.sendMessage(tabId, { type: "MEDREG_PING" }, () => {
        if (!done) { done = true; resolve(true); }
      });
    } catch (_) {}
    setTimeout(() => { if (!done) resolve(false); }, timeoutMs);
  });
}
async function ensureContentScript(tabId) {
  const okPing1 = await pingContentScript(tabId);
  if (okPing1) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["web-content.js", "highlight-content.js"] });
  } catch (e) { console.warn("[MedReg] executeScript no permitido en esta URL:", e); }
  const okPing2 = await pingContentScript(tabId);
  return okPing2;
}

// ===================== Autocompletado (DATALIST) clave â€” subcategorÃ­a =====================
function cargarDatalistPorCategoria(categoriaActual) {
  const lista = document.getElementById("sugerencias");
  if (!lista) return;
  lista.innerHTML = "";

  const { claves, subcats, sub2s } = getTermSetsByCategory(categoriaActual);

  // â€” Claves (primero)
  for (const k of claves) {
    const opt = document.createElement("option");
    opt.value = k;
 opt.setAttribute("label", `[CLAVE] ${k}`);
    opt.dataset.kind = "clave";
    lista.appendChild(opt);
  }

  // â€” SubcategorÃ­as (Ãºnicas)
  for (const s of subcats) {
    const opt = document.createElement("option");
    opt.value = s;
opt.setAttribute("label", `[SUBCATEGORÍA] ${s}`);
    opt.dataset.kind = "subcat";
    lista.appendChild(opt);
  }

  // â€” Familias (sub2)
  for (const s2 of sub2s) {
    const opt = document.createElement("option");
    opt.value = s2;
opt.setAttribute("label", `[GRUPO] ${s2}`);
    opt.dataset.kind = "sub2";
    lista.appendChild(opt);
  }

  // Extras fijos
  if (sinAcentos(categoriaActual) === "datos personales") {
    for (const val of ["edad","sexo"]) {
      if (![...lista.children].some(o => o.value === val)) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.setAttribute("label", `${val} â€” Datos Personales`);
        opt.dataset.kind = "clave";
        lista.appendChild(opt);
      }
    }
  }
}


// === Desactivar autocompletado nativo (datalist / autocomplete) ===
(function disableNativeAutocomplete(){
  const inp = document.getElementById("claveInput");
  if (!inp) return;

  // apagar sugerencias del navegador
  inp.setAttribute("autocomplete", "off");
  inp.setAttribute("autocapitalize", "off");
  inp.setAttribute("autocorrect", "off");
  inp.setAttribute("spellcheck", "false");

  // si venÃ­a con list="sugerencias", lo removemos
  if (inp.hasAttribute("list")) inp.removeAttribute("list");

  // limpiar o remover el datalist si existe
  const dl = document.getElementById("sugerencias");
  if (dl) {
    // opciÃ³n A (recomendado): remover del DOM
    dl.remove();
    // opciÃ³n B: si preferÃ­s dejarlo, lo vaciamos
    // dl.innerHTML = "";
  }
})();


document.getElementById("categoriaSelect")?.addEventListener("change", ()=>{
  const inp = document.getElementById("claveInput");
  if (inp) {
    inp.removeAttribute("list");
    inp.setAttribute("autocomplete", "off");
  }
});

function normalizarEntradaCriterio(categoria, valor) {
  const v = (valor || "").trim();
  if (!v) return v;

  // 1) si es clave (o sinÃ³nimo) â†’ clave canÃ³nica
  const can = canonIndex?.get(sinAcentos(v)); // canonIndex lo armamos al cargar terminologÃ­a
  if (can) return can;

  // 2) si coincide con subcat o sub2 vÃ¡lidos para la categorÃ­a â†’ dejar tal cual
  const { subcats, sub2s } = getTermSetsByCategory(categoria);
  if (subcats.some(s => sinAcentos(s) === sinAcentos(v))) return v;
  if (sub2s.some(s => sinAcentos(s) === sinAcentos(v))) return v;

  // 3) si no lo conocemos, lo devolvemos igual (o podrÃ­as bloquearlo con un aviso)
  return v;
}

// ===================== SinÃ³nimos y detecciÃ³n (laxa) =====================
function getSinonimos(categoria, clave) {
  const row = baseAutocompletado.find(t =>
    sinAcentos(t.categoria) === sinAcentos(categoria) &&
    sinAcentos(t.clave) === sinAcentos(clave)
  );
  return (row?.sinonimos || []).filter(Boolean);
}


// ====== ÃNDICES SIN SINÃ“NIMOS + REDES SUBCAT/SUB2 (A) ======
window.idx = {
  byCat: new Map(),          // cat -> { baseClaves:Set, subcats:Set, sub2s:Set }
  subcatToCanon: new Map(),  // cat -> (subcatNorm -> Set<canon>)
  sub2ToCanon: new Map(),    // cat -> (sub2Norm   -> Set<canon>)
  canonToTerms: new Map(),   // (catNorm|canonNorm) -> Set( canon + sinÃ³nimos )
  canonSetByCat: new Map(),  // cat -> Set<canon>
};
function norm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").trim(); }

function rebuildIndices() {
  const byCat = new Map();
  const subcatToCanon = new Map();
  const sub2ToCanon = new Map();
  const canonToTerms = new Map();
  const canonSetByCat = new Map();

  (baseAutocompletado || []).forEach(t => {
    const cat = t.categoria || "Otros";
    if (!byCat.has(cat)) byCat.set(cat, { baseClaves:new Set(), subcats:new Set(), sub2s:new Set() });
    if (!canonSetByCat.has(cat)) canonSetByCat.set(cat, new Set());

    if (t.clave) byCat.get(cat).baseClaves.add(t.clave);
    if (t.subcategoria && sinAcentos(t.subcategoria) !== sinAcentos(cat)) byCat.get(cat).subcats.add(t.subcategoria);
    if (t.sub2) byCat.get(cat).sub2s.add(t.sub2);

    const key = `${norm(cat)}|${norm(t.clave)}`;
    if (!canonToTerms.has(key)) canonToTerms.set(key, new Set());
    canonToTerms.get(key).add(t.clave);
    (t.sinonimos || []).forEach(s => canonToTerms.get(key).add(s));
  });

  (baseAutocompletado || []).forEach(t => {
    const cat = t.categoria || "Otros";
    const can = t.clave;

    if (!subcatToCanon.has(cat)) subcatToCanon.set(cat, new Map());
    if (!sub2ToCanon.has(cat)) sub2ToCanon.set(cat, new Map());

    if (t.subcategoria) {
      const sN = norm(t.subcategoria);
      const m = subcatToCanon.get(cat);
      if (!m.has(sN)) m.set(sN, new Set());
      m.get(sN).add(can);
    }
    if (t.sub2) {
      const s2N = norm(t.sub2);
      const m2 = sub2ToCanon.get(cat);
      if (!m2.has(s2N)) m2.set(s2N, new Set());
      m2.get(s2N).add(can);
    }

    if (!canonSetByCat.has(cat)) canonSetByCat.set(cat, new Set());
    canonSetByCat.get(cat).add(can);
  });

  window.idx.byCat = byCat;
  window.idx.subcatToCanon = subcatToCanon;
  window.idx.sub2ToCanon = sub2ToCanon;
  window.idx.canonToTerms = canonToTerms;
  window.idx.canonSetByCat = canonSetByCat;
}
function getAllTermsForEnhanced(categoria, claveCanon) {
  const pack = new Set([claveCanon, ...getSinonimos(categoria, claveCanon)]);

  const row = termIndex.byKey.get(sinAcentos(claveCanon));
  if (row?.sub2) {
    const fam = termIndex.bySub2.get(sinAcentos(row.sub2));
    if (fam) fam.forEach(t => pack.add(t));
  }

  const infer = reglasInferIndex.get(sinAcentos(claveCanon));
  if (infer) infer.forEach(t => pack.add(t));

  return Array.from(pack);
}


// ===================== PRE-MATCH =====================
function setPillNegado(div) {
  div.classList.remove("cumple", "parcial");
  div.classList.add("nocumple");
  const pill = div.querySelector(".resultado");
  if (pill) { pill.textContent = "Verificar"; pill.title = "Negado en el texto"; }
}
function setPillHallazgo(div, texto) {
  div.classList.remove("cumple", "nocumple", "parcial");
  const pill = div.querySelector(".resultado");
  if (texto) {
    div.classList.add("parcial");
    if (pill) { pill.textContent = "Hallazgo"; pill.title = texto; }
  } else {
    if (pill) { pill.textContent = "“"; pill.removeAttribute("title"); }
  }
}

function setPillNeutral(div, title) {
  div.classList.remove("cumple", "nocumple", "parcial");
  const pill = div.querySelector(".resultado");
  if (pill) {
    pill.textContent = "";
    if (title) pill.title = title; else pill.removeAttribute("title");
  }
}

function foundIn(texto, terminos, opts = {}) {
  const tRaw = texto || "";
  const t = sinAcentos(tRaw);
  const ranges = [];
  let negado = false, hit = false;

  // sufijos clÃ­nicos frecuentes pegados a acrÃ³nimos: IAMCEST, SCASEST, STEMI/NSTEMI
  const ACR_SUFFIX = "(?:[-/ ]?(?:c?est|s?est|est|stemi|nstemi))?";

  // helper para pushear rango + negaciÃ³n si aplica
  function pushMatch(idx, len) {
    hit = true;
    ranges.push({ i: idx, len });
    if (isNegatedForTerm(tRaw, idx)) negado = true;
  }

  for (const raw of (terminos || [])) {
    const clean = sinAcentos(raw || "");
    if (!clean) continue;

    // 1) patrÃ³n base (respeta espacios como \s+)
    const patBase = clean
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");

    // 2) Â¿acrÃ³nimo corto? (IAM, SCA, ATC)
    const isAcr = clean.length <= 3;

    // 3) variantes â€œpegadasâ€ y con separadores (IAMCEST, IAM-CEST, IAM/CEST)
    //    - si es acrÃ³nimo: permitir sufijo clÃ­nico
    //    - si no es acrÃ³nimo: palabra completa
    const rxBase = isAcr
      ? new RegExp(`\\b${patBase}${ACR_SUFFIX}\\b`, "ig")
      : new RegExp(`\\b${patBase}\\b`, "ig");

    // 4) patrÃ³n mÃ¡s permisivo con separadores en el medio (ej: "sindrome/coronario agudo")
    const patLoose = clean
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[\\s\\-/]+"); // permite espacio, -, /

    const rxLoose = isAcr
      ? new RegExp(`\\b${patLoose}${ACR_SUFFIX}\\b`, "ig")
      : new RegExp(`\\b${patLoose}\\b`, "ig");

    // 5) patrÃ³n para ICD-10 de IAM (I21, I21.x, I2111)
    //    Lo activamos solo si el tÃ©rmino sugiere infarto (iam / infarto agudo de miocardio)
    const isIAM =
      clean === "iam" ||
      clean.includes("infarto agudo de miocardio") ||
      clean === "stemi" || clean === "nstemi";

    const rxICD = isIAM ? new RegExp(`\\bI21[0-9A-Za-z\\.]*\\b`, "ig") : null;

    // ---- ejecutar todos los patrones posibles sobre el texto normalizado ----
    const scanners = [rxBase, rxLoose].concat(rxICD ? [rxICD] : []);
    for (const rx of scanners) {
      let m;
      while ((m = rx.exec(t)) !== null) {
        const i0 = m.index, i1 = m.index + m[0].length;
        pushMatch(i0, i1 - i0);
        // avanzar de a 1 para encontrar solapados sin loops infinitos
        rx.lastIndex = m.index + 1;
      }
    }
  }

  // Fuzzy opcional (igual que antes)
  if (!hit && (opts?.allowFuzzy ?? true)) {
    const toks = t.split(/\W+/).filter(w => w.length > 2);
    outer: for (const tk of toks) {
      for (const raw of (terminos || [])) {
        const clean = sinAcentos(raw || "");
        if (clean.length <= 3) continue;
        if (lev(tk, clean) <= 1) { hit = true; break outer; }
      }
    }
  }

  return { hit, negado, ranges };
}



// ==== LAB: helpers de anÃ¡lisis numÃ©rico ====
function normUnit(u){return (u||"").toLowerCase().replace(/\s+/g,"")}
function isLipid(baseCanon){
  const b = sinAcentos(baseCanon);
  return ["colesterol total","colesterol ldl","ldl","colesterol hdl","hdl","trigliceridos","triglicÃ©ridos"].includes(b);
}
function isGlucose(baseCanon){
  const b = sinAcentos(baseCanon);
  return ["glucosa","glucemia","glucemia en ayunas"].includes(b);
}
function isHbA1c(baseCanon){
  const b = sinAcentos(baseCanon);
  return ["hba1c","hemoglobina glicosilada","hemoglobina glucosilada"].includes(b);
}
function convertValor(baseCanon, valor, fromU, toU) {
  const f = normUnit(fromU), t = normUnit(toU);
  if (!t || f===t) return valor;
  if (isLipid(baseCanon)) {
    const isTG = ["trigliceridos","triglicÃ©ridos"].includes(sinAcentos(baseCanon));
    const k = isTG ? 88.57 : 38.67;
    if (f==="mg/dl" && t==="mmol/l") return valor / k;
    if (f==="mmol/l" && t==="mg/dl") return valor * k;
  }
  if (isGlucose(baseCanon)) {
    const k = 18.02;
    if (f==="mg/dl" && t==="mmol/l") return valor / k;
    if (f==="mmol/l" && t==="mg/dl") return valor * k;
  }
  return valor;
}
function buildAnalitoRegex(variants) {
  const or = (variants || [])
    .map(v => v && v.trim())
    .filter(Boolean)
    .map(v => v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g,"\\$&")
      .replace(/\s+/g,"\\s+"))
    .join("|");

  // conectores comunes entre el analito y el valor (priorizados)
  const connectors = "(?:\\s*(?:=|:|es\\s+de|de|â†’|->)\\s*)";

  // permitÃ­ tambiÃ©n texto intermedio genÃ©rico (hasta 40 chars) como fallback
  const gapOrConn = `(?:${connectors}|[^\\d]{0,40}?)`;

  // analito + (conector o pequeÃ±o gap) + nÃºmero (+ unidad opcional)
  return new RegExp(
    `(?:^|\\b|[^\\p{L}\\d])(?:${or})${gapOrConn}` +
    `(\\d+(?:[\\.,]\\d+)?)(?:\\s*(%|mg\\/dl|mmol\\/l|g\\/l|u\\/l|ui\\/l|mg\\/l))?`,
    "iu"
  );
}

function extraerValorLab(textoPlano, variants) {
  const plano = sinAcentos(textoPlano);
  const rx = buildAnalitoRegex(variants);
  const m = plano.match(rx);
  if (!m) return null;
  const valor = parseFloat((m[1]||"").replace(",", "."));
  const unidad = (m[2]||"").toLowerCase();
  return { valor, unidad };
}
function cumpleCondicionValor(baseCanon, med, cond) {
  const v = convertValor(baseCanon, med.valor, med.unidad, cond.unidadObjetivo);
  if (cond.operador === "entre") {
    return v >= cond.min && v <= cond.max;
  }
  const x = cond.umbral;
  switch (cond.operador) {
    case ">":  return v >  x;
    case ">=": return v >= x;
    case "<":  return v <  x;
    case "<=": return v <= x;
    case "=":  return Math.abs(v - x) < 1e-9;
    default:   return false;
  }
}


function getTermSetsByCategory(cat) {
  const catNorm = sinAcentos(cat);
  const claves = new Set();
  const subcats = new Set();
  const sub2s = new Set();

  for (const t of baseAutocompletado || []) {
    if (sinAcentos(t.categoria) !== catNorm) continue;
    // solo CLAVES (no sinÃ³nimos)
    claves.add(t.clave);
    // subcategorÃ­a (evitar repetir el nombre de la categorÃ­a)
    if (t.subcategoria && sinAcentos(t.subcategoria) !== catNorm) subcats.add(t.subcategoria);
    // familias sub2 (si existen)
    if (t.sub2) sub2s.add(t.sub2);
  }
  return {
    claves: Array.from(claves).sort((a,b)=>a.localeCompare(b)),
    subcats: Array.from(subcats).sort((a,b)=>a.localeCompare(b)),
    sub2s: Array.from(sub2s).sort((a,b)=>a.localeCompare(b)),
  };
}

///////////////////////////////////PREMATCH///////////////////////////////
async function preMatch() {
  // --- helpers locales para LAB (auto-contenidos) ---
  const normUnit = (u) => (u || "").toLowerCase().replace(/\s+/g, "");
  const isLipid = (baseCanon) => {
    const b = sinAcentos(baseCanon);
    return ["colesterol total","colesterol ldl","ldl","colesterol hdl","hdl","trigliceridos","triglicÃ©ridos"].includes(b);
  };
  const isGlucose = (baseCanon) => {
    const b = sinAcentos(baseCanon);
    return ["glucosa","glucemia","glucemia en ayunas"].includes(b);
  };
  const isHbA1c = (baseCanon) => {
    const b = sinAcentos(baseCanon);
    return ["hba1c","hemoglobina glicosilada","hemoglobina glucosilada"].includes(b);
  };
  function convertValor(baseCanon, valor, fromU, toU) {
    const f = normUnit(fromU), t = normUnit(toU);
    if (!t || f === t) return valor;
    if (isLipid(baseCanon)) {
      const isTG = ["trigliceridos","triglicÃ©ridos"].includes(sinAcentos(baseCanon));
      const k = isTG ? 88.57 : 38.67; // TG y resto de lÃ­pidos
      if (f === "mg/dl" && t === "mmol/l") return valor / k;
      if (f === "mmol/l" && t === "mg/dl") return valor * k;
    }
    if (isGlucose(baseCanon)) {
      const k = 18.02;
      if (f === "mg/dl" && t === "mmol/l") return valor / k;
      if (f === "mmol/l" && t === "mg/dl") return valor * k;
    }
    return valor;
  }
  function buildAnalitoRegex(variants) {
    const or = (variants || [])
      .map(v => v && v.trim())
      .filter(Boolean)
      .map(v => v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+"))
      .join("|");
    // Captura un nÃºmero a <= 40 caracteres del analito, con unidad opcional
    return new RegExp(`(?:^|\\b|[^\\p{L}\\d])(?:${or})(?:[^\\d]{0,40}?)(\\d+(?:[\\.,]\\d+)?)(?:\\s*(%|mg\\/dl|mmol\\/l|g\\/l|u\\/l|ui\\/l|mg\\/l))?`, "iu");
  }
  function extraerValorLab(textoPlano, variants) {
    const plano = sinAcentos(textoPlano || "");
    const rx = buildAnalitoRegex(variants);
    const m = plano.match(rx);
    if (!m) return null;
    const valor = parseFloat((m[1] || "").replace(",", "."));
    const unidad = (m[2] || "").toLowerCase();
    return { valor, unidad };
  }
  function cumpleCondicionValor(baseCanon, med, cond) {
    const v = convertValor(baseCanon, med.valor, med.unidad, cond.unidadObjetivo);
    if (cond.operador === "entre") {
      return v >= cond.min && v <= cond.max;
    }
    const x = cond.umbral;
    switch (cond.operador) {
      case ">":  return v >  x;
      case ">=": return v >= x;
      case "<":  return v <  x;
      case "<=": return v <= x;
      case "=":  return Math.abs(v - x) < 1e-9;
      default:   return false;
    }
  }
  // --- fin helpers LAB ---

  const estudioActivo = document.getElementById("estudio").value;
  if (!estudioActivo || !estudios[estudioActivo]) { alert("SeleccionÃ¡ un estudio primero."); return; }

  const tab = await getActiveTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) { alert("AbrÃ­ una HCE http/https para usar Pre-Match."); return; }
  const ready = await ensureContentScript(tab.id);
  if (!ready) { alert("No pude conectar con la pÃ¡gina. RecargÃ¡ la HCE e intentÃ¡ de nuevo."); return; }

  const payload = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "MEDREG_EXTRACT_DOM" }, (resp) => {
      void chrome.runtime.lastError; resolve(resp || null);
    });
  });
  if (!payload?.rawText) { alert("Recargar la pÃ¡gina."); return; }
  const texto = payload.rawText;

  // reset de â€œpillsâ€
  document.querySelectorAll("#contenedorCriterios .criterio").forEach(div => setPillHallazgo(div, null));

  const datosEstudio = estudios[estudioActivo];
  const termsForHighlight = new Set();
  const termsNegadosForHighlight = new Set();

  // Si existe una versiÃ³n extendida de expansor de tÃ©rminos (con sub2/inferencias), usarla.
  const expandTerms = (typeof getAllTermsForEnhanced === "function")
    ? (cat, clave) => getAllTermsForEnhanced(cat, clave)
    : (cat, clave) => getAllTermsFor(cat, clave);

  document.querySelectorAll("#contenedorCriterios .categoria").forEach(catDiv => {
    const catNombre = catDiv.querySelector(".categoria-nombre")?.textContent?.trim();
    if (!catNombre) return;

    const criteriosCat = Array.isArray(datosEstudio[catNombre]) ? datosEstudio[catNombre] : [];

    catDiv.querySelectorAll(".criterio").forEach(itemDiv => {
      const idx = parseInt(itemDiv.getAttribute("data-idx"), 10);
      const c = criteriosCat[idx]; if (!c) return;

      // --- BLOQUE: Laboratorio con valores (>=, >, <=, <, =, entre) ---
      if (sinAcentos(catNombre) === "laboratorio" && c?.tipo === "valor" && c?.operador) {
        const baseCanon = c.clave; // usamos la clave del criterio como analito base
        // variantes para encontrar el analito en el texto: clave + sinÃ³nimos
        const variants = (() => {
          try { return [baseCanon, ...getSinonimos(catNombre, baseCanon)]; }
          catch { return [baseCanon]; }
        })();

        const med = extraerValorLab(texto, variants);

        // unidad objetivo por default segÃºn analito
        const unidadObjetivo =
          (isHbA1c(baseCanon) ? "%" : (isGlucose(baseCanon) || isLipid(baseCanon) ? "mg/dL" : (med?.unidad || "")));

        const cond = (c.operador === "entre")
          ? { operador: "entre", min: Number(c.min), max: Number(c.max), unidadObjetivo }
          : { operador: c.operador, umbral: Number(c.umbral), unidadObjetivo };

        if (!med || !Number.isFinite(med.valor)) {
          setPillNeutral(itemDiv, "No se encontrÃ³ valor numÃ©rico para " + baseCanon);
          return;
        }

        const cumple = cumpleCondicionValor(baseCanon, med, cond);
        const foundLabel = `${baseCanon}: ${med.valor}${med.unidad ? " " + med.unidad : ""}`;

        if (cumple) {
          setPillHallazgo(itemDiv, foundLabel);
          termsForHighlight.add(baseCanon);
          termsForHighlight.add(String(med.valor));
        } else {
          setPillNeutral(itemDiv, `${foundLabel} â€” no cumple ${c.operador} ${c.operador==="entre" ? c.min+" y "+c.max : c.umbral}`);
        }
        return;
      }
      // --- FIN BLOQUE LAB ---

      // ===== EXPANSIÃ“N COMPLETA (D) =====
      const modo = (c.modo || itemDiv.getAttribute("data-modo") || "clave");
      let canones = [];
      if (modo === "clave") {
        canones = [c.clave];
      } else {
        try { canones = resolverDestinosParaCriterio(catNombre, c.clave) || []; } catch { canones = [c.clave]; }
      }
      const pack = new Set();
      for (const k of canones) {
        let terms = null;
        try { terms = getAllTermsForEnhanced(catNombre, k); } catch { terms = [k]; }
        (terms || [k]).forEach(t => pack.add(t));
        const row = (baseAutocompletado||[]).find(x => x.categoria===catNombre && sinAcentos(x.clave)===sinAcentos(k));
        if (row?.sub2) pack.add(row.sub2);
      }
      const det = foundIn(texto, Array.from(pack), { allowFuzzy: true });

      if (det.hit) {
        if (det.negado) {
          setPillNegado(itemDiv);
          det.ranges.forEach(r => {
            const frag = texto.slice(r.i, r.i + r.len);
            if (frag && frag.trim()) termsNegadosForHighlight.add(frag);
          });
        } else {
          setPillHallazgo(itemDiv, c.clave);
          det.ranges.forEach(r => {
            const frag = texto.slice(r.i, r.i + r.len);
            if (frag && frag.trim()) termsForHighlight.add(frag);
          });
        }
      }
    });
  });

  // Resaltado en pÃ¡gina
  chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" });
  const termsOK  = Array.from(termsForHighlight);
  const termsNEG = Array.from(termsNegadosForHighlight);
  if (termsOK.length)  chrome.tabs.sendMessage(tab.id, { action: "highlightMany", terms: termsOK, scroll: true });
  if (termsNEG.length) chrome.tabs.sendMessage(tab.id, { action: "highlightNegados", terms: termsNEG });
}

function analizar() { preMatch(); }
function limpiarTodo() {
  document.querySelectorAll(".valorOperador").forEach((i) => (i.value = ""));
  document.querySelectorAll(".resultado").forEach((s) => { s.textContent = "-"; s.removeAttribute("title"); });
  document.querySelectorAll(".chk").forEach((cb) => (cb.checked = false));
  document.querySelectorAll(".criterio").forEach((div) => div.classList.remove("cumple", "nocumple", "parcial"));
  getActiveTab().then(t => { if (t?.id) chrome.tabs.sendMessage(t.id, { action: "clearHighlights" }); });
}

// ===================== ABM de estudios (modal) =====================
let tempEstudio = {};
function abrirModal() { tempEstudio = {}; document.getElementById("modal").style.display = "flex"; document.getElementById("preview").innerHTML = ""; limpiarCamposModal(); }
function cerrarModal() { document.getElementById("modal").style.display = "none"; }
function actualizarSelector() {
  const sel = document.getElementById("estudio"); sel.innerHTML = "";
  for (let nombre in estudios) { const opt = document.createElement("option"); opt.textContent = nombre; sel.appendChild(opt); }
}
function eliminarEstudio() {
  const nombre = document.getElementById("estudio").value;
  if (!nombre) return;
  if (confirm(`¿Eliminar estudio "${nombre}"?`)) {
    delete estudios[nombre];
    localStorage.setItem("estudiosMedReg", JSON.stringify(estudios));
    actualizarSelector();
    renderCriterios();
  }
}
function limpiarCamposModal() {
  document.getElementById("categoriaSelect").value = "";
  document.getElementById("claveInput").value = "";
  document.getElementById("valor1").value = "";
  document.getElementById("valor2").value = "";
  document.getElementById("valor2").classList.add("oculto");
  document.getElementById("valorSexo").value = "todos";
  document.getElementById("opcionesValor").classList.add("oculto");
  document.getElementById("opcionesSexo").classList.add("oculto");
  document.getElementById("catNueva").value = "";
  document.getElementById("claveNueva").value = "";
  document.getElementById("sinonimosNuevos").value = "";
  mostrarOpcionesPorClaveYCategoria();
  document.getElementById("claveInput").value = "";
}
function mostrarOpcionesPorClaveYCategoria() {
  const categoria = (document.getElementById("categoriaSelect").value || "").toLowerCase();
  const clave = (document.getElementById("claveInput").value || "").trim().toLowerCase();
  document.getElementById("opcionesValor").classList.add("oculto");
  document.getElementById("opcionesSexo").classList.add("oculto");
  if (categoria === "datos personales" && clave === "edad") document.getElementById("opcionesValor").classList.remove("oculto");
  else if (categoria === "datos personales" && clave === "sexo") document.getElementById("opcionesSexo").classList.remove("oculto");
  else if (categoria === "laboratorio") document.getElementById("opcionesValor").classList.remove("oculto");
}

function agregarCriterio() {
  const cat = document.getElementById("categoriaSelect").value;
  const inp = document.getElementById("claveInput");
  const clave = (inp.value || "").trim();
  const modoUI = inp.dataset.modo || "";
  const claveLower = sinAcentos(clave);
  const op = document.getElementById("operador").value;
  const val1 = document.getElementById("valor1").value;
  const val2 = document.getElementById("valor2").value;
  const sexo = document.getElementById("valorSexo").value;
  if (!cat || !clave) return alert("Complete todos los campos.");

  // Si no clickeó sugerencia, intentamos clasificar por índices
  let modo = modoUI;
  if (!modo) {
    const catObj = window.idx.byCat.get(cat);
    const inSubcat = !!Array.from(catObj?.subcats||[]).find(s=>sinAcentos(s)===claveLower);
    const inSub2 = !!Array.from(catObj?.sub2s||[]).find(s=>sinAcentos(s)===claveLower);
    modo = inSubcat ? "subcat" : (inSub2 ? "sub2" : "clave");
  }

  // alta rápida sólo si es "clave" desconocida y no es Datos Personales
  const encontrado = baseAutocompletado.find(t =>
    (t.categoria || "").toLowerCase() === (cat || "").toLowerCase() &&
    sinAcentos(t.clave) === claveLower
  );
  if (!encontrado && cat !== "Datos Personales" && modo === "clave") {
    document.getElementById("formNuevoCriterio").classList.remove("oculto");
    document.getElementById("claveNueva").value = clave;
    return;
  }
  let criterio = { clave, modo, tipo: "booleano" };
  if ((cat === "Datos Personales" && claveLower === "edad") || cat === "Laboratorio") {
    criterio.tipo = "valor"; criterio.operador = op;
    if (op === "entre") { criterio.min = parseFloat(val1); criterio.max = parseFloat(val2); }
    else if (val1 !== "") { criterio.umbral = parseFloat(val1); }
  }
  if (cat === "Datos Personales" && claveLower === "sexo") {
    criterio.tipo = "valor"; criterio.valor = sexo;
  }
  if (!tempEstudio[cat]) tempEstudio[cat] = [];
  tempEstudio[cat].push(criterio);
  renderPreview();
  document.getElementById("valor1").value = "";
  document.getElementById("valor2").value = "";
  document.getElementById("valor2").classList.add("oculto");
  document.getElementById("valorSexo").value = "todos";
  document.getElementById("opcionesValor").classList.add("oculto");
  document.getElementById("opcionesSexo").classList.add("oculto");
  mostrarOpcionesPorClaveYCategoria();
  inp.value = ""; inp.dataset.modo = "";
  const panel = document.getElementById("suggestPanel"); if (panel) panel.innerHTML = "";
}

function nuevoEstudio() {
  tempEstudio = {};
  document.getElementById("modal").style.display = "flex";
  document.getElementById("preview").innerHTML = "";
  document.getElementById("nombreEstudio").value = "";
  document.getElementById("nombreEstudio").disabled = false;
  limpiarCamposModal();
}
function editarEstudio() {
  const nombre = document.getElementById("estudio").value;
  if (!nombre || !estudios[nombre]) return;
  tempEstudio = JSON.parse(JSON.stringify(estudios[nombre]));
  document.getElementById("modal").style.display = "flex";
  document.getElementById("nombreEstudio").value = nombre;
  document.getElementById("nombreEstudio").disabled = true;
  renderPreview();
  limpiarCamposModal();
}
function renderPreview() {
  const preview = document.getElementById("preview");
  preview.innerHTML = "";
  for (let cat in tempEstudio) {
    const div = document.createElement("div");
    div.innerHTML = `<strong>${cat}</strong><br>`;
    tempEstudio[cat].forEach((c, i) => {
      let texto = c.clave;
      if (c.tipo === "valor") {
        if (c.operador === "entre") texto += ` entre ${c.min} y ${c.max}`;
        else if (c.umbral !== undefined) texto += ` ${c.operador} ${c.umbral}`;
        else if (c.valor !== undefined) texto += ` = ${c.valor}`;
      }
      texto += ` <button class="btnEliminarCriterio" data-cat="${cat}" data-idx="${i}" title="Quitar">❌</button>`;
      div.innerHTML += `<span class="tag">${texto}</span>`;
    });
    preview.appendChild(div);
  }
}
function eliminarCriterio(cat, idx) {
  if (!tempEstudio[cat]) return;
  tempEstudio[cat].splice(idx, 1);
  if (tempEstudio[cat].length === 0) delete tempEstudio[cat];
  renderPreview();
}
async function guardarNuevoCriterio() {
  const cat  = document.getElementById("catNueva").value;
  const clave = document.getElementById("claveNueva").value.trim();
  const sinonimos = document.getElementById("sinonimosNuevos").value
    .trim().split(",").map(s => s.trim()).filter(Boolean);

  if (!clave || !cat) return;

  const nuevo = { categoria: cat, clave, sinonimos, subcategoria: cat, sub2: "" };
  const norm = s => sinAcentos(s || '');

  // evitar duplicados en la base en memoria
  if (!baseAutocompletado.some(t => norm(t.categoria) === norm(cat) && norm(t.clave) === norm(clave))) {
    baseAutocompletado.push(nuevo);
  }

  // guardar en capa "transportable"
  const extras = await loadUserTerms();
  if (!extras.some(t => norm(t.categoria) === norm(cat) && norm(t.clave) === norm(clave))) {
    extras.push(nuevo);
    await saveUserTerms(extras);
  }

    // ...
  if (!extras.some(t => norm(t.categoria) === norm(cat) && norm(t.clave) === norm(clave))) {
    extras.push(nuevo);
    await saveUserTerms(extras);
  }

  localStorage.setItem("baseAutocompletado", JSON.stringify(baseAutocompletado));

  try {
    if (typeof rebuildIndices === "function") rebuildIndices();
  } catch (e) {
    console.warn("rebuildIndices error", e);
  }

  cargarDatalistPorCategoria(cat);
  document.getElementById("formNuevoCriterio").classList.add("oculto");
  document.getElementById("claveInput").value = clave;
  document.getElementById("claveInput").dataset.modo = "clave";
  agregarCriterio();
}

function guardarEstudio() {
  const nombre = document.getElementById("nombreEstudio").value.trim();
  if (!nombre || Object.keys(tempEstudio).length === 0) return alert("Falta nombre o criterios.");
  estudios[nombre] = tempEstudio;
  localStorage.setItem("estudiosMedReg", JSON.stringify(estudios));
  actualizarSelector();
  cerrarModal();
  renderCriterios();
}
function renderCriterios() {
  const cont = document.getElementById("contenedorCriterios");
  cont.innerHTML = "";
  const nombre = document.getElementById("estudio").value;
  if (!nombre || !estudios[nombre]) return;
  const datos = estudios[nombre];
  for (let cat in datos) {
    const div = document.createElement("div");
    div.className = "categoria";
    const header = document.createElement("label");
    header.className = "categoria-nombre";
    header.textContent = cat;
    div.appendChild(header);
    datos[cat].forEach((c, i) => {
      let texto = c.clave;
      if (c.tipo === "valor") {
        if (c.operador === "entre") texto += ` entre ${c.min} y ${c.max}`;
        else if (c.umbral !== undefined) texto += ` ${c.operador} ${c.umbral}`;
        else if (c.valor !== undefined) texto += ` = ${c.valor}`;
      }
      const item = document.createElement("div");
      item.className = "criterio";
      item.setAttribute("data-cat", cat);
      item.setAttribute("data-idx", i.toString());
      item.setAttribute("data-clave", c.clave);
      item.innerHTML = `
        <input type="checkbox" class="chk" title="Marcar">
        <span class="texto-clave">${texto}</span>
        <input type="text" class="valorOperador" placeholder="Comentario o valor">
        <span class="resultado">–</span>
      `;
      div.appendChild(item);
    });
    cont.appendChild(div);
  }
}


function obtenerCriteriosVisiblesINV(){
  // Intenta con contenedores típicos; si cambian, añadí otro selector acá.
  const sel = '#proto-criterios .criterio, #inv-criterios .criterio, .criterio-chip, .criterio';
  const chips = Array.from(document.querySelectorAll(sel));
  return chips
    .map(ch => (ch.getAttribute('data-clave') || ch.textContent || '').trim())
    .filter(Boolean);
}


async function getContextFromExtractionsOnly(){
  // Recupera el texto tal como está listado en la caja de Extracciones (INV)
  const items = Array.from(document.querySelectorAll('#inv-extracciones .item, #inv-extracciones li, .inv-extraccion'));
  if (items.length){
    return items.map(el => (el.getAttribute('data-texto') || el.textContent || '').trim()).filter(Boolean).join('\n\n');
  }
  // Fallback a tu store en memoria si lo usás:
  if (window.__INV_EXTRACCIONES && Array.isArray(window.__INV_EXTRACCIONES)){
    return window.__INV_EXTRACCIONES.map(x => (x.texto || x) ).join('\n\n');
  }
  return '';
}





function scrollSidebarBottom(){
  // scrolla el propio sidebar (document) hasta el final
  requestAnimationFrame(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  );
}

function setAnalisisInvLoading(isLoading){
  const btn = document.getElementById('btnAnalisisIAInv');
  const out = document.getElementById('iaAnalisisOutInv');
  const loader = document.getElementById('invIaLoading');

  if (isLoading){
    if (btn){
      btn.disabled = true;
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.textContent = '🧠 Analizando…';
    }
    if (loader){
      loader.style.display = 'flex';
    }
    if (out){
      out.style.display = 'block';
      if (!out.value || out.value === 'Analizando…'){
        out.value = 'Analizando con IA…\n\nEsto puede tardar unos segundos.';
      }
    }
  } else {
    if (btn){
      btn.disabled = false;
      if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
    }
    if (loader){
      loader.style.display = 'none';
    }
  }
}



async function runAnalisisIA_INV() {
  try {
    // Llevo el scroll abajo al empezar
    scrollSidebarBottom();

    // 1) Recolectar criterios visibles del Investigador
    const criterios = [];
    document.querySelectorAll('#contenedorCriterios .criterio').forEach((div, i) => {
      const cat    = div.getAttribute('data-cat') || '';
      const base   = div.querySelector('.texto-clave')?.textContent?.trim() || '';
      const coment = div.querySelector('.valorOperador, .comentario, textarea')?.value?.trim() || '';
      if (!base) return;
      criterios.push({ cat, base, coment });
    });

    if (!criterios.length) {
      throw new Error('No hay criterios visibles para analizar.');
    }

    // 2) Tomar SOLO el texto del box de extracciones (INV)
    const items = await loadInvExtractions(); // ya existe en tu código
    const raw = (items || [])
      .map(x => x.rawText || '')
      .join('\n\n---\n\n')
      .slice(0, 8000);

    if (!raw) {
      throw new Error('No hay texto extraído en la caja de Extracciones (Investigador).');
    }

    // 3) Armar prompt para la IA (estilo “protocolo”)
    const criteriosTexto = criterios
      .map((c, i) => {
        const encabezado = c.cat ? `[${c.cat}] ` : '';
        const obs = c.coment ? ` — ${c.coment}` : '';
        return `${i + 1}. ${encabezado}${c.base}${obs}`;
      })
      .join('\n');

    const prompt = `
Actuá como un médico clínico que evalúa si un paciente cumple criterios de un estudio.

Tenés:

=== TEXTO CLÍNICO (historia extractada) ===
${raw}

=== CRITERIOS A EVALUAR ===
${criteriosTexto}

Para CADA criterio, respondé en una lista numerada (1., 2., 3., ...):
- Poné ✅ si se cumple claramente.
- Poné ❌ si NO se cumple o se descarta.
- Poné ❓ si la información es insuficiente o dudosa.
- Citá ENTRE COMILLAS una frase relevante del texto si existe.
- Explicá brevemente (máx. 1–2 frases) tu razonamiento clínico.

No inventes datos. Si el texto no alcanza, marcá ❓ y explicá brevemente qué falta.
`.slice(0, 12000);

    // 4) Llamar DIRECTO a OpenRouter (sin Render)
    const out = await callOpenRouterInvestigador(prompt);
    renderResultadoINV(out);
    console.info('[MedReg] Análisis IA (INV) OK vía OpenRouter directo');

    // Bajo el scroll al final para que se vea la respuesta
    scrollSidebarBottom();

  } catch (e) {
    console.error('[MedReg] Análisis IA (INV) falló:', e);
    toast(`❌ Error al contactar IA: ${e?.message || e}`, 'error');
  }
}

// ===== Export / Import de estudios =====
const MEDREG_SCHEMA = "medreg-study";
const MEDREG_SCHEMA_VERSION = 1;

// Arma el paquete exportable (uno o todos)
function buildStudyPackage({ onlyName = null } = {}) {
  const payload = {
    schema: MEDREG_SCHEMA,
    version: MEDREG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    app: "MedReg",
    // opcional: podés guardar hash/versión de terminología para trazabilidad
    // terminoVersion: window.__terminologiaHash || null,
    estudios: {}
  };
  if (onlyName) {
    if (!estudios[onlyName]) throw new Error("Estudio inexistente: " + onlyName);
    payload.estudios[onlyName] = estudios[onlyName];
  } else {
    payload.estudios = JSON.parse(JSON.stringify(estudios));
  }
  return payload;
}

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("estudio");
  if (!sel) return;
  sel.addEventListener("change", () => {
    if (typeof cargarEstudioSeleccionado === "function") {
      cargarEstudioSeleccionado(sel.value);
    } else if (typeof renderCriterios === "function") {
      renderCriterios(sel.value);
    } else if (typeof renderEstudio === "function") {
      renderEstudio(sel.value);
    }
  });
});


function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// Exportar el estudio actualmente seleccionado en el selector #estudio
async function exportEstudioActual() {
  const nombre = document.getElementById("estudio")?.value;
  if (!nombre || !estudios[nombre]) { alert("Elegí un estudio válido para exportar."); return; }
  const pkg = buildStudyPackage({ onlyName: nombre });
  const safe = nombre.replace(/[^\p{L}\p{N}\-_]+/gu, "_");
  downloadJSON(pkg, `${safe}.medreg.json`);
}

// Exportar todos los estudios
async function exportTodosLosEstudios() {
  if (!estudios || !Object.keys(estudios).length) { alert("No hay estudios cargados."); return; }
  const pkg = buildStudyPackage({});
  downloadJSON(pkg, `medreg_todos_${new Date().toISOString().slice(0,10)}.medreg.json`);
}

// Validar paquete importado
function validateImportedPackage(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Archivo inválido.");
  if (obj.schema !== MEDREG_SCHEMA) throw new Error("Esquema desconocido.");
  if (typeof obj.version !== "number" || obj.version < 1) throw new Error("Versión de esquema no soportada.");
  if (!obj.estudios || typeof obj.estudios !== "object") throw new Error("Contenido de estudios faltante.");
  // validación suave de cada estudio (estructura mínima)
  for (const [name, data] of Object.entries(obj.estudios)) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Nombre de estudio inválido.");
    if (!data || typeof data !== "object") throw new Error(`Estudio "${name}" mal formado.`);
    // podés agregar checks de tus campos: data.Antecedentes, data.Riesgo, etc.
  }
  return true;
}

// Importar paquete y mergear/overwrittear
async function importEstudiosFromFile(file) {
  const txt = await file.text();
  let obj = null;
  try { obj = JSON.parse(txt); } catch { throw new Error("JSON inválido."); }
  validateImportedPackage(obj);

  const nombres = Object.keys(obj.estudios);
  if (!nombres.length) { alert("El archivo no contiene estudios."); return; }

  // Resolver colisiones (mismo nombre)
  let overwritten = 0, created = 0;
  for (const name of nombres) {
    const exists = !!estudios[name];
    if (exists) {
      const ok = confirm(`El estudio "${name}" ya existe. ¿Querés reemplazarlo?`);
      if (!ok) continue;
      estudios[name] = obj.estudios[name]; // overwrite
      overwritten++;
    } else {
      estudios[name] = obj.estudios[name]; // create
      created++;
    }
  }

  // Persistir (si venías usando chrome.storage)
  try { await chrome.storage.local.set({ estudios }); } catch {}
// -- refrescar UI para que se vea enseguida --
const sel = document.getElementById("estudio");
if (sel) {
  const current = sel.value;                       // lo que estaba seleccionado
  const importados = Object.keys(obj.estudios);    // nombres importados
  // si se reemplazó el actual, lo dejamos seleccionado; si no, mostramos el primero importado
  const prefer = importados.includes(current) ? current : (importados[0] || current);
  sel.value = prefer;
  // dispara el render que ya tenés enganchado al 'change'
  // REFRESH sin inline handlers (CSP-friendly)
if (typeof cargarEstudioSeleccionado === "function") {
  cargarEstudioSeleccionado(sel.value);
} else if (typeof renderCriterios === "function") {
  renderCriterios(sel.value);
} else if (typeof renderEstudio === "function") {
  renderEstudio(sel.value);
} else {
  console.warn("No encontré función de refresco. Quitá el onchange inline y usá addEventListener.");
}

}

  // Refrescar UI: selector y panel
  try {
    const sel = document.getElementById("estudio");
    if (sel) {
      // repoblar opciones
      sel.innerHTML = "";
      Object.keys(estudios).sort().forEach(n => {
        const opt = document.createElement("option");
        opt.value = n; opt.textContent = n;
        sel.appendChild(opt);
      });
    }
  } catch {}


  
// fallback opcional si no existe listener al 'change'
if (typeof cargarEstudioSeleccionado === "function") {
  cargarEstudioSeleccionado(sel.value);
} else if (typeof renderCriterios === "function") {
  renderCriterios(sel.value);
}

  alert(`Importación lista. Creados: ${created} · Reemplazados: ${overwritten}`);
}


// Hooks seguros (CSP-friendly) para Importar / Exportar
document.addEventListener('DOMContentLoaded', () => {
  const btnExpUno   = document.getElementById('btnExportarEstudio');
  const btnExpTodos = document.getElementById('btnExportarTodos');
  const btnImp      = document.getElementById('btnImportarEstudio');
  const inpImp      = document.getElementById('inputImportEstudio');

  if (btnExpUno)   btnExpUno.addEventListener('click', () => exportEstudioActual());
  if (btnExpTodos) btnExpTodos.addEventListener('click', () => exportTodosLosEstudios());

  if (btnImp && inpImp) {
    btnImp.addEventListener('click', () => inpImp.click());
    inpImp.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        await importEstudiosFromFile(f);
      } catch (err) {
        alert('No pude importar: ' + (err?.message || err));
      } finally {
        e.target.value = ''; // resetea para permitir re-selección
      }
    });
  }
});


////////////////////////////////////////////////////////////////////// 01-11

function collectAllCriteriosForIA() {
  const out = [];
  document.querySelectorAll('#contenedorCriterios .criterio').forEach(div => {
    const clave = div.querySelector('.texto-clave')?.textContent?.trim() ||
                  div.querySelector('.label')?.textContent?.trim() || '';
    const cat = div.getAttribute('data-cat') || '';
    const comentario = div.querySelector('.coment, .comentario, textarea')?.value?.trim() || '';
    const operador = div.querySelector('.operador')?.value || div.querySelector('.operadorSelect')?.value || '';
    const v1 = div.querySelector('.valor1, .valorOperador')?.value || '';
    const v2 = div.querySelector('.valor2')?.value || '';
    if (clave) out.push({ categoria: cat, clave, operador, v1, v2, comentario });
  });
  return out;
}

async function getRawFromInvExtractions() {
  const items = await loadInvExtractions();
  return items.map(x => x.rawText || '').filter(Boolean).join('\n\n---\n\n').slice(0, 8000);
}


// ===================== IA (stub) =====================
// ===================== IA – BLOQUE COMPLETO (Chat IA separado de Protocolos) =====================

// ---------- Helpers de "Protocolos/Estudio local" (se mantienen para esas secciones) ----------
async function getSelectedProtocolosData() {
  let data = await getCachedProtocolos();
  if (!data) { try { data = await fetchProtocolosRaw(); } catch { data = []; } }
  const setSel = await getSelectedProtocolos();
  return Array.from(setSel).sort((a, b) => a - b).map((idx) => normalizeEstudio(data[idx], idx));
}

async function getRawFromExtractions() {
  const KEY = "medreg.extractions";
  const { [KEY]: arr } = await chrome.storage.local.get(KEY);
  const items = Array.isArray(arr) ? arr : [];
  return items.map((x) => x.rawText || "").filter(Boolean).join("\n\n---\n\n");
}

async function armarPayloadCruce() {
  const estudiosSel = await getSelectedProtocolosData();
  const raw = await getRawFromExtractions();
  return { estudios: estudiosSel, raw };
}


async function fetchJSONorThrow(url, opts){
  const res = await fetch(url, opts);
  const txt = await res.text();
  if (!res.ok){
    const msg = txt ? `HTTP ${res.status}: ${txt}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  try { return JSON.parse(txt); } catch { return txt; }
}

// ---------- Envío para PROTOCOLOS (usa estudios + contexto). NO se usa en Chat IA ----------

async function sendToBackendInvestigadorIA() {
  try {
    // --- 1) Recolectar texto extraído ---
    const items = await loadInvExtractions();
    const raw = items.map(x => x.rawText || '').join('\n\n---\n\n').slice(0, 8000);
    if (!raw) throw new Error('No hay texto en el box de extracciones.');

    // --- 2) Recolectar criterios visibles ---
    const criterios = [];
    document.querySelectorAll('#contenedorCriterios .criterio').forEach(div => {
      const clave = div.querySelector('.texto-clave')?.textContent?.trim() || '';
      const cat = div.getAttribute('data-cat') || '';
      const obs = div.querySelector('textarea, .comentario')?.value?.trim() || '';
      if (clave) criterios.push({ categoria: cat, clave, observacion: obs });
    });

    // --- 3) Armar prompt para la IA ---
    const prompt = `
Analizá el texto clínico siguiente y cruzalo con los criterios listados.
Indicá para cada criterio si:
- se cumple (✓)
- no se cumple (×)
- o es dudoso (?)
Incluí una breve evidencia o frase que justifique tu evaluación.

=== TEXTO CLÍNICO ===
${raw}

=== CRITERIOS ===
${criterios.map((c, i) => `${i + 1}. ${c.clave}${c.observacion ? ' — ' + c.observacion : ''}`).join('\n')}
`;

    // --- 4) Enviar al backend /chat_ia ---
    const res = await fetch(`${API_BASE}/chat_ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        context_raw: raw,
        estudios: [{ nombre: 'Estudio local', descripcion: 'Evaluación de criterios visibles del investigador' }],
        session_id: 'inv-' + (await getActiveTab())?.id
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.answer || '(sin respuesta)';
  } catch (err) {
    console.error('[MedReg] Análisis IA (INV) falló:', err);
    throw err;
  }
}


// ---------- Chat IA: solo contexto de EXTRACCIONES/DROP (nada de estudios) ----------
async function getContextFromExtractionsOnly() {
  const raw = await getRawFromExtractions();
  return (raw || '').slice(0, 8000);
}

async function sendToBackendChat(message){
  const body = {
    message,
    context_raw: await getContextFromExtractionsOnly(),
    session_id: 'tab-' + (await getActiveTab())?.id
  };
  const res = await fetch(`${API_BASE}/chat_ia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.answer || '(sin respuesta)';
}

// ---------- OpenRouter (Chat IA conversacional) ----------
const OPENROUTER_KEY_STORAGE = 'medreg.openrouter_key';
const OPENROUTER_MODEL_STORAGE = 'medreg.openrouter_model';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function setOpenRouterKeySecure(key){
  await chrome.storage.sync.set({ [OPENROUTER_KEY_STORAGE]: key || '' });
}
async function getOpenRouterKeySecure(){
  const st = await chrome.storage.sync.get(OPENROUTER_KEY_STORAGE);
  return st[OPENROUTER_KEY_STORAGE] || '';
}
async function setOpenRouterModel(model){
  await chrome.storage.sync.set({ [OPENROUTER_MODEL_STORAGE]: model || 'openai/gpt-4o-mini' });
}
async function getOpenRouterModel(){
  const st = await chrome.storage.sync.get(OPENROUTER_MODEL_STORAGE);
  return st[OPENROUTER_MODEL_STORAGE] || 'openai/gpt-4o-mini';
}

// ---------- Historial por pestaña (no duplicar estas funciones en el archivo) ----------
function chatSessionKey(tabId) { return `medreg.chat.history.tab.${tabId || 'na'}`; }
async function getCurrentTabId() {
  try { const tab = await getActiveTab(); return tab?.id || 'na'; } catch { return 'na'; }
}
async function loadChatHistory() {
  const key = chatSessionKey(await getCurrentTabId());
  const st = await chrome.storage.session.get(key);
  return Array.isArray(st[key]) ? st[key] : [];
}
async function saveChatHistory(history) {
  const key = chatSessionKey(await getCurrentTabId());
  await chrome.storage.session.set({ [key]: Array.isArray(history) ? history : [] });
}
async function renderStoredChatHistory() {
  const box = document.getElementById('ai-chat-messages');
  if (!box) return;
  const hist = await loadChatHistory();
  box.innerHTML = '';
  for (const m of hist) aiPushMessage(m.role, m.content);
}



// Hace scroll para que la ÚLTIMA burbuja quede visible desde la primera línea
// Hace scroll SOLO dentro de #ai-chat-messages
// llevando la última burbuja al inicio del área de chat
function aiScrollToLast() {
  const box = document.getElementById('ai-chat-messages');
  if (!box) return;
  const last = box.lastElementChild;
  if (!last) return;

  // Margen en píxeles por encima de la burbuja
  const margin = 80; // probá 40, 60, 80 según cuánto quieras ver
  let top = last.offsetTop - margin;
  if (top < 0) top = 0;

  box.scrollTo({ top, behavior: 'smooth' });
}


// ---------- UI helpers (Chat tipo conversación) ----------
// ---------- UI helpers (Chat tipo conversación) ----------
// ---------- UI helpers (Chat tipo conversación) ----------
// ---------- UI helpers (Chat tipo conversación) ----------
function aiPushMessage(role, text){
  const box = document.getElementById('ai-chat-messages');
  if (!box) return;

  // Usuario: simple (sin botón de copiar)
  if (role !== 'assistant') {
    const msg = document.createElement('div');
    msg.className = `chat-bubble ${role}`;
    msg.textContent = text;
    box.appendChild(msg);

    return;
  }

  // Assistant: con copiar y drag
  ensureChatCopyStyles();
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant';

  const content = document.createElement('div');
  content.className = 'chat-content';
  content.textContent = String(text || '');

  const btn = document.createElement('span');
  btn.className = 'chat-copy';
  btn.title = 'Copiar respuesta';
  btn.setAttribute('role','button');
  btn.setAttribute('tabindex','0');
  btn.textContent = '⧉';

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(content.textContent || '');
      const old = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = old, 900);
    } catch (err) {
      console.error('[MedReg] No pude copiar:', err);
    }
  };
  btn.addEventListener('click', (ev)=>{ ev.stopPropagation(); doCopy(); });
  btn.addEventListener('keydown', (ev)=>{ 
    if (ev.key==='Enter' || ev.key===' ') { 
      ev.preventDefault(); 
      doCopy(); 
    } 
  });

  const setDragData = (ev) => {
    try {
      ev.dataTransfer?.setData('text/plain', content.textContent || '');
      ev.dataTransfer.effectAllowed = 'copy';
    } catch {}
  };
  el.setAttribute('draggable','true');
  btn.setAttribute('draggable','true');
  el.addEventListener('dragstart', setDragData);
  btn.addEventListener('dragstart', setDragData);

  el.appendChild(content);
  el.appendChild(btn);
  box.appendChild(el);

  // 👇 y también baja cuando responde la IA
  aiScrollToLast();
}




function aiSetPending(p=true){
  const btn = document.getElementById('btnEnviarIA');
  if (btn){ btn.disabled = !!p; btn.textContent = p ? 'Enviando…' : 'Enviar'; }
}


// ---------- Estilos visuales (burbujas de chat) ----------
(function ensureChatStyles(){
  if (document.getElementById('medreg-chat-style')) return;
  const st = document.createElement('style');
  st.id = 'medreg-chat-style';
  st.textContent = `
  #ai-chat-messages {
    display:flex;
    flex-direction:column;
    gap:8px;
    max-height:420px;
    overflow-y:auto;
    padding:6px;
    border:1px solid #1c2a4d;
    border-radius:6px;
    background:#1c2a4d;
  }
  .chat-bubble {
    max-width:85%;
    padding:8px 10px;
    border-radius:10px;
    white-space:pre-wrap;
    word-wrap:break-word;
    line-height:1.4;
  }
  .chat-bubble.user {
    align-self:flex-end;
    background:#007bff;
    color:#fff;
  }
  .chat-bubble.assistant {
    align-self:flex-start;
    background:#e8e8e8;
    color:#000;
  }`;
  document.head.appendChild(st);
})();

// ---------- Chat IA interactivo ---------
// // ---------- Construcción de mensajes (Chat IA) — versión sin "clinical intent" ----------
async function buildOpenRouterMessages(userMessage){
  const contexto = await getContextFromExtractionsOnly();

  // leer modo desde localStorage (default: detallada)
  const mode = (localStorage.getItem('medreg.aiMode_v1') || 'detailed');

  let systemPrompt = `
Sos un asistente clínico en español para un cardiólogo que trabaja con varias historias clinicas.
POLÍTICA DE RESPUESTA
- Respondé de forma amable y profesional, con pensamiento y razonamiento medico.
- Usá el contexto extraído/dropeado y lo que el médico escriba en el chat. No inventes datos. Sino pregunta.
- Segui la linea de razonamiento del médico, y la conversación previa si la hay. Sos su copiloto.
- Responde con datos precisos y explica tu decision con fundamento justificado.
- No repitas el texto del médico ni el contexto.
- Cita el nivel de indicacion que tiene tu respuesta (p. ej., clase I, IIa, IIb, III) si aplica.
- Basá las recomendaciones en consensos/guidelines vigentes (p. ej., SAC/SAHA/ESC/ACC/AHA) menciona la cita en los casos que correspondan.
- Si no tenés suficiente información, pedí más datos específicos.
- No hagas suposiciones sin fundamento.
FORMATO: NO uses Markdown ni asteriscos para resaltar (**texto**, *texto*, viñetas con -, •, etc.). SI utiliza saltos de linea y texto en negrita si es necesario.
  `.trim();

  if (mode === 'brief') {
    systemPrompt += `
- MODO BREVE: respondé en forma CONCRETA y CORTA (máximo 3–4 frases).
- Ir directo al punto, sin introducciones largas ni repetir el contexto.
- Si falta información importante, pedila en una sola frase final.`;
  } else {
    systemPrompt += `
- MODO DETALLADO: podés explayarte cuando haga falta para justificar la conducta.
- Organizá la respuesta en párrafos claros; usá listas solo si mejoran la claridad.`;
  }

  const history = await loadChatHistory();
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  if (contexto) {
    messages.push({
      role: 'system',
      content: `Contexto del paciente (NO lo repitas en la respuesta):\n${contexto}`
    });
  }
  // Historial previo del chat
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }

  // Turno actual del médico
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

// === Burbujas en vivo (streaming) ===

// === Burbujas en vivo (streaming) ===
function aiStartAssistantBubble() {
  ensureChatCopyStyles();

  const box = document.getElementById('ai-chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant';

  const content = document.createElement('div');
  content.className = 'chat-content';
  content.textContent = '';

  const btn = document.createElement('span'); // ← span, no button
  btn.className = 'chat-copy';
  btn.title = 'Copiar respuesta';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.textContent = '⧉';

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(content.textContent || '');
      const old = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = old, 900);
    } catch (err) {
      console.error('[MedReg] No pude copiar:', err);
    }
  };
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doCopy();
  });
  btn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      doCopy();
    }
  });

  // Drag → “Extracciones”
  const setDragData = (ev) => {
    try {
      ev.dataTransfer?.setData('text/plain', content.textContent || '');
      ev.dataTransfer.effectAllowed = 'copy';
    } catch {}
  };
  el.setAttribute('draggable', 'true');
  btn.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', setDragData);
  btn.addEventListener('dragstart', setDragData);

  el.appendChild(content);
  el.appendChild(btn);
  box.appendChild(el);

  // 👇 scroll UNA sola vez, cuando se crea la burbuja de la IA
  aiScrollToLast();

  return el;
}

function aiAppendToBubble(el, chunk) {
  if (!el || !chunk) return;
  const tgt = el.querySelector?.('.chat-content') || el;
  tgt.textContent += chunk;
  // 👇 NO hacemos scroll en cada token: dejamos el scroll quieto
}

function aiFinishAssistantBubble(_el) {
  // de momento no hace nada especial al terminar la respuesta
}


function aiShowTypingIndicator(show=true){
  let tip = document.getElementById('ai-typing-dot');
  if (show) {
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ai-typing-dot';
      tip.className = 'chat-bubble assistant';
      tip.textContent = '…';
      const box = document.getElementById('ai-chat-messages');
      box.appendChild(tip);
      // ⛔️ sin auto-scroll
    }
  } else {
    tip?.remove();
  }
}

// === Streaming SSE con OpenRouter ===
// Formato SSE compatible con chat.completions (delta.content)
async function sendToOpenRouterMessagesStream(messages, {
  onToken, onDone, onError,
  temperature = 0.1, top_p = 0.9, max_tokens = 2000
} = {}) {
  const key = await getOpenRouterKeySecure();
  if (!key) throw new Error('Falta configurar la API key de OpenRouter.');
  const model = (document.getElementById('openrouterModel')?.value) || await getOpenRouterModel();
  setOpenRouterModel(model).catch(()=>{});

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'HTTP-Referer': 'https://medex.ar',
      'X-Title': 'MedReg - Sidebar'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      top_p,
      max_tokens,
      stream: true
    })
  });

  if (!res.ok || !res.body) {
    const errTxt = await res.text().catch(()=>String(res.status));
    throw new Error(`OpenRouter HTTP ${res.status}: ${errTxt}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE llega separado por \n\n
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // queda resto

      for (const chunk of parts) {
        // líneas "data: <json>" (o "data: [DONE]")
        const lines = chunk.split('\n').map(s => s.trim());
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.replace(/^data:\s?/, '');
          if (dataStr === '[DONE]') {
            onDone?.();
            return;
          }
          try {
            const obj = JSON.parse(dataStr);
            // OpenAI-like delta
            const delta = obj?.choices?.[0]?.delta?.content
                       ?? obj?.choices?.[0]?.message?.content // por si algún proveedor manda chunks completos
                       ?? '';
            if (delta) onToken?.(delta);
          } catch(e) {
            // ignorar JSON parcial
          }
        }
      }
    }
    onDone?.();
  } catch (e) {
    onError?.(e);
    throw e;
  }
}

// ---- Scroll helpers del sidebar ----
function _scrollContainer(){
  // El panel de la extensión scrollea el documento, no #chatSection
  return document.scrollingElement || document.documentElement || document.body;
}
function scrollSidebarToTop(){ const sc = _scrollContainer(); sc.scrollTo({ top: 0, behavior: 'smooth' }); }
function scrollSidebarToBottom(){ const sc = _scrollContainer(); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); }





async function callOpenRouterInvestigador(prompt){
  const key   = await getOpenRouterKeySecure();          // ya lo tenés
  const model = await getOpenRouterModel();              // ya lo tenés
  if (!key) throw new Error('Falta configurar OpenRouter API key (Chat IA).');

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://medex.ar',
      'X-Title': 'MedReg Investigador'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Eres un asistente clínico. Devuelve SOLO una lista numerada breve y clara, con ✅/❌/insuficiente y una cita breve de evidencia.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });

  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)}`);

  const msg = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
  return (msg || '').trim();
}



// === Renderiza el resultado del análisis INV en la caja de salida ===
function renderResultadoINV(contenido){
  const out = document.getElementById('iaAnalisisOutInv');
  if (!out) {
    console.warn('[MedReg] iaAnalisisOutInv no encontrado');
    return;
  }
  const txt = (contenido || '').toString().trim();
  // Soporta <textarea>, <pre> o <div>
  if (out.tagName === 'TEXTAREA' || out.tagName === 'INPUT') {
    out.value = txt;
  } else {
    out.textContent = txt;
  }
  // Asegura que quede visible
  out.style.display = 'block';
}



// ---- Hook: al extraer HC => scroll al final ----
async function onExtractClick() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (!isInjectableUrl(tab.url)) { alert("No puedo extraer de esta página (chrome://, Web Store o visor PDF). Abrí una HCE http/https."); return; }
    const ready = await ensureContentScript(tab.id);
    if (!ready) { alert("No pude conectar con la página. Recargá la HCE e intentá de nuevo."); return; }

    const payload = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "MEDREG_EXTRACT_DOM" }, (resp) => {
        void chrome.runtime.lastError; resolve(resp || null);
      });
    });
    if (!payload || !payload.rawText) { alert("No se pudo extraer texto desde esta página. Probá recargar la HCE."); return; }

    await addManualExtractionImpl(payload.rawText, {
      tabId: tab.id,
      title: payload.title || tab.title || "Ventana",
      url: payload.url || tab.url || ""
    });

    // ✅ al terminar la extracción, llevar al final del sidebar
    setTimeout(scrollSidebarToBottom, 50);

  } catch (e) {
    console.error("[MedReg] Error en extracción:", e);
    alert("Error al extraer. Revisá permisos y consola.");
  }
}


// ---------- Llamada OpenRouter (ajustada para respuestas concisas y poco "preguntonas") ----------
async function sendToOpenRouterMessages(messages){
  const key = await getOpenRouterKeySecure();
  if (!key) throw new Error('Falta configurar la API key de OpenRouter.');
  const model = (document.getElementById('openrouterModel')?.value) || await getOpenRouterModel();
  setOpenRouterModel(model).catch(()=>{});

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://medex.ar',
      'X-Title': 'MedReg - Sidebar'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,         // menos divagación
      top_p: 0.9,
      frequency_penalty: 0.4,   // reduce repeticiones/eco
      presence_penalty: 0.0,
      max_tokens: 2000
    })
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(()=>String(res.status));
    throw new Error(`OpenRouter HTTP ${res.status}: ${errTxt}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '(sin respuesta)';
  return content;
}

// ---------- Unificado: OpenRouter primero → fallback backend CHAT (no Protocolos) ----------
// ---------- Unificado: OpenRouter primero → fallback backend CHAT (sin duplicar burbujas) ----------
async function sendAIUnified(message){
  // 1) Intento streaming con OpenRouter
  try {
    const messages = await buildOpenRouterMessages(message);
    const bubble = aiStartAssistantBubble();
    aiShowTypingIndicator(true);

    await sendToOpenRouterMessagesStream(messages, {
      onToken: (t) => aiAppendToBubble(bubble, t),
      onDone: async () => {
        aiShowTypingIndicator(false);
        aiFinishAssistantBubble(bubble);
        // guardar en historial la respuesta ya renderizada
        const histA = await loadChatHistory();
        histA.push({ role: 'assistant', content: bubble.textContent });
        await saveChatHistory(histA);
      },
      onError: () => { aiShowTypingIndicator(false); }
    });

    // Como ya streameamos y guardamos, devolvemos text + flag
    return { text: document.querySelector('#ai-chat-messages .chat-bubble.assistant:last-child')?.textContent || '', streamed: true };
  } catch (e) {
    console.warn('[MedReg] Streaming OpenRouter falló, intento no-stream:', e);
  }

  // 2) Fallback: OpenRouter sin streaming
  try {
    const ans = await sendToOpenRouterMessages(await buildOpenRouterMessages(message));
    return { text: ans, streamed: false };
  } catch (e2) {
    console.warn('[MedReg] OpenRouter no-stream falló, intento backend /chat_ia:', e2);
  }

  // 3) Fallback final: backend local /chat_ia (sin streaming)
  const ans = await sendToBackendChat(message);
  return { text: ans, streamed: false };
}

// ---------- Wiring de UI del Chat IA (único listener; sin duplicados) ----------
(function initAIChatUI(){
  if (window._aiChatInit) return;          // <-- evita listeners duplicados
  window._aiChatInit = true;

  const btnSend  = document.getElementById('btnEnviarIA');
  const btnClr   = document.getElementById('btnLimpiarIA');
  const txt      = document.getElementById('ai_question');
  const btnKey   = document.getElementById('btnSetOpenRouterKey');
  const selModel = document.getElementById('openrouterModel');

   // Switch de modo de respuesta (breve / detallada)
  const modeToggle = document.getElementById('aiModeToggle');
  const modeLabel  = document.getElementById('aiModeLabel');
  const AI_MODE_KEY = 'medreg.aiMode_v1';

  function applyModeLabel(mode){
    if (!modeLabel) return;
    modeLabel.textContent = (mode === 'brief') ? 'Concreta' : 'Detallada';
  }

  // Cargar modo guardado
  let savedMode = localStorage.getItem(AI_MODE_KEY) || 'detailed';

  if (modeToggle) {
    // checked = detallada
    modeToggle.checked = (savedMode === 'detailed');
    applyModeLabel(savedMode);

    modeToggle.addEventListener('change', ()=>{
      const mode = modeToggle.checked ? 'detailed' : 'brief';
      localStorage.setItem(AI_MODE_KEY, mode);
      applyModeLabel(mode);
    });
  }


  // Modelo preferido
  getOpenRouterModel().then((m)=>{ if (selModel) selModel.value = m; }).catch(()=>{});

  // Guardar / pedir API key
  btnKey && btnKey.addEventListener('click', async ()=>{
    const old = await getOpenRouterKeySecure();
    const k = prompt('Pegá tu API key de OpenRouter', old || '');
    if (k !== null) {
      await setOpenRouterKeySecure(k.trim());
      alert('API key guardada en Chrome (sync).');
    }
  });
 
async function sendMsg(q, showUser=true){
  const box = document.getElementById('ai-chat-messages');
  if (!q || !box) return;

  // 👇 MOSTRAR burbuja del usuario y persistir en historial
  if (showUser) {
    aiPushMessage('user', q);
    const histU = await loadChatHistory();
    histU.push({ role: 'user', content: q });
    await saveChatHistory(histU);
  }

  aiSetPending(true);
  try {
    const { text, streamed } = await sendAIUnified(q);
    if (!streamed) {
      aiPushMessage('assistant', text || '(sin respuesta)');
      const histA = await loadChatHistory();
      histA.push({ role: 'assistant', content: text || '(sin respuesta)' });
      await saveChatHistory(histA);
    }
  } catch (e) {
    aiPushMessage('assistant', `⚠️ ${e?.message || e}`);
  } finally {
    aiSetPending(false);
    const txt = document.getElementById('ai_question');
    if (txt) txt.value = '';
  }
}



  // después de definir async function sendMsg(q, showUser=true){...}
window.medregSendMsg = sendMsg;


  // Enviar por botón
  btnSend && btnSend.addEventListener('click', ()=> sendMsg((txt?.value || '').trim(), true));

  // Enter para enviar (sin Shift)
  txt && txt.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMsg((txt?.value || '').trim(), true);
    }
  });

  // Limpiar chat + historial de esta pestaña
  btnClr && btnClr.addEventListener('click', async ()=>{
    const box = document.getElementById('ai-chat-messages');
    if (box) box.innerHTML = '';
    if (txt) txt.value = '';
    const tabId = await getCurrentTabId();
    await chrome.storage.session.remove(chatSessionKey(tabId));
  });



// === Prompts parametrizados: config ===
// === Prompts parametrizados: config ===
const PARAM_PROMPTS = {
  'riesgo-prequirurgico': {
    title: 'Riesgo prequirúrgico',
    fields: [
      { key:'procedimiento', label:'Procedimiento/Cirugía', type:'text', placeholder:'p.ej., colecistectomía laparoscópica' },
      { key:'urgencia', label:'Urgencia', type:'select', options:['Programada','Urgente'] }
    ],
    template: ({procedimiento, urgencia}) =>
      `Valoración de riesgo prequirúrgico para **${procedimiento}** (${urgencia}). ` +
      `Responde con: 1) Clasificación de riesgo clínico-quirúrgico según guía Consenso Argentino de Evaluación de Riesgo Cardiovascular en Cirugía no Cardiaca 2020: devolver si es Leve, Moderado o Alto, ` +
      `2) Si el paciente evaluado requiere: ajustes (anticoagulantes/antiagregantes, antibiótico profilaxis, hipoglucemiantes, etc.), ` +
      `3) Si requiere algun examen complementario extra ademas de los presentados o no. ` +
      `Máx. 1 repregunta sólo si es crítica.`
  },

  'justificativo-os': {
    title: 'Justificativo para Obra Social',
    fields: [
      { key:'tipo', label:'Tipo de justificativo', type:'select', options:['Medicación','Estudio/Procedimiento'] },
      { key:'item', label:'Nombre de la medicación/estudio', type:'text', placeholder:'p.ej., Finerenona 10 mg' },
      { key:'objetivo', label:'Objetivo clínico', type:'text', placeholder:'p.ej., reducir progresión ERC diabética' }
    ],
    template: ({tipo, item, objetivo}) =>
       `En el encabezado al iniciar al texto consigna los datos filiatorios hallados separados por linea como una carta: Apellido, Nombre, DNI, Edad, Fecha de nacimiento, Obra social/cobertura, numero de afiliado. ` +
      `Redactar justificativo para Obra Social por **${tipo}**: **${item}**. ` +
      `Incluir: indicación clínica (1–2 líneas), beneficio esperado (“${objetivo}”), ` +
      `riesgo de no otorgarlo, y cierre tipo “Se solicita cobertura según guías vigentes (citar)”.`
  },
  'scores-de-riesgo': {
  title: 'Scores de Riesgo',
  fields: [
    { key:'score', label:'Score', type:'select', options:[
      'CHA2DS2-VASc',
      'HAS-BLED',
      'GRACE (ACS)',
      'TIMI UA/NSTEMI',
      'Wells (TEP)',
      'Ginebra (TEP)',
      'PERC',
      'DAPT',
      'Killip-Kimball',
      'STS (riesgo quirúrgico)',
      'EuroSCORE II'
    ]},
    { key:'detalle', label:'Detalle', type:'select', options:['Resumido','Completo'] }
  ],
  template: ({score, detalle}) => {
    const req = (detalle === 'Resumido')
      ? 'Devolvé valor y categoría (bajo/medio/alto) y una línea de interpretación.'
      : 'Lista cada ítem con su puntaje, suma total, categoría y breve interpretación.';
    return (
`Calculá el score **${score}** usando SOLO los datos presentes en las extracciones actuales del paciente.
${req}
Si falta un dato crítico, pedí **una** repregunta clara y corta.

Formato sugerido:
- Score: ${score}
- Resultado numérico: <valor>
- Categoría: <bajo/medio/alto>
- Ítems evaluados: <si corresponde>
- Comentario: <1–2 líneas>`
    );
  }
},


  'evolucion': {
    title: 'Evolución diaria',
    fields: [
      { key:'motivointernacion', label:'Motivo de internación', type:'text', placeholder:'p.ej., insuficiencia cardíaca descompensada' },
      { key:'examenfisico', label:'Examen físico', type:'text', placeholder:'p.ej., FC/PA, hallazgos relevantes'  },
      { key:'observacion', label:'Observaciones / Plan', type:'text', placeholder:'p.ej., continuar balance negativo, día 3 ATB' }
    ],
    template: ({motivointernacion, examenfisico, observacion}) =>
      `Armá una evolución diaria de internación. ` +
      `Motivo: **${motivointernacion}**. ` +
      `Incluí: signos vitales, balance hídrico, examen físico (${examenfisico}), resultados recientes de laboratorio/imágenes, ` +
      `conducta/plan (${observacion}). ` +
      `Cerrá con 1 línea de interpretación/impresión clínica de IA.`
  },
};

// === Heurística básica: intentar precompletar desde el contexto ===
// === Heurística básica para precompletar desde contexto (ya la tenías)
async function prefillFromContext(keysNeeded){
  const ctx = (await getContextFromExtractionsOnly()) || '';
  const out = {};
  if (keysNeeded.includes('procedimiento')) {
    const m = ctx.match(/(cirug[ií]a|procedimiento|intervenci[oó]n)\s*[:\-]\s*([^\n\.]{5,80})/i);
    if (m) out.procedimiento = m[2].trim();
  }
  // Podés ir sumando heurísticas simples para otras claves si querés
  return out;
}

// === Recientes (ya los usás más abajo; los dejo acá por si los moviste)
async function getPromptRecent(key){
  const k = `medreg.prompt.recent.${key}`;
  const st = await chrome.storage.local.get(k);
  return st[k] || {};
}
async function setPromptRecent(key, data){
  const k = `medreg.prompt.recent.${key}`;
  await chrome.storage.local.set({ [k]: data || {} });
}

// =================== UI del Modal Parametrizable ===================
function ensureParamPromptStyles(){
  if (document.getElementById('pp2-style')) return;
  const st = document.createElement('style');
  st.id = 'pp2-style';
  st.textContent = `
    #pp2-root{position:fixed;inset:0;z-index:9999;display:none}
    #pp2-root .pp2-backdrop{position:absolute;inset:0;background:rgba(16,24,40,.68)}
    #pp2-root .pp2-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(560px,95vw);background:#fff;border-radius:12px;padding:14px;box-shadow:0 20px 40px rgba(0,0,0,.28);
      display:flex;flex-direction:column;gap:10px}
    #pp2-root .pp2-title{font-weight:700;color:#0d47a1}
    #pp2-form .pp2-row{display:flex;flex-direction:column;gap:6px;margin:6px 0}
    #pp2-form label{font-size:13px;color:#334155;font-weight:600}
    #pp2-form input, #pp2-form select, #pp2-form textarea{
      border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:14px;width:100%;
    }
    #pp2-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
    #pp2-actions .btn{background:#0d47a1;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer}
    #pp2-actions .btn.muted{background:#e2e8f0;color:#0f172a}
  `;
  document.head.appendChild(st);
}
function ensureParamPromptDOM(){
  if (document.getElementById('pp2-root')) return;
  const root = document.createElement('div');
  root.id = 'pp2-root';
  root.innerHTML = `
    <div class="pp2-backdrop"></div>
    <div class="pp2-card" role="dialog" aria-modal="true" aria-labelledby="pp2-title">
      <div id="pp2-title" class="pp2-title">Completar</div>
      <div id="pp2-desc" style="font-size:13px;color:#475569"></div>
      <form id="pp2-form"></form>
      <div id="pp2-actions">
        <button type="button" id="pp2-cancel" class="btn muted">Cancelar</button>
        <button type="button" id="pp2-ok" class="btn">Generar</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('.pp2-backdrop').addEventListener('click', ()=> root.style.display='none');
  document.getElementById('pp2-cancel').addEventListener('click', ()=> root.style.display='none');
}
function pp2Show(){ document.getElementById('pp2-root').style.display='block'; }
function pp2Hide(){ document.getElementById('pp2-root').style.display='none'; }

function renderParamRow(f, val=''){
  const id = `pp2-${f.key}`;
  if (f.type === 'select') {
    const opts = (f.options||[]).map(o=>`<option value="${o}">${o}</option>`).join('');
    return `<div class="pp2-row">
      <label for="${id}">${f.label}</label>
      <select id="${id}">${opts}</select>
    </div>`;
  }
  const ph = f.placeholder ? `placeholder="${f.placeholder}"` : '';
  const isLong = (f.type === 'textarea');
  const tag = isLong ? 'textarea' : 'input';
  const attrs = isLong ? `rows="3"` : `type="text"`;
  return `<div class="pp2-row">
    <label for="${id}">${f.label}</label>
    <${tag} id="${id}" ${attrs} ${ph}></${tag}>
  </div>`;
}


function resolveParamKey(raw){
  const s = (raw || '').toLowerCase();
  // 1º scores (para evitar que "riesgo" capture este botón)
  if (s.includes('score') || s.includes('scores')) return 'scores-de-riesgo';
  // 2º riesgo prequirúrgico
  if (s.includes('preqx') || s.includes('prequir')) return 'riesgo-prequirurgico';
  // 3º justificativos OS
  if (s.includes('justific')) return 'justificativo-os';
  // 4º evolución/otros
  if (s.includes('evolu')) return 'evolucion';
  return (raw || '').trim();
}




// === Apertura del modal + armado del prompt final
async function openParamPrompt(keyLike){
  const k = resolveParamKey(keyLike);
  const cfg = PARAM_PROMPTS[k];
  if (!cfg) {
    alert('Prompt no configurado: ' + keyLike);
    return;
  }

  ensureParamPromptStyles();
  ensureParamPromptDOM();

  const titleEl = document.getElementById('pp2-title');
  const descEl  = document.getElementById('pp2-desc');
  const formEl  = document.getElementById('pp2-form');
  const okBtn   = document.getElementById('pp2-ok');

  titleEl.textContent = cfg.title;
  descEl.textContent  = 'Completá los datos. Usaremos también el contexto extraído de la HCE que ya tengas en “Extracciones”.';

  const keys = (cfg.fields||[]).map(f=>f.key);
  const fromCtx = await prefillFromContext(keys);
  const recent  = await getPromptRecent(k);
  const initVals = Object.assign({}, recent, fromCtx);

  formEl.innerHTML = (cfg.fields||[]).map(f => renderParamRow(f)).join('');
  (cfg.fields||[]).forEach(f => {
    const el = document.getElementById(`pp2-${f.key}`);
    if (!el) return;
    const v = (initVals[f.key] ?? '');
    if (f.type === 'select' && v && Array.from(el.options).some(o => o.value === v)) el.value = v;
    else el.value = v;
  });

  okBtn.onclick = async () => {
    const data = {};
    for (const f of (cfg.fields||[])) {
      const el = document.getElementById(`pp2-${f.key}`);
      data[f.key] = (el?.value || '').trim();
    }
    await setPromptRecent(k, data);
    const finalPrompt = cfg.template(data);

    const sender = window.medregSendMsg || window.sendMsg;
    if (typeof sender === 'function') {
      pp2Hide();
      sender(finalPrompt, false);
    } else {
      alert('No pude enviar el prompt. Recargá el sidebar.');
    }
  };

  pp2Show();
}

// === Wiring: clicks en botones con data-pprompt="..." ===
(function wireParamPromptButtons(){
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-pprompt]');
    if (!b) return;

    // robustez: intentar inferir la key aunque el atributo tenga un texto largo
    const raw = b.dataset.pprompt || b.getAttribute('data-pprompt') || b.textContent || '';
    const key = resolveParamKey(raw);

    // si el botón está en un form, evitá submit
    if (b.tagName === 'BUTTON' && !b.getAttribute('type')) b.setAttribute('type','button');

    // este listener NO es passive, así que se puede prevenir default
    e.preventDefault();
    openParamPrompt(key);
  }, { capture:true }); // <- sin "passive:true"
})();


// === Guardar “últimos usados” por tipo de prompt (para autocompletar la próxima vez) ===
async function getPromptRecent(key){
  const k = `medreg.prompt.recent.${key}`;
  const st = await chrome.storage.local.get(k);
  return st[k] || {};
}
async function setPromptRecent(key, data){
  const k = `medreg.prompt.recent.${key}`;
  await chrome.storage.local.set({ [k]: data || {} });
}

})();

renderStoredChatHistory().catch(()=>{});


// ===================== Export / CSV helpers (sesión) =====================
function toCSV(rows) {
  if (!rows?.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (s) => {
    const str = (s ?? '').toString();
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','));
  return lines.join('\n');
}
async function loadSessionRows() {
  const { [SESSION_ROWS_KEY]: arr } = await chrome.storage.local.get(SESSION_ROWS_KEY);
  return Array.isArray(arr) ? arr : [];
}
async function saveSessionRows(arr) {
  await chrome.storage.local.set({ [SESSION_ROWS_KEY]: Array.isArray(arr) ? arr : [] });
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ===== Obtener lista de criterios visibles en orden (para armar columnas)
function getCurrentCriteriosList() {
  const list = [];
  document.querySelectorAll("#contenedorCriterios .criterio").forEach((item, idx) => {
    const texto = item.querySelector(".texto-clave")?.textContent?.trim() || `Item ${idx+1}`;
    const chk = item.querySelector(".chk");
    const val = item.querySelector(".valorOperador");
    list.push({
      texto,                                     // descripción del criterio (no se usa en el header, solo por si querés auditar)
      checked: !!(chk && chk.checked),
      comentario: (val?.value || "").trim()
    });
  });
  return list;
}

// ===== Arma UNA fila por caso con columnas ID, Apellido, Nombre, DNI, Observacion, Item1/Comentario1, ...
function collectCaseRow(paciente) {
  const obs = document.getElementById("obs")?.value?.trim() || "";
  const criterios = getCurrentCriteriosList();

  // Cabecera fija:
  const row = {
    "ID":        paciente.id       || "",
    "Apellido":  paciente.apellido || "",
    "Nombre":    paciente.nombre   || "",
    "DNI":       paciente.dni      || "",
    "Observacion": obs
  };

  // Agregamos pares Item N / Comentario N
  criterios.forEach((c, i) => {
    const n = i + 1;
    row[`Item ${n}`] = c.checked ? "✔" : "";
    row[`Comentario ${n}`] = c.comentario || "";
  });

  return row;
}




// ===================== Modal de REGISTRO =====================
function openRegistroModal() {
  document.getElementById('registroModal').style.display = 'flex';
}
function closeRegistroModal() {
  document.getElementById('registroModal').style.display = 'none';
  // no limpiamos campos para poder repetir rápidamente (opcional)
}
async function acceptRegistroModal() {
  const paciente = {
    apellido: document.getElementById('reg_apellido')?.value?.trim() || '',
    nombre:   document.getElementById('reg_nombre')?.value?.trim() || '',
    dni:      document.getElementById('reg_dni')?.value?.trim() || '',
    id:       document.getElementById('reg_id')?.value?.trim() || ''
  };

  // Construye UNA fila por caso con headers = nombre real de cada ítem
  const fila = buildCaseRowForCSV(paciente);

  // Validación mínima: que haya columnas de ítems/campos (no hace falta que estén tildados)
  const tieneAlgunaColumnaDeItem = Object.keys(fila).some(
    k => /\(comentario\)$/.test(k) || (!["ID","Apellido","Nombre","DNI","Observacion"].includes(k))
  );
  if (!tieneAlgunaColumnaDeItem) { alert('No hay criterios en el estudio activo.'); return; }

  // Acumular
  const current = await loadSessionRows();
  current.push(fila);
  await saveSessionRows(current);

  // Feedback + contador
  updateSessionCount(current.length);
  alert(`Caso registrado. Total en la sesión: ${current.length}.`);

  // Cerrar modal (dejamos campos por comodidad)
  closeRegistroModal();
}


function getCurrentCriteriosForCSV() {
  // Lee del DOM lo que se está viendo en #contenedorCriterios
  const items = [];
  document.querySelectorAll("#contenedorCriterios .criterio").forEach((div) => {
    const claveBase = div.getAttribute("data-clave") || ""; // nombre puro del ítem
    const chk = div.querySelector(".chk");
    const comment = div.querySelector(".valorOperador")?.value?.trim() || "";
    items.push({
      header: claveBase,                   // <-- esto será el encabezado de columna
      checked: !!(chk && chk.checked),
      comentario: comment
    });
  });
  return items;
}

function updateSessionCount(n) {
  const sp = document.getElementById('sessionCount');
  if (sp) sp.textContent = n ? `${n} caso(s) en la sesión` : `Sin casos registrados`;
}

// Aplana las filas para CSV, generando encabezados dinámicos compatibles entre sí
function buildCSVFromSessionRows(rows) {
  if (!rows?.length) return '';

  // 1) Descubrir todos los headers en orden de primera aparición
  const headers = [];
  const seen = new Set();

  // Orden base siempre primero:
  const base = ["ID","Apellido","Nombre","DNI","Observacion"];
  base.forEach(h => { seen.add(h); headers.push(h); });

  // Recolecto el resto en orden de aparición por fila
  for (const r of rows) {
    Object.keys(r).forEach((k) => {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    });
  }

  // 2) Escapado CSV
  const esc = (s) => {
    const str = (s ?? '').toString();
    return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
  };

  // 3) Construcción
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => esc(r[h] ?? "")).join(','));
  }
  return lines.join('\n');
}



/////contador

document.addEventListener("DOMContentLoaded", async () => {
  // ... (lo que ya tenías)
  const list = await loadExtractions();
  renderExtractions(list);

  // contador inicial de casos de sesión
  const rows = await loadSessionRows();
  updateSessionCount(rows.length);

  // listeners ya existentes...
});

// ===== Campos libres dinámicos en modal REGISTRO
function addRegistroFieldRow(labelVal = "", valueVal = "") {
  const wrap = document.createElement('div');
  wrap.className = 'inline-group';
  wrap.innerHTML = `
    <input class="reg_field_label" placeholder="Etiqueta (ej. Centro)" value="${labelVal}">
    <input class="reg_field_value" placeholder="Valor" value="${valueVal}">
    <button class="reg_field_del" style="width:auto;background:#ef4444">✕</button>
  `;
  wrap.querySelector('.reg_field_del').addEventListener('click', () => wrap.remove());
  document.getElementById('reg_fields').appendChild(wrap);
}

document.getElementById('reg_add_field')?.addEventListener('click', (e) => {
  e.preventDefault();
  addRegistroFieldRow();
});

function collectRegistroExtraFields() {
  const out = [];
  document.querySelectorAll('#registroModal .reg_field_label').forEach((labEl, i) => {
    const label = (labEl.value || '').trim();
    const valEl = labEl.parentElement.querySelector('.reg_field_value');
    const value = (valEl?.value || '').trim();
    if (label) out.push([label, value]);   // pares [Etiqueta, Valor]
  });
  return out;
}

function getCurrentCriteriosForCSV() {
  // Lee del DOM lo que se está viendo en #contenedorCriterios
  const items = [];
  document.querySelectorAll("#contenedorCriterios .criterio").forEach((div) => {
    const claveBase = div.getAttribute("data-clave") || ""; // nombre puro del ítem
    const chk = div.querySelector(".chk");
    const comment = div.querySelector(".valorOperador")?.value?.trim() || "";
    items.push({
      header: claveBase,                   // <-- encabezado de columna
      checked: !!(chk && chk.checked),
      comentario: comment
    });
  });
  return items;
}

function buildCaseRowForCSV(paciente) {
  const obs = document.getElementById("obs")?.value?.trim() || "";
  const criterios = getCurrentCriteriosForCSV();     // ítems visibles ahora
  const extras = collectRegistroExtraFields();       // pares [Etiqueta, Valor]

  // Cabecera fija
  const row = {
    "ID":        paciente.id       || "",
    "Apellido":  paciente.apellido || "",
    "Nombre":    paciente.nombre   || "",
    "DNI":       paciente.dni      || "",
    "Observacion": obs
  };

  // Campos libres (cada etiqueta se vuelve una columna)
  for (const [label, value] of extras) {
    row[label] = value || "";
  }

  // Ítems: 2 columnas por ítem -> [Nombre] y [Nombre] (comentario)
  criterios.forEach((c) => {
    const colItem = c.header || "Ítem";
    row[colItem] = c.checked ? "✔" : "";
    row[`${colItem} (comentario)`] = c.comentario || "";
  });

  return row;
}
// ===================== Eventos UI principales =================================================================================================================================================================================
const _btnAnalizar = document.getElementById("btnAnalizar"); if (_btnAnalizar) _btnAnalizar.addEventListener("click", analizar);
const _btnPreMatch = document.getElementById("btnPreMatch"); if (_btnPreMatch) _btnPreMatch.addEventListener("click", preMatch);
const _btnLimpiar = document.getElementById("btnLimpiar"); if (_btnLimpiar) _btnLimpiar.addEventListener("click", limpiarTodo);
const _btnRegistrar = document.getElementById("btnRegistrar"); if (_btnRegistrar) _btnRegistrar.addEventListener("click", openRegistroModal);
const _btnConfirmarRegistro = document.getElementById("btnConfirmarRegistro"); if (_btnConfirmarRegistro) _btnConfirmarRegistro.addEventListener("click", acceptRegistroModal);
const _btnAbrirModal = document.getElementById("btnAbrirModal"); if (_btnAbrirModal) _btnAbrirModal.addEventListener("click", nuevoEstudio);
const _btnEditarEstudio = document.getElementById("btnEditarEstudio"); if (_btnEditarEstudio) _btnEditarEstudio.addEventListener("click", editarEstudio);
const _btnEliminarEstudio = document.getElementById("btnEliminarEstudio"); if (_btnEliminarEstudio) _btnEliminarEstudio.addEventListener("click", eliminarEstudio);
const _btnGuardarEstudio = document.getElementById("btnGuardarEstudio"); if (_btnGuardarEstudio) _btnGuardarEstudio.addEventListener("click", guardarEstudio);
const _btnCerrarModal = document.getElementById("btnCerrarModal"); if (_btnCerrarModal) _btnCerrarModal.addEventListener("click", cerrarModal);
const _btnGuardarNuevoCriterio = document.getElementById("btnGuardarNuevoCriterio");
if (_btnGuardarNuevoCriterio) _btnGuardarNuevoCriterio.addEventListener("click", () => {
  guardarNuevoCriterio().catch(e => console.error("Error guardando nuevo criterio", e));
});
const _btnAgregarCriterio = document.getElementById("btnAgregarCriterio"); if (_btnAgregarCriterio) _btnAgregarCriterio.addEventListener("click", agregarCriterio);
const _estudioEl = document.getElementById("estudio"); if (_estudioEl) _estudioEl.addEventListener("change", renderCriterios);

// Modal registro
document.getElementById('reg_cancel')?.addEventListener('click', closeRegistroModal);
document.getElementById('reg_accept')?.addEventListener('click', acceptRegistroModal);

// Delegación chips ❌ del preview del modal
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btnEliminarCriterio");
  if (!btn) return;
  const cat = btn.getAttribute("data-cat");
  const idx = parseInt(btn.getAttribute("data-idx"), 10);
  if (Number.isInteger(idx)) eliminarCriterio(cat, idx);
});
document.addEventListener("change", (e) => {
  if (e.target.classList.contains("chk")) { /* sólo toggle visual */ }
});

// Descargar listado (toda la sesión)
document.getElementById('btnExportListado')?.addEventListener('click', async () => {
  const rows = await loadSessionRows();
  if (!rows.length) { alert('No hay casos en la sesión.'); return; }
  const csv = buildCSVFromSessionRows(rows);
  const fname = `medreg_listado_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  downloadCSV(fname, csv);
});

// Borrar listado (resetea)
document.getElementById('btnClearListado')?.addEventListener('click', async () => {
  if (!confirm('¿Borrar todo el listado de esta sesión?')) return;
  await saveSessionRows([]);
  updateSessionCount(0);
});


//////////////////////////////////////////////////////////////////////////////////////////////////////// 01-11
document.getElementById('btnAnalisisIAInv')?.addEventListener('click', async () => {
  setAnalisisInvLoading(true);
  try {
    await runAnalisisIA_INV();   // arma prompt y consulta IA
  } finally {
    setAnalisisInvLoading(false);
  }
});



// ===================== Notas (UI) =====================
// ===================== Notas (UI) =====================
async function loadNotas() {
  const st = await chrome.storage.sync.get(NOTAS_KEY);
  const notas = Array.isArray(st[NOTAS_KEY]) ? st[NOTAS_KEY] : [];
  renderNotas(notas);
}

/**
 * Actualiza el badge del botón "Notas" según la cantidad de notas.
 * - 0 notas  → no se muestra nada
 * - 1–9      → muestra el número
 * - 10+      → muestra "9+"
 */
function updateNotasBadge(notas) {
  const badge = document.getElementById('notasBadge');
  if (!badge) return;

  const count = Array.isArray(notas) ? notas.length : 0;

  if (!count) {
    badge.style.display = 'none';
    badge.textContent = '';
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent = count > 9 ? '9+' : String(count);
}

function renderNotas(notas) {
  const cont = document.getElementById('notas-list');
  if (!cont) return;

  cont.innerHTML = '';

  (notas || [])
    .slice()
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .forEach((n, idx) => {
      const el = document.createElement('div');
      el.className = 'card p-2';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600">${n.title || '(sin título)'}</div>
            <div style="font-size:12px;opacity:.7">${new Date(n.ts).toLocaleString()}</div>
          </div>
          <button data-idx="${idx}" class="btn muted" style="width:auto">Eliminar</button>
        </div>
        <div style="margin-top:6px;white-space:pre-wrap">${n.text || ''}</div>
      `;
      el.querySelector('button').addEventListener('click', async (e) => {
        const i = Number(e.currentTarget.dataset.idx);
        const st = await chrome.storage.sync.get(NOTAS_KEY);
        const arr = Array.isArray(st[NOTAS_KEY]) ? st[NOTAS_KEY] : [];
        arr.splice(i, 1);
        await chrome.storage.sync.set({ [NOTAS_KEY]: arr });
        loadNotas();  // vuelve a renderizar y actualizar el badge
      });
      cont.appendChild(el);
    });

  // 👈 acá actualizamos el badge cada vez que se renderiza la lista
  updateNotasBadge(notas);
}

(function initNotasUI() {
  const addBtn = document.getElementById('nota-add');
  const clrBtn = document.getElementById('nota-clear');

  addBtn && addBtn.addEventListener('click', async () => {
    const titleEl = document.getElementById('nota-title');
    const textEl  = document.getElementById('nota-text');
    const title = (titleEl?.value || '').trim();
    const text  = (textEl?.value || '').trim();
    if (!title && !text) return;

    const st = await chrome.storage.sync.get(NOTAS_KEY);
    const arr = Array.isArray(st[NOTAS_KEY]) ? st[NOTAS_KEY] : [];
    arr.push({ title, text, ts: new Date().toISOString() });
    await chrome.storage.sync.set({ [NOTAS_KEY]: arr });

    if (titleEl) titleEl.value = '';
    if (textEl)  textEl.value  = '';

    loadNotas();  // re-render + badge
  });

  clrBtn && clrBtn.addEventListener('click', () => {
    const titleEl = document.getElementById('nota-title');
    const textEl  = document.getElementById('nota-text');
    if (titleEl) titleEl.value = '';
    if (textEl)  textEl.value  = '';
  });

  // Al iniciar el sidebar, cargar notas existentes y actualizar badge
  loadNotas();
})();

// ===================== Agenda (Google Calendar) =====================
async function gCall(type, payload) {
  return new Promise((resolve) => { chrome.runtime.sendMessage({ type, payload }, resolve); });
}
async function refreshEvents() {
  const res = await gCall('GAPI_LIST_EVENTS');
  const box = document.getElementById('events-list');
  if (!res?.ok) {
    box.innerHTML = `<div class="text-red-600">Error: ${res?.error || 'No se pudo listar eventos'}</div>`;
    return;
  }
  if (!res.data?.items?.length) {
    box.innerHTML = `<div class="opacity-70">No hay eventos prÃ³ximos.</div>`;
    return;
  }
  box.innerHTML = '';
  res.data.items.forEach(ev => {
    const start = ev.start?.dateTime || ev.start?.date;
    const end = ev.end?.dateTime || ev.end?.date;
    const el = document.createElement('div');
    el.className = 'card p-2';
    el.innerHTML = `
      <div class="font-semibold">${ev.summary || '(Sin tÃ­tulo)'}</div>
      <div>${start} â†’ ${end || ''}</div>
      <div class="opacity-70">${ev.description || ''}</div>
    `;
    box.appendChild(el);
  });
}
document.getElementById('glogin').addEventListener('click', async () => {
  const res = await gCall('GAPI_LOGIN');
  if (!res?.ok) { alert('Error al conectar con Google: ' + (res?.error || 'desconocido')); return; }
  refreshEvents();
});
document.getElementById('glogout').addEventListener('click', async () => {
  await gCall('GAPI_LOGOUT');
  document.getElementById('events-list').innerHTML = '<div class="opacity-70">SesiÃ³n cerrada.</div>';
});
document.getElementById('evt-create')?.addEventListener('click', async () => {
  const summary = document.getElementById('evt-title')?.value?.trim();
  const description = document.getElementById('evt-desc')?.value?.trim();
  const startStr = document.getElementById('evt-start')?.value;
  const endStr   = document.getElementById('evt-end')?.value;
  if (!summary || !startStr || !endStr) { alert('CompletÃ¡ tÃ­tulo, inicio y fin.'); return; }
  const start = new Date(startStr);
  const end   = new Date(endStr);
  if (isNaN(start) || isNaN(end)) { alert('Fechas invÃ¡lidas.'); return; }
  if (end <= start) { alert('La hora de fin debe ser posterior al inicio.'); return; }
  const res = await gCall('GAPI_CREATE_EVENT', {
    summary, description, startISO: start.toISOString(), endISO: end.toISOString()
  });
  if (!res?.ok) { alert('No se pudo crear el evento: ' + (res?.error || 'error')); return; }
  document.getElementById('evt-title').value = '';
  document.getElementById('evt-desc').value  = '';
  document.getElementById('evt-start').value = '';
  document.getElementById('evt-end').value   = '';
  refreshEvents();
});

// ===================== Init general =====================
function mostrarLoader(_) {}
function habilitarUI(_) {}
function inicializarApp() {
  mostrarLoader(true);
  Promise.all([cargarTerminologia(), cargarReglasCruce()])
    .then(() => { mostrarLoader(false); habilitarUI(true); })
    .catch((e) => { console.error(e); mostrarLoader(false); habilitarUI(false); });
}
actualizarSelector();
renderCriterios();
inicializarApp();

document.addEventListener("DOMContentLoaded", async () => {
  const list = await loadExtractions();
  renderExtractions(list);
  document.getElementById("btnExtractHC").addEventListener("click", onExtractClick);
  document.getElementById("btnRegistroLocal")?.addEventListener("click", () => showOnly("registro"));
  document.getElementById("btnProtocolos")?.addEventListener("click", async () => {
    showOnly("protocolos");
    if (!document.getElementById("protoList") || !document.getElementById("protoList").children.length) {
      await loadProtocolos();
    }
  });
  document.getElementById("btnChatIA")?.addEventListener("click", () => showOnly("chat"));
  document.getElementById("btnNotas")?.addEventListener("click", () => showOnly("notas"));
  document.getElementById("btnAgenda")?.addEventListener("click", () => showOnly("agenda"));
const initialTab = localStorage.getItem('medreg.active_tab') || 'chat';
showOnly(initialTab);  // abre Asistente por defecto
});

document.getElementById("btnAgenteDeep")?.addEventListener("click", () => showOnly("agente"));

function ensureChatCopyStyles(){
  let st = document.getElementById('medreg-chat-copy-style');
  const css = `
    .chat-bubble{ position: relative; padding-right: 10px; padding-bottom: 32px; }
    .chat-bubble .chat-content{ white-space: pre-wrap; }
    .chat-bubble .chat-copy{
      position:absolute; bottom:6px; right:6px;
      display:inline-flex !important; align-items:center; justify-content:center;
      width:auto !important; height:24px; min-width:24px;
      padding:2px 6px; border-radius:6px; border:1px solid rgba(0,0,0,.2);
      background:#fff; opacity:.9; cursor:pointer; user-select:none;
      font-size:12px; line-height:1;
    }
    .chat-bubble .chat-copy:hover{ opacity:1 }
  `;
  if (st) { st.textContent = css; return; }
  st = document.createElement('style');
  st.id = 'medreg-chat-copy-style';
  st.textContent = css;
  document.head.appendChild(st);
}



// ===== Atajo de teclado para "Extraer HC" (Alt+R) =====
document.addEventListener('keydown', (e) => {
  const t = (e.target && e.target.tagName || '').toLowerCase();
  if (t === 'input' || t === 'textarea' || (e.target && e.target.isContentEditable)) return;
  if (e.altKey && (e.key || '').toLowerCase() === 'r') {
    e.preventDefault();
    document.getElementById('btnExtractHC')?.click();
  }
}, { capture:true });

document.getElementById('btnExtractHC')?.setAttribute('title', 'Atajo: Alt+R');



// Select categoría => refresca datalist (“clave — subcategoría”)
const categoriaSelect = document.getElementById("categoriaSelect");
const claveInput = document.getElementById("claveInput");
categoriaSelect.onchange = () => {
  mostrarOpcionesPorClaveYCategoria();
  document.getElementById("claveInput").value = "";
  const categoria = categoriaSelect.value;
  if (categoria) cargarDatalistPorCategoria(categoria);
};
claveInput.addEventListener("input", mostrarOpcionesPorClaveYCategoria);
const operadorEl = document.getElementById("operador");
if (operadorEl) operadorEl.onchange = () =>
  document.getElementById("valor2").classList.toggle("oculto", operadorEl.value !== "entre");

// ====== SUGERENCIAS RICAS (B) ======
(function ensureSuggestPanel(){
  const inp = document.getElementById("claveInput");
  if (!inp) return;
  let panel = document.getElementById("suggestPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "suggestPanel";
  panel.style.cssText = [
  "border:1px solid var(--stroke)",
  "border-radius:10px",
  "margin-top:6px",
  "padding:8px",
  "max-height:240px",
  "overflow:auto",
  "background:var(--card)",
  "color:var(--text)",
  "box-shadow:0 8px 24px rgba(0,0,0,.35)",
  "position:relative",
  "z-index:20"
].join(";");
    inp.insertAdjacentElement("afterend", panel);
  }
})();

function renderSuggestPanel(){
  const panel = document.getElementById("suggestPanel");
  const catEl = document.getElementById("categoriaSelect");
  const inputEl = document.getElementById("claveInput");
  if (!panel || !catEl || !inputEl) return;

  const cat = catEl.value || "";
  const q = (inputEl.value || "").trim().toLowerCase();
  panel.innerHTML = "";
  if (!cat) return;

  const catObj = window.idx?.byCat.get(cat);
  if (!catObj) return;

  // Armamos la lista de ítems (subcat, sub2, claves)
  const items = [];
  Array.from(catObj.subcats || []).forEach(sub => {
    const canSet = window.idx.subcatToCanon.get(cat)?.get(norm(sub)) || new Set();
    const sub2Prev = new Set();
    canSet.forEach(canon=>{
      const row = (baseAutocompletado||[]).find(
        x=>x.categoria===cat && sinAcentos(x.clave)===sinAcentos(canon)
      );
      if (row?.sub2) sub2Prev.add(row.sub2);
    });
    items.push({ tipo:"subcat", label:sub, previewSub2:Array.from(sub2Prev).sort() });
  });
  Array.from(catObj.sub2s || []).forEach(s2 => items.push({ tipo:"sub2", label:s2 }));
  Array.from(catObj.baseClaves || []).forEach(c => items.push({ tipo:"clave", label:c }));

  const filtered = items.filter(it => it.label.toLowerCase().includes(q));
  if (!filtered.length) {
    panel.classList.add("oculto");
    return;
  }
  panel.classList.remove("oculto");

  filtered.forEach(it=>{
    const div = document.createElement("div");
    div.className = "suggest-item";
    div.style.cssText = [
      "padding:8px 10px",
      "border-radius:10px",
      "cursor:pointer",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
      "color:var(--text)"
    ].join(";");
    div.addEventListener("mouseenter", ()=> div.style.background="rgba(255,255,255,0.06)");
    div.addEventListener("mouseleave", ()=> div.style.background="transparent");

    // Título sin iconos
    const title = document.createElement("div");
    title.style.cssText = "display:flex;align-items:center;font-weight:600;color:var(--text)";
    title.textContent = it.label;
    div.appendChild(title);

    // Pills de sub2 para las subcategorías
    if (it.tipo==="subcat" && it.previewSub2?.length){
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
      it.previewSub2.slice(0,8).forEach(s2=>{
        const b = document.createElement("span");
        b.style.cssText = [
          "border:1px solid var(--stroke)",
          "border-radius:9999px",
          "padding:2px 8px",
          "font-size:12px",
          "background:rgba(74,163,255,0.08)",
          "color:var(--text)"
        ].join(";");
        b.textContent = s2;
        row.appendChild(b);
      });
      if (it.previewSub2.length>8){
        const more = document.createElement("span");
        more.style.cssText = [
          "border:1px solid var(--stroke)",
          "border-radius:9999px",
          "padding:2px 8px",
          "font-size:12px",
          "color:var(--muted)"
        ].join(";");
        more.textContent = `+${it.previewSub2.length-8} más`;
        row.appendChild(more);
      }
      div.appendChild(row);
    }

    // Al hacer click, llevamos el nombre al input
    div.onclick = () => {
      inputEl.value = it.label;
      inputEl.focus();
      panel.classList.add("oculto");
    };

    panel.appendChild(div);
  });
}

// Aseguramos que se actualice el panel
document.getElementById("claveInput")?.addEventListener("input", renderSuggestPanel);
document.getElementById("claveInput")?.addEventListener("focus", renderSuggestPanel);
document.getElementById("categoriaSelect")?.addEventListener("change", () => {
  document.getElementById("claveInput").value = "";
  renderSuggestPanel();
});


// === Bloc simple para completar una frase y anexarla al prompt ===
// === Bloc simple para completar una frase y anexarla al prompt ===
function ensurePromptPadDOM(){
  if (document.getElementById('prompt-pad')) return;
  const wrap = document.createElement('div');
  wrap.id = 'prompt-pad';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div class="pp-backdrop"></div>
    <div class="pp-card">
      <div class="pp-title" id="pp-title">Agregar detalle</div>
      <textarea id="pp-input" rows="2" placeholder="Complementa para que…"></textarea>
      <div class="pp-actions">
          <button id="pp-ok" class="btn">Continuar</button>
        <button id="pp-cancel" class="btn muted">Cancelar</button>
    
      </div>
    </div>`;
  document.body.appendChild(wrap);
}

(function ensurePromptPadStyles(){
  if (document.getElementById('pp-style')) return;
  const st = document.createElement('style');
  st.id = 'pp-style';
  st.textContent = `
    #prompt-pad{position:fixed;inset:0;z-index:9999}
    #prompt-pad .pp-backdrop{position:absolute;inset:0;background:rgba(54, 67, 179, 0.59)}
    #prompt-pad .pp-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(520px,92vw);background:#fff;border-radius:10px;padding:10px;box-shadow:0 12px 28px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:8px}
    #prompt-pad .pp-title{font-weight:600}
    #prompt-pad textarea{border:1px solid #1a375cff;border-radius:8px;padding:8px;font-size:14px;resize:none;min-height:54px;max-height:140px}
    #prompt-pad .pp-actions{display:flex;gap:8px;justify-content:flex-end}
  `;
  document.head.appendChild(st);
})();



// Abre bloc, pide una sola frase y la anexa al prompt base
function openPromptPadAndSend({ basePrompt, title = 'Agregar detalle', joiner = '\n\nContexto adicional: ' }){
  ensurePromptPadDOM();
  const root = document.getElementById('prompt-pad');
  const titleEl = document.getElementById('pp-title');
  const input = document.getElementById('pp-input');
  const ok = document.getElementById('pp-ok');
  const cancel = document.getElementById('pp-cancel');

  function close(){ root.style.display='none'; ok.onclick=null; cancel.onclick=null; root.querySelector('.pp-backdrop').onclick=null; }
  function autoGrow(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,140)+'px'; }

  titleEl.textContent = title;
  input.value = '';
  root.style.display = 'block';
  input.focus();
  input.oninput = autoGrow; autoGrow();

 ok.onclick = ()=>{
  const extra = (input.value || '').trim();
  const final = extra ? (basePrompt + joiner + extra) : basePrompt;
  close();

  // usar la función global expuesta por el chat
  const sender = window.medregSendMsg || window.sendMsg;
  if (typeof sender === 'function') {
    sender(final, false);  // SIN burbuja del usuario
  } else {
    console.warn('[MedReg] sendMsg no disponible');
    alert('No pude enviar el prompt. Recargá el sidebar e intentá de nuevo.');
  }
};

  cancel.onclick = ()=> close();
  root.querySelector('.pp-backdrop').onclick = ()=> close();
}





// ===================== Configuración de botonera de prompts (ruedita) =====================

const QUICK_PROMPTS_KEY     = 'medreg.quickPrompts_v1';
const QUICK_PROMPTS_VIS_KEY = 'medreg.quickPromptsHidden_v1';


function getDefaultQuickPrompts(){
  return [
    // FORMULARIOS GUIADOS (usan PARAM_PROMPTS + openParamPrompt)
    {
      id: 'qp-preqx',
      label: 'Riesgo prequrírgico',
      kind: 'param',
      paramKey: 'riesgo-prequirurgico',
      text: 'Formulario guiado para valoración de riesgo cardiovascular prequirúrgico.'
    },
    {
      id: 'qp-justif-os',
      label: 'Justificativo Obra social',
      kind: 'param',
      paramKey: 'justificativo-os',
      text: 'Formulario guiado para redactar justificativos para obra social.'
    },
    {
      id: 'qp-scores',
      label: 'Scores de Riesgo',
      kind: 'param',
      paramKey: 'scores-de-riesgo',
      text: 'Formulario guiado para seleccionar score y que la IA lo calcule / interprete.'
    },
    {
      id: 'qp-evoluciones',
      label: 'Evolución diaria internación',
      kind: 'param',
      paramKey: 'evolucion',
      text: 'Formulario guiado para armar evolución diaria de internación.'
    },

    // PROMPTS DIRECTOS
    {
      id: 'qp-interacciones',
      label: 'Interacciones medicamentosas',
      kind: 'prompt',
      text: 'Revisá interacciones medicamentosas y precauciones entre todos los fármacos listados en las extracciones. Indicá interacciones relevantes, posibles efectos adversos y sugerencias concretas para ajustar dosis o cambiar tratamientos.'
    },
    {
      id: 'qp-2daopinion',
      label: 'Segunda opinión',
      kind: 'prompt',
      text: 'Hacé un resumen clínico conciso usando los datos extraídos del paciente y emití una segunda opinión argumentada sobre diagnóstico, estratificación de riesgo y conductas sugeridas, mencionando brevemente la evidencia cuando sea útil.'
    },
    {
      id: 'qp-clearence',
      label: 'Calcular Cl creatinina',
      kind: 'prompt',
      text: 'Con los datos disponibles (edad, sexo, creatinina sérica y peso si figura en la historia), estimá el filtrado glomerular / clearence de creatinina con una fórmula apropiada. Devolvé el valor numérico, la unidad y la categoría de función renal.'
    },
    {
      id: 'qp-contraparte',
      label: 'Contraparte',
      kind: 'prompt',
      text: 'Actuá como contraparte crítica del médico tratante: revisá el caso con los datos extraídos, marcá posibles sesgos, diagnósticos diferenciales pasados por alto y decisiones discutibles. Señalá puntos a favor y en contra de la conducta actual, de manera respetuosa y basada en evidencia.'
    },
    {
      id: 'qp-como-sigo',
      label: '¿Cómo sigo?',
      kind: 'prompt',
      text: 'El médico está trabado y no sabe cómo seguir. A partir de las extracciones del paciente, proponé próximos pasos razonados: estudios a solicitar, ajustes de medicación y recomendaciones para el seguimiento.'
    }
  ];
}


// --------- Storage helpers (config de prompts) ---------
async function loadQuickPromptsConfig(){
  function normalizarLista(arr){
    if (!Array.isArray(arr)) return null;
    const norm = arr.map((raw, idx)=>{
      if (!raw) raw = {};
      const label    = (raw.label || '').trim();
      const text     = (raw.text  || '').trim();
      const kind     = raw.kind === 'param' ? 'param' : 'prompt';
      const paramKey = (raw.paramKey || '').trim();

      return {
        id: raw.id || `qp-${idx+1}`,
        label: label || `Botón ${idx+1}`,
        text,
        kind,
        paramKey: kind === 'param' && paramKey ? paramKey : undefined
      };
    }).filter(it => it.text || it.kind === 'param'); // param puede no usar text
    return norm.length ? norm : null;
  }

  try{
    const st  = await chrome?.storage?.sync?.get(QUICK_PROMPTS_KEY) || {};
    const arr = normalizarLista(st[QUICK_PROMPTS_KEY]);
    if (arr) return arr;
  }catch(e){
    // si falla, probamos localStorage
  }

  try{
    const raw = localStorage.getItem(QUICK_PROMPTS_KEY);
    if (raw){
      const parsed = normalizarLista(JSON.parse(raw));
      if (parsed) return parsed;
    }
  }catch(_){}

  return getDefaultQuickPrompts();
}

async function saveQuickPromptsConfig(list){
  const norm = [];
  (list || []).forEach((raw, idx)=>{
    if (!raw) return;
    const label    = (raw.label || '').trim();
    const text     = (raw.text  || '').trim();
    const kind     = raw.kind === 'param' ? 'param' : 'prompt';
    const paramKey = (raw.paramKey || '').trim();

    if (!label && !text && kind !== 'param') return;

    norm.push({
      id: raw.id || `qp-${idx+1}`,
      label: label || `Botón ${idx+1}`,
      text,
      kind,
      ...(kind === 'param' && paramKey ? { paramKey } : {})
    });
  });

  try{
    await chrome?.storage?.sync?.set?.({ [QUICK_PROMPTS_KEY]: norm });
  }catch(e){
    try{
      localStorage.setItem(QUICK_PROMPTS_KEY, JSON.stringify(norm));
    }catch(_){}
  }
}


// --------- Storage helpers (visibilidad) ---------
async function loadQuickPromptsHidden(){
  try{
    const st = await chrome?.storage?.sync?.get(QUICK_PROMPTS_VIS_KEY) || {};
    return !!st[QUICK_PROMPTS_VIS_KEY];
  }catch(e){
    try{
      const raw = localStorage.getItem(QUICK_PROMPTS_VIS_KEY);
      return raw === '1';
    }catch(_){
      return false;
    }
  }
}

async function saveQuickPromptsHidden(hidden){
  try{
    await chrome?.storage?.sync?.set({ [QUICK_PROMPTS_VIS_KEY]: !!hidden });
  }catch(e){
    try{
      if (hidden){
        localStorage.setItem(QUICK_PROMPTS_VIS_KEY, '1');
      }else{
        localStorage.removeItem(QUICK_PROMPTS_VIS_KEY);
      }
    }catch(_){}
  }
}

function applyQuickPromptsVisibility(hidden){
  const root = document.getElementById('ai-quick-prompts');
  if (!root) return;
  root.style.display = hidden ? 'none' : 'flex';
}

// Render de la botonera a partir de la config
async function refreshQuickPromptsFromStore(){
  const root = document.getElementById('ai-quick-prompts');
  if (!root) return;

  const cfg = await loadQuickPromptsConfig();
  root.innerHTML = '';

  (cfg || []).forEach(p=>{
    const btn = document.createElement('button');
    btn.className = 'btn subtle';
    btn.textContent = p.label || 'Prompt';

    if (p.kind === 'param' && p.paramKey){
      // abre formulario guiado
      btn.dataset.pprompt = p.paramKey;
    }else if (p.text){
      // prompt directo
      btn.dataset.prompt = p.text;
    }

    root.appendChild(btn);
  });
}


// Clicks en botones de prompt directo
(function wireQuickPrompts(){
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-prompt], button[data-pprompt]');
    if (!b) return;

    const paramKey = b.dataset.pprompt;
    const base     = b.dataset.prompt;

    // 1) Botones que usan formulario guiado (PARAM_PROMPTS)
    if (paramKey){
      if (typeof openParamPrompt === 'function'){
        e.preventDefault();
        openParamPrompt(paramKey);
      }
      return;
    }

    // 2) Botones de prompt directo
    if (base){
      e.preventDefault();
      if (typeof sendMsg === 'function'){
        sendMsg(base, false);           // sin burbuja de usuario
      }else if (typeof window.medregSendMsg === 'function'){
        window.medregSendMsg(base, false);
      }
    }
  }, { passive:false });
})();


// --------- Construcción del row del modal (sólo etiqueta + texto) ---------
// --------- Construcción del row del modal (título + texto colapsable) ---------
function buildQuickPromptRow(p){
  const row = document.createElement('div');
  // arranca colapsada: solo se ve el título
  row.className = 'qp-row qp-row-collapsed';

  // preservamos ID, tipo (prompt/param) y paramKey
  row.dataset.id       = p.id || '';
  row.dataset.kind     = (p.kind === 'param' ? 'param' : 'prompt');
  if (p.paramKey) row.dataset.paramKey = p.paramKey;

  const safeLabel = (p.label || '').replace(/"/g, '&quot;');
  const safeText  = (p.text  || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  row.innerHTML = `
    <div class="qp-row-header">
      <div class="qp-row-header-main">
        <input
          type="text"
          class="qp-label"
          value="${safeLabel}"
          placeholder="Título del botón"
        />
      </div>
      <div class="qp-row-header-actions">
        <button type="button" class="icon-btn qp-toggle" title="Editar texto del prompt">
          <span>▸</span>
        </button>
        <button type="button" class="icon-btn qp-del" title="Eliminar">
          <span>🗑️</span>
        </button>
      </div>
    </div>
    <div class="qp-row-body">
      <textarea
        class="qp-text"
        rows="4"
        placeholder="Texto completo del prompt"
      >${safeText}</textarea>
    </div>
  `;
  return row;
}




function ensureQuickPromptsModalWired(){
  const modal = document.getElementById('quickPromptsModal');
  if (!modal || modal._wired) return;
  modal._wired = true;

  const listEl    = modal.querySelector('#qpList');
  const btnAdd    = modal.querySelector('#qpAdd');
  const btnSave   = modal.querySelector('#qpSave');
  const btnCancel = modal.querySelector('#qpCancel');
  const btnClose  = modal.querySelector('#qpClose');

btnAdd?.addEventListener('click', (e)=>{
  e.preventDefault();
  const row = buildQuickPromptRow({ label:'Nuevo botón', kind:'prompt', text:'' });
  listEl.appendChild(row);
  // que el nuevo arranque abierto para editar cómodo
  row.classList.remove('qp-row-collapsed');
  row.querySelector('.qp-label')?.focus();
});



listEl?.addEventListener('click', (e)=>{
  const del = e.target.closest('.qp-del');
  if (del){
    e.preventDefault();
    const row = del.closest('.qp-row');
    if (row) row.remove();
    return;
  }

  const toggle = e.target.closest('.qp-toggle');
  if (toggle){
    e.preventDefault();
    const row = toggle.closest('.qp-row');
    if (!row) return;
    const collapsed = row.classList.toggle('qp-row-collapsed');
    if (!collapsed){
      const ta = row.querySelector('.qp-text');
      if (ta) ta.focus();
    }
  }
});

  async function collectAndSave(){
    const rows = Array.from(listEl.querySelectorAll('.qp-row'));
const items = rows.map((row, idx)=>{
  const id       = row.dataset.id || `qp-${idx+1}`;
  const kind     = row.dataset.kind === 'param' ? 'param' : 'prompt';
  const paramKey = row.dataset.paramKey || '';
  const label    = row.querySelector('.qp-label')?.value || '';
  const text     = row.querySelector('.qp-text')?.value || '';

  return {
    id,
    label,
    text,
    kind,
    ...(kind === 'param' && paramKey ? { paramKey } : {})
  };
});

    await saveQuickPromptsConfig(items);
    await refreshQuickPromptsFromStore();
  }

  function close(){
    modal.classList.remove('show');
  }

  btnSave?.addEventListener('click', async (e)=>{
    e.preventDefault();
    await collectAndSave();
    close();
  });
  btnCancel?.addEventListener('click', (e)=>{
    e.preventDefault();
    close();
  });
  btnClose?.addEventListener('click', (e)=>{
    e.preventDefault();
    close();
  });

  modal.addEventListener('click', (e)=>{
    if (e.target === modal) close();
  });
}

async function openQuickPromptsEditor(){
  const modal = document.getElementById('quickPromptsModal');
  if (!modal) return;

  ensureQuickPromptsModalWired();

  const listEl = modal.querySelector('#qpList');
  if (!listEl) return;

  const cfg = await loadQuickPromptsConfig();
  listEl.innerHTML = '';
  (cfg || []).forEach(p=>{
    listEl.appendChild(buildQuickPromptRow(p));
  });

  modal.classList.add('show');
}
// Modal de importar / exportar preset de la botonera
async function openQuickPromptsPresetModal(){
  const modal = document.getElementById('quickPromptsPresetModal');
  if (!modal) return;

  const textarea = modal.querySelector('#qpPresetTextarea');
  const btnClose  = modal.querySelector('#qpPresetClose');
  const btnCancel = modal.querySelector('#qpPresetCancel');
  const btnCopy   = modal.querySelector('#qpPresetCopy');
  const btnApply  = modal.querySelector('#qpPresetApply');

  async function loadPresetIntoTextarea(){
    try{
      const cfg = await loadQuickPromptsConfig();   // usamos la misma config de la botonera
      const serialized = JSON.stringify(cfg || [], null, 2);
      textarea.value = serialized;
    }catch(e){
      textarea.value = '[]';
    }
  }

  if (!modal._wired){
    modal._wired = true;

    function close(){
      modal.classList.remove('show');
    }

    btnClose?.addEventListener('click', (e)=>{
      e.preventDefault();
      close();
    });
    btnCancel?.addEventListener('click', (e)=>{
      e.preventDefault();
      close();
    });

    modal.addEventListener('click', (e)=>{
      if (e.target === modal) close();
    });

    // Copiar preset al portapapeles
    btnCopy?.addEventListener('click', async (e)=>{
      e.preventDefault();
      const value = textarea.value || '';
      try{
        if (navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(value);
          alert('Preset copiado al portapapeles.');
        }else{
          // fallback simple
          textarea.select();
          document.execCommand && document.execCommand('copy');
          alert('Si el portapapeles no se copió automáticamente, copiá el texto manualmente.');
        }
      }catch(_){
        alert('No se pudo acceder al portapapeles. Copiá el texto manualmente.');
      }
    });

    // Importar preset desde el JSON pegado
    btnApply?.addEventListener('click', async (e)=>{
      e.preventDefault();
      let parsed;
      try{
        parsed = JSON.parse(textarea.value || '[]');
      }catch(err){
        alert('El contenido no es un JSON válido.');
        return;
      }
      if (!Array.isArray(parsed)){
        alert('El JSON debe ser un arreglo de ítems (ej: [ { ... }, { ... } ]).');
        return;
      }

      // Normalizar: id, label, text, kind, paramKey
      const norm = parsed.map((raw, idx)=>{
        if (!raw) raw = {};
        const kind = raw.kind === 'param' ? 'param' : 'prompt';
        const obj = {
          id:    raw.id || `qp-${idx+1}`,
          label: String(raw.label || `Botón ${idx+1}`),
          text:  String(raw.text || '')
        };
        if (kind === 'param' && raw.paramKey){
          obj.kind = 'param';
          obj.paramKey = String(raw.paramKey);
        }else{
          obj.kind = 'prompt';
        }
        return obj;
      });

      await saveQuickPromptsConfig(norm);
      await refreshQuickPromptsFromStore();
      close();
      alert('Preset importado correctamente.');
    });
  }

  await loadPresetIntoTextarea();
  modal.classList.add('show');
}

// --------- Export / Import de preset de botonera (archivo .json) ---------
// ---------- Exportar / importar preset de prompts a archivo .json ----------

function buildQuickPromptsFilename(){
  const now = new Date();
  const pad = (n)=> String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `medreg_prompts_${stamp}.json`;
}

// Descargar archivo .json con el preset actual
async function exportQuickPromptsToFile(){
  try{
    // Usa la misma config que ya manejás (incluye kind / paramKey)
    const cfg  = await loadQuickPromptsConfig();
    const data = JSON.stringify(cfg || [], null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = buildQuickPromptsFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(err){
    console.error('Error exportando preset de prompts:', err);
    alert('No se pudo exportar el preset de prompts.');
  }
}

// Preparar el input de archivo para importar un preset .json
function setupQuickPromptsFileImport(){
  const input = document.getElementById('quickPromptsFileInput');
  if (!input || input._wired) return;
  input._wired = true;

  input.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if (!file){
      input.value = '';
      return;
    }
    try{
      const text   = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)){
        alert('El archivo JSON debe contener un arreglo de prompts.');
      }else{
        // normalizar: id, label, text, kind, paramKey
        const norm = parsed.map((raw, idx)=>{
          if (!raw) raw = {};
          const kind = raw.kind === 'param' ? 'param' : 'prompt';
          const item = {
            id:    raw.id || `qp-${idx+1}`,
            label: String(raw.label || `Botón ${idx+1}`),
            text:  String(raw.text || '')
          };
          if (kind === 'param' && raw.paramKey){
            item.kind = 'param';
            item.paramKey = String(raw.paramKey);
          }else{
            item.kind = 'prompt';
          }
          return item;
        });

        await saveQuickPromptsConfig(norm);
        if (typeof refreshQuickPromptsFromStore === 'function'){
          await refreshQuickPromptsFromStore();
        }
        alert('Preset importado correctamente.');
      }
    }catch(err){
      console.error('Error importando preset de prompts:', err);
      alert('No se pudo leer el archivo JSON. Verificá que el formato sea válido.');
    }finally{
      // para poder volver a elegir el mismo archivo si hace falta
      input.value = '';
    }
  });
}



// Inicializar ruedita de configuración
// Inicializar ruedita de configuración
// Inicializar ruedita de configuración
(function initConfigPromptsMenu(){
  document.addEventListener('DOMContentLoaded', async ()=>{
    const gear = document.getElementById('btnConfigPrompts');
    const menu = document.getElementById('configPromptsMenu');
    if (!gear || !menu) return;

    // preparar input de archivo para importar presets
    setupQuickPromptsFileImport();

    let open = false;
    function closeMenu(){
      if (!open) return;
      open = false;
      menu.style.display = 'none';
    }
    function toggleMenu(){
      open = !open;
      menu.style.display = open ? 'block' : 'none';
    }

    gear.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener('click', (e)=> e.stopPropagation());
    document.addEventListener('click', ()=> closeMenu());

    // Al cargar: aplicar visibilidad + render inicial de botonera
    const hidden = await loadQuickPromptsHidden();
    applyQuickPromptsVisibility(hidden);
    if (typeof refreshQuickPromptsFromStore === 'function'){
      await refreshQuickPromptsFromStore();
    }

    // Referencias a los botones del menú
    const btnEdit   = document.getElementById('btnEditQuickPrompts');
    const btnExport = document.getElementById('btnExportQuickPrompts');
    const btnImport = document.getElementById('btnImportQuickPrompts');
    const btnToggle = document.getElementById('btnToggleQuickPrompts');
    const btnReset  = document.getElementById('btnResetQuickPrompts');

    // Editar botones (abre el editor visual)
    if (btnEdit){
      btnEdit.addEventListener('click', (e)=>{
        e.preventDefault();
        closeMenu();
        openQuickPromptsEditor();
      });
    }

    // Exportar preset como archivo .json
    if (btnExport){
      btnExport.addEventListener('click', async (e)=>{
        e.preventDefault();
        closeMenu();
        await exportQuickPromptsToFile();
      });
    }

    // Importar preset desde archivo .json
    if (btnImport){
      btnImport.addEventListener('click', (e)=>{
        e.preventDefault();
        closeMenu();
        const input = document.getElementById('quickPromptsFileInput');
        if (input) input.click();
      });
    }

    // Mostrar / ocultar botonera
    if (btnToggle){
      btnToggle.addEventListener('click', async (e)=>{
        e.preventDefault();
        const current = await loadQuickPromptsHidden();
        const next = !current;
        await saveQuickPromptsHidden(next);
        applyQuickPromptsVisibility(next);
        closeMenu();
      });
    }

    // Restablecer valores por defecto
    if (btnReset){
      btnReset.addEventListener('click', async (e)=>{
        e.preventDefault();
        await saveQuickPromptsHidden(false);
        applyQuickPromptsVisibility(false);
        if (typeof getDefaultQuickPrompts === 'function' &&
            typeof saveQuickPromptsConfig === 'function' &&
            typeof refreshQuickPromptsFromStore === 'function'){
          await saveQuickPromptsConfig(getDefaultQuickPrompts());
          await refreshQuickPromptsFromStore();
        }
        closeMenu();
        alert('Botonera de prompts restablecida.');
      });
    }
  });
})();



const ASSEMBLYAI_API_KEY = "ed4a9a7d98a1402a8f0fc8836ce85b3d";
const OPENROUTER_API_KEY = "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";
const OPENROUTER_MODEL = "openai/gpt-3.5-turbo";

// AÑADIR NUEVAS VARIABLES
const PRESETS = {
    soap: {
        label: "Nota SOAP",
        prompt: "Eres un asistente de documentación médica experto. Analiza la transcripción y genera una nota de evolución en formato SOAP (Subjetivo, Objetivo, Análisis, Plan). Mantente conciso y utiliza terminología médica. Usa los títulos S:, O:, A:, P: separados por salto de línea."
    },
    study: {
        label: "Informe de Estudios",
        prompt: "Eres un asistente de radiología/laboratorio. Analiza la transcripción de un dictado y estructura el contenido en las secciones: Hallazgos, Interpretación, y Conclusión/Recomendaciones. Usa encabezados claros."
    },
    evolution: {
        label: "Evolución Internación",
        prompt: "Eres un asistente médico experto en rondas. Analiza la transcripción de la evolución clínica del paciente. Estructura el informe en las secciones: Resumen de 24h (Sucesos Relevantes), Signos vitales/Balance hidrico, Examen Físico, Estudios complementarios, y Plan (Tratamiento, Pendientes). Sugerencia concisa sobre el caso"
    }
};
let selectedPreset = null; // Almacena la clave ('soap', 'study', 'evolution')


let mediaRecorder;
let audioChunks = [];
let stream;
let isRecording = false;

const btnRecord = document.getElementById('btnRecord');
const btnPause = document.getElementById('btnPause');
const btnStop = document.getElementById('btnStop');
const recordIcon = document.getElementById('record-icon');
const recordingStatus = document.getElementById('recording-status');
const soapOutput = document.getElementById('soap-output');
const btnCopySoap = document.getElementById('btnCopySoap');
const btnClearAll = document.getElementById('btnClearAll');

function setStatus(text, color = 'var(--muted)') {
  recordingStatus.textContent = text;
  recordingStatus.style.color = color;
}

function updateControls(state) {
  btnRecord.disabled = state === 'recording' || state === 'paused' || state === 'processing';
  btnPause.disabled = state !== 'recording';
  btnStop.disabled = state !== 'recording' && state !== 'paused';

  if (state === 'processing') {
    btnRecord.disabled = btnPause.disabled = btnStop.disabled = true;
  }

  if (state === 'recording') {
    recordIcon.textContent = '🔴';
    btnRecord.style.background = 'var(--warn)';
  } else {
    recordIcon.textContent = '▶️';
    btnRecord.style.background = 'var(--ok)';
  }

  btnCopySoap.disabled = soapOutput.value.length === 0;
}

async function startRecording() {
 if (!selectedPreset) {
        setStatus('ERROR: Selecciona un formato (SOAP, Estudio, Evolución) antes de grabar.', 'var(--err)');
        return;
    }

    if (isRecording) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      console.log(`LOG: Grabación finalizada. Tamaño de audioBlob: ${audioBlob.size} bytes`);
      processRecording(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    setStatus('Grabando...', 'var(--brand)');
    updateControls('recording');
  } catch (err) {
    setStatus(`ERROR: ${err.name} - ${err.message}.`, 'var(--err)');
    console.error('Fallo de getUserMedia detallado:', err);
  }
}

function pauseRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  mediaRecorder.pause();
  isRecording = false;
  setStatus('Grabación pausada.', 'var(--warn)');
  updateControls('paused');
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  setStatus('Procesando audio, generando SOAP...', 'var(--brand-2)');
  updateControls('processing');
}

async function processRecording(audioBlob) {
  isRecording = false;
  updateControls('processing');
  setStatus('Finalizada. Procesando audio...', 'var(--brand)');

 try {
        // Enviar a AssemblyAI para transcripción (igual)
        const transcription = await sendToAssemblyAI(audioBlob);
        
        // RECUPERAR el prompt del preset seleccionado
        const presetData = PRESETS[selectedPreset] || PRESETS.soap;
        const fullPrompt = presetData.prompt; // Obtiene el prompt base

        // Enviar transcripción a OpenRouter para la nota
        setStatus(`Audio transcrito. Generando ${presetData.label} con LLM...`, 'var(--brand-2)');
        
        // LLAMAR a la función con el prompt y la transcripción
        const generatedNote = await generateNoteFromTranscription(transcription, fullPrompt);
        
        soapOutput.value = generatedNote;
        setStatus(`¡${presetData.label} generada con éxito!`, 'var(--ok)');

    } catch (error) {
    console.error('Error en el pipeline STT/LLM:', error);
    soapOutput.value = `Error en el procesamiento:\n${error.message || error}`;
    setStatus('Error en la transcripción/generación.', 'var(--err)');
  } finally {
    audioChunks = [];
    mediaRecorder = null;
    isRecording = false;
    updateControls('idle');
  }
}

async function sendToAssemblyAI(audioBlob) {
  const uploadUrl = 'https://api.assemblyai.com/v2/upload';
  setStatus('Subiendo audio a AssemblyAI...', 'var(--brand)');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: ASSEMBLYAI_API_KEY, 'Content-Type': audioBlob.type || 'application/octet-stream' },
    body: audioBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Error al subir el audio a AssemblyAI: ${uploadResponse.statusText}`);
  }

  const { upload_url: uploadedAudioUrl } = await uploadResponse.json();

  const transcribeUrl = 'https://api.assemblyai.com/v2/transcript';
  setStatus('Iniciando transcripción...', 'var(--brand)');

  const transcribeResponse = await fetch(transcribeUrl, {
    method: 'POST',
    headers: { Authorization: ASSEMBLYAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: uploadedAudioUrl, language_code: 'es' }),
  });

  if (!transcribeResponse.ok) {
    throw new Error(`Error al iniciar la transcripción: ${transcribeResponse.statusText}`);
  }

  let result = await transcribeResponse.json();
  const getUrl = `https://api.assemblyai.com/v2/transcript/${result.id}`;

  while (result.status !== 'completed' && result.status !== 'error') {
    setStatus(`Estado: ${result.status}. Esperando transcripción...`, '#ffc107');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const pollResponse = await fetch(getUrl, {
      method: 'GET',
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    });

    if (!pollResponse.ok) {
      throw new Error(`Error al verificar estado: ${pollResponse.statusText}`);
    }

    result = await pollResponse.json();
  }

  if (result.status === 'error') {
    throw new Error(`Error de transcripción: ${result.error}`);
  }

  return result.text;
}


  async function generateNoteFromTranscription(transcriptionText, presetPrompt) { 
    // Ahora, el prompt inicial es el que se pasa
    const prompt = `${presetPrompt}

    **TRANSCRIPCIÓN DEL DICTADO/VISITA:**
    ---
    ${transcriptionText}
    ---
    
    NOTA GENERADA:
    `;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error en la API de OpenRouter: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}


// ============== 4. Inicialización y Event Listeners ==============

function clearAll() {
    // 1. Limpia el resultado final
    soapOutput.value = '';

    // 2. Limpia el estado de la grabación
    setStatus('Listo para comenzar.', 'var(--muted)');
    
    // 3. Limpia el estado de los controles de grabación
    updateControls('idle');

    // 4. Limpia la selección de Preset
    selectedPreset = null;
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // 5. Restablece variables globales de grabación (aunque se limpian en processRecording, es buena práctica)
    mediaRecorder = null;
    audioChunks = [];
    isRecording = false;

    // Opcional: Si tienes algún timer de polling activo, asegúrate de limpiarlo aquí.
}

function handlePresetSelection(event) {
    const button = event.currentTarget;
    const presetKey = button.getAttribute('data-preset');

    // Desmarca todos los botones
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // Si el preset seleccionado es el mismo, lo deselecciona
    if (selectedPreset === presetKey) {
        selectedPreset = null;
        updateControls('idle'); // Vuelve al estado inactivo
    } else {
        // Marca el nuevo preset
        button.classList.add('active');
        selectedPreset = presetKey;
        updateControls('idle'); // Vuelve al estado inactivo, pero permite grabar
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // Inicializa el estado de los controles
    updateControls('idle'); 

    // NUEVA LÓGICA DE BOTONES DE PRESET
    const presetButtons = document.querySelectorAll('.preset-btn');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', handlePresetSelection);
    });

    // ... (El resto de tus Eventos de botones de grabación)
    if (btnRecord) btnRecord.addEventListener('click', startRecording);
    btnPause?.addEventListener('click', pauseRecording);
  btnStop?.addEventListener('click', stopRecording);

  btnCopySoap?.addEventListener('click', () => {
    if (soapOutput.value) {
      navigator.clipboard
        .writeText(soapOutput.value)
        .then(() => {
          setStatus('¡Nota SOAP copiada al portapapeles!', 'var(--ok)');
          setTimeout(() => setStatus('Listo para comenzar.'), 2000);
        })
        .catch((err) => {
          setStatus('Error al copiar al portapapeles.', 'var(--err)');
          console.error('Copy error:', err);
        });
    }
    
  });
  
if (btnClearAll) {
        btnClearAll.addEventListener('click', clearAll); // <--- AÑADIDO
    }
  soapOutput.value = '';
});
