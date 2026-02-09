// --- Carga de terminología (evita "terminologiaMedica is not defined")
let terminologiaMedica = {};
let termMeta = {}; // { cat: { clave: { sub: '...' } } }
async function cargarTerminologia() {
  if (Object.keys(terminologiaMedica).length) return terminologiaMedica;
  try {
    const resp = await fetch(chrome.runtime.getURL('terminologia_medica.json'));
    const lista = await resp.json();
    terminologiaMedica = {};
    termMeta = {};
    for (const item of lista) {
      const cat = item.categoria;
      if (!terminologiaMedica[cat]) terminologiaMedica[cat] = {};
      if (!termMeta[cat]) termMeta[cat] = {};
      terminologiaMedica[cat][item.clave] = item.sinonimos || [];
    termMeta[cat][item.clave] = { sub: item.subcategoria || null, sub2: item.sub2 || null };
    }
  } catch (e) {
    console.error('[MedReg] No se pudo cargar terminologia_medica.json', e);
  }
  return terminologiaMedica;
}
cargarTerminologia();

// --- Reglas de cruce / inferencia
let reglasCruce = [];
async function cargarReglasCruce() {
  if (reglasCruce.length) return reglasCruce;
  try {
    const resp = await fetch(chrome.runtime.getURL('reglas_cruce.json'));
    reglasCruce = await resp.json();
  } catch (e) {
    console.warn('[MedReg] No se pudieron cargar reglas_cruce.json', e);
    reglasCruce = [];
  }
  return reglasCruce;
}


// ======= Lógica de parseo (idéntica/compatible con tu versión) =======

// --- Subcategorías
function norm(s){ return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim(); }
function getSubcategoria(cat, clave){
  const c = Object.keys(termMeta).find(k => norm(k) === norm(cat));
  if (!c) return null;
  const key = Object.keys(termMeta[c]||{}).find(k => norm(k) === norm(clave));
  return key ? (termMeta[c][key]?.sub || null) : null;
}
function getSub2(cat, clave){
  const c = Object.keys(termMeta).find(k => norm(k) === norm(cat));
  if (!c) return null;
  const key = Object.keys(termMeta[c]||{}).find(k => norm(k) === norm(clave));
  return key ? (termMeta[c][key]?.sub2 || null) : null;
}

// Dado un item de parsed[cat], intenta recuperar la 'clave base'
function getBaseFromItem(cat, itemStr){
  const catKey = Object.keys(terminologiaMedica).find(k => norm(k) === norm(cat));
  const txt = norm(itemStr||'');
  if (!catKey) return itemStr;
  // Para medicación suele venir 'base [dosis]'
  const keys = Object.keys(terminologiaMedica[catKey] || {}).sort((a,b)=>b.length-a.length);
  const found = keys.find(k => txt.startsWith(norm(k)));
  return found || itemStr;
}

const encabezados = {
  antecedentes: /\b(AP:|Antec(?:edentes)?(?: de)?:)/i,
  riesgo: /\b(FR:|Factores de riesgo:)/i,
  medicacion: /\b(MH:|Med(?:icación)?(?: habitual)?:)/i,
  laboratorio: /\b(Lab:|Labo:)/i
};

function sinAcentos(s){ return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }

function contieneNegacion(oracion, termino) {
  const negaciones = ["no","niega","sin","ausencia de","desconoce","sin evidencia de","negativo para"];
  const afirmaciones = ["si","presenta","refiere","con","dx de","dx","diagnosticado de"];
  const reversores = ["pero","aunque","sin embargo","no obstante","excepto","salvo","aunque luego"];
  const ol = sinAcentos(oracion), tl = sinAcentos(termino);
  const idx = ol.indexOf(tl); if (idx === -1) return false;
  const antes = ol.slice(0, idx);
  const tokens = antes.split(/\s|,|;/).filter(Boolean).reverse();
  for (const p of tokens) {
    if (reversores.includes(p) || afirmaciones.includes(p)) break;
    if (negaciones.includes(p)) return true;
  }
  return false;
}

function distanciaLevenshtein(a, b) {
  const A = sinAcentos(a), B = sinAcentos(b);
  const matrix = Array.from({ length: B.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= A.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= B.length; i++) {
    for (let j = 1; j <= A.length; j++) {
      matrix[i][j] = (B[i - 1] === A[j - 1])
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + 1);
    }
  }
  return matrix[B.length][A.length];
}

function extraerEdad(texto) {
  const t = sinAcentos(texto);
  const rx = /\b(?:edad|paciente|de)\s*[:=]?\s*(\d{1,3})\s*(?:anos|a)?\b|\b(\d{1,3})\s*a(?:nos)?\b/i;
  const m = t.match(rx);
  return m ? parseInt(m[1] || m[2]) : null;
}

function extraerBloquesPorEncabezado(texto) {
  const bloques = {}; let actual = null;
  texto.split(/\n|\r/).forEach(linea => {
    let l = (linea||'').trim(); if(!l) return;
    for (const [cat, regex] of Object.entries(encabezados)) {
      if (regex.test(l)) { actual = cat; bloques[cat] = []; l = l.replace(regex,'').trim(); break; }
    }
    if (actual && l) bloques[actual].push(l);
  });
  return bloques;
}

function hasWord(oracion, termino){
  const a = sinAcentos(oracion);
  const b = sinAcentos(termino).replace(/\s+/g,'\\s+').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const r = new RegExp(`\\b${b}\\b`, 'i');
  return r.test(a);
}

// =========================================================================
// !!! MODIFICACIÓN: ACEPTAR Y APLICAR FILTROS A LA BÚSQUEDA GENERAL !!!
// =========================================================================
function buscarTerminos(texto, categoria, filters = {}) {
  const encontrados = new Set();
  if (!texto || !terminologiaMedica?.[categoria]) return [];
  
  const { filterCat, filterClave, filterSub, filterSub2 } = filters;

  // Si hay un filtro global de categoría y no coincide con la actual, salir.
  if (filterCat && norm(categoria) !== norm(filterCat)) return [];

  const oraciones = texto.split(/(?<=[.!?\n\r])|(?=\s*-\s*)|[,;]/);
  
  for (const [base, sinonimos] of Object.entries(terminologiaMedica[categoria])) {
    
    // --- LÓGICA DE FILTRADO ---
    const meta = termMeta[categoria]?.[base];
    if (!meta) continue;

    if (filterClave && norm(base) !== norm(filterClave)) continue;
    // AQUÍ SE ARREGLA EL PROBLEMA: solo busca si la subcategoría del término
    // coincide con la subcategoría filtrada.
    if (filterSub && norm(meta.sub) !== norm(filterSub)) continue;
    
    if (filterSub2 && norm(meta.sub2) !== norm(filterSub2)) continue;
    // --- FIN LÓGICA DE FILTRADO ---
    
    const patrones = [base, ...sinonimos];
    let ok = false;
    
    for (const oracion of oraciones) {
      const palabras = oracion.split(/\s+/).filter(p => p.length > 2);
      
      // Búsqueda exacta y negación
      for (const termino of patrones) {
        if (hasWord(oracion, termino) && !contieneNegacion(oracion, termino)) { encontrados.add(base); ok = true; break; }
      }
      if (ok) break;

      // Búsqueda difusa (Levenshtein d=1)
      if (!ok) {
        for (const palabra of palabras) {
          for (const termino of patrones) {
            const d = distanciaLevenshtein(palabra, termino);
            if (d === 1 && !contieneNegacion(oracion, palabra)) { encontrados.add(base); ok = true; break; }
          }
          if (ok) break;
        }
      }
    }
  }
  return Array.from(encontrados);
}

// =========================================================================
// !!! MODIFICACIÓN: ACEPTAR Y APLICAR FILTROS A LA BÚSQUEDA DE MEDICACIÓN !!!
// =========================================================================
function buscarMedicacionConDosis(texto, filters = {}) {
  const resultados = new Map();
  if (!texto || !terminologiaMedica?.medicacion) return [];
  
  const { filterCat, filterClave, filterSub, filterSub2 } = filters;
  if (filterCat && norm('medicacion') !== norm(filterCat)) return [];

  for (const [base, sinonimos] of Object.entries(terminologiaMedica.medicacion)) {
    
    // --- LÓGICA DE FILTRADO ---
    const meta = termMeta['medicacion']?.[base];
    if (!meta) continue;

    if (filterClave && norm(base) !== norm(filterClave)) continue;
    if (filterSub && norm(meta.sub) !== norm(filterSub)) continue;
    if (filterSub2 && norm(meta.sub2) !== norm(filterSub2)) continue;
    // --- FIN LÓGICA DE FILTRADO ---

    const patrones = [base, ...sinonimos];
    for (const termino of patrones) {
      const esc = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = `\\b${esc}\\b(?:[^\\d\\n\\r]{0,12})?(\\d+(?:[.,]\\d+)?\\s*(?:mg|mcg|g|ml|ug))?`;
      const re = new RegExp(pattern, 'gi');
      let m;
      while ((m = re.exec(texto))) {
        if (!contieneNegacion(m[0], termino) && !resultados.has(base)) {
          const dosis = m[1] ? ` ${m[1].trim()}` : '';
          resultados.set(base, `${base}${dosis}`);
          break;
        }
      }
    }
  }
  
  // fallback difuso leve
  if (resultados.size === 0) {
    const palabras = texto.split(/\s+/).filter(p => p.length > 2);
    for (const palabra of palabras) {
      for (const [base, sinonimos] of Object.entries(terminologiaMedica.medicacion || {})) {
        
        // --- FILTRO REAPLICADO A FALLBACK ---
        const meta = termMeta['medicacion']?.[base];
        if (!meta) continue;

        if (filterClave && norm(base) !== norm(filterClave)) continue;
        if (filterSub && norm(meta.sub) !== norm(filterSub)) continue;
        if (filterSub2 && norm(meta.sub2) !== norm(filterSub2)) continue;
        // --- FIN FILTRO REAPLICADO ---
        
        for (const termino of [base, ...sinonimos]) {
          if (distanciaLevenshtein(palabra, termino) === 1 && !contieneNegacion(texto, palabra)) {
            resultados.set(base, base);
          }
        }
      }
    }
  }
  return Array.from(resultados.values());
}

// =========================================================================
// !!! MODIFICACIÓN: ACEPTAR Y APLICAR FILTROS A LA BÚSQUEDA DE LABORATORIO !!!
// =========================================================================
function buscarLaboratorio(texto, filters = {}) {
  const out = [];
  if (!texto) return out;
  
  const { filterCat, filterClave, filterSub, filterSub2 } = filters;
  if (filterCat && norm('laboratorio') !== norm(filterCat)) return [];

  for (const [base, sinonimos] of Object.entries(terminologiaMedica?.laboratorio || {})) {

    // --- LÓGICA DE FILTRADO ---
    const meta = termMeta['laboratorio']?.[base];
    if (!meta) continue;

    if (filterClave && norm(base) !== norm(filterClave)) continue;
    if (filterSub && norm(meta.sub) !== norm(filterSub)) continue;
    if (filterSub2 && norm(meta.sub2) !== norm(filterSub2)) continue;
    // --- FIN LÓGICA DE FILTRADO ---

    const pats = [base, ...sinonimos].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(
      `\\b(${pats.join("|")})\\b(?:\\s*(?:[:=]|es|es de|de)?\\s*)(\\d+(?:[.,]\\d+)?)(?:\\s*(mg/dL|%|mmol/L|g/dL|mEq/L|U/L|ng/mL|μg/mL|ng/dL|ml/min|mL\\/min|))?`,
      'gi'
    );
    let m;
    while ((m = re.exec(texto))) {
      const valor = m[2].replace(',', '.');
      const unidad = m[3] || '';
      out.push(`${base}: ${valor}${unidad ? ' ' + unidad : ''}`);
    }
  }
  return out;
}

function keyProv(cat, clave) { return `${cat}|${sinAcentos(clave)}`; }


function aplicarInferencias(parsed) {
  const prov = {};
  const has = (cat, clave) => (parsed[cat] || []).some(x => sinAcentos(x) === sinAcentos(clave));
  const add = (cat, clave, by) => {
    if (!parsed[cat]) parsed[cat] = [];
    if (!has(cat, clave)) parsed[cat].push(clave);
    const k = keyProv(cat, clave);
    if (!prov[k]) prov[k] = [];
    prov[k].push(by);
  };

 const matchRuleIf = (src) => {
  if (!src || !src.cat) return false;

  // normalizar: aceptar src.subcategoria como src.sub
  const sub = src.sub || src.subcategoria || null;
  const fam = src.sub2 || null;

  // 1) por clave explícita
  if (src.clave && has(src.cat, src.clave)) return true;

  // 2) por subcategoria
  if (sub) {
    const lista = parsed[src.cat] || [];
    for (const it of lista) {
      const base = getBaseFromItem(src.cat, it);
      const s = getSubcategoria(src.cat, base);
      if (s && norm(s) === norm(sub)) return true;
    }
  }

  // 3) por sub2 (familia)
  if (fam) {
    const lista = parsed[src.cat] || [];
    for (const it of lista) {
      const base = getBaseFromItem(src.cat, it);
      const s2 = getSub2(src.cat, base);
      if (s2 && norm(s2) === norm(fam)) return true;
    }
  }

  return false;
};

  // guardamos procedencia + subcategorías detectadas por conveniencia
  const subs = {};
  for (const cat of Object.keys(parsed)) {
    if (!Array.isArray(parsed[cat])) continue;
    subs[cat] = {};
    for (const it of parsed[cat]) {
      const base = getBaseFromItem(cat, it);
      const sub = getSubcategoria(cat, base);
      if (sub) subs[cat][base] = sub;
    }
  }
  parsed.__prov = prov;
  parsed.__submap = subs;
  return parsed;
}


// =========================================================================
// !!! MODIFICACIÓN: ACEPTAR FILTROS EN LA EXTRACCIÓN GLOBAL !!!
// =========================================================================
function extraerDatosHC(textoHC, filters = {}) {
  const bloques = extraerBloquesPorEncabezado(textoHC);
  return {
    edad: extraerEdad(textoHC),
    antecedentes: buscarTerminos(bloques.antecedentes?.join(' ') || textoHC, 'antecedentes', filters),
    factoresRiesgo: buscarTerminos(bloques.riesgo?.join(' ') || textoHC, 'riesgo', filters),
    medicacion: buscarMedicacionConDosis(bloques.medicacion?.join(' ') || textoHC, filters),
    laboratorio: buscarLaboratorio(bloques.laboratorio?.join(' ') || textoHC, filters)
  };
}

// --- extracción básica de texto + clasificación liviana
function classifyHeuristic(rawText) {
  const out = { datosPersonales:[], antecedentes:[], factoresRiesgo:[], medicacion:[], estudios:[], sintomasMotivo:[] };
  const lines = (rawText || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const kw = {
    datos:[/^datos\b/i, /\b(dni|documento|edad|sexo|domicilio|tel[eé]fono|obra social)\b/i],
    antec:[/\bantec|\bap\b|antecedentes?\b/i],
    riesgo:[/\bfactores?\s+de\s+riesgo\b/i, /\bhta\b|\bhipertensi[oó]n\b|\bdm\b|\bdiabetes\b|\bdislip(i|e)demia\b|\btabaquismo\b|\bobesidad\b/i],
    med:[/\bmedicaci[óo]n\b|\btratamiento\b/i, /\bmg\b|\btabletas?\b|\bdosis\b/i],
    estudios:[/\blaboratorio\b|\blabs?\b|\bparacl[ií]nicos\b|\becocardiograma\b|\bangiotomograf[ií]a\b|\bholter\b|\bmapa\b|\brx\b|\bres[oa]\b/i],
    sintomas:[/\bs[ií]ntomas?\b|\bmotivo\s+de\s+consulta\b|\bdolor\b|\bdisnea\b|\bpalpitaciones\b|\bs[ií]ncope\b|\bmareos?\b/i]
  };
  for (const ln of lines) {
    if (kw.datos.some(rx=>rx.test(ln))) out.datosPersonales.push(ln);
    if (kw.antec.some(rx=>rx.test(ln))) out.antecedentes.push(ln);
    if (kw.riesgo.some(rx=>rx.test(ln))) out.factoresRiesgo.push(ln);
    if (kw.med.some(rx=>rx.test(ln))) out.medicacion.push(ln);
    if (kw.estudios.some(rx=>rx.test(ln))) out.estudios.push(ln);
    if (kw.sintomas.some(rx=>rx.test(ln))) out.sintomasMotivo.push(ln);
  }
  return out;
}

async function extractPageText() {
  const title = document.title || "";
  const url = location.href || "";
  let rawText = "";
  try {
    rawText = (document.body && document.body.innerText) ? document.body.innerText
            : (document.documentElement.innerText || "");
  } catch {
    rawText = document.documentElement?.textContent || "";
  }
  rawText = rawText.replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const classified = classifyHeuristic(rawText);
  return { title, url, rawText, classified };
}

// --- Mensajería
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'MEDREG_PING') {
    sendResponse({ ok: true }); return;
  }

  if (msg.type === 'MEDREG_EXTRACT_DOM') {
    (async () => { sendResponse(await extractPageText()); })();
    return true;
  }

  // NUEVO: devuelve parseo completo (usa terminología cargada arriba)
  // =========================================================================
  // !!! MODIFICACIÓN: CAPTURAR FILTROS DEL MENSAJE Y PASARLOS !!!
  // =========================================================================
  if (msg.type === 'MEDREG_EXTRACT_PARSED') {
    (async () => {
      await Promise.all([cargarTerminologia(), cargarReglasCruce()]);
      const { rawText } = await extractPageText();
      // Capturar los filtros del mensaje (msg.filter) y pasarlos a la función de extracción
      const filters = msg.filter || {};
      const base = extraerDatosHC(rawText, filters);
      const enriched = aplicarInferencias(base);
      sendResponse({ parsed: enriched, rawText });
    })();
    return true;
  }
});


// === Handler para herramientas del Agente Deep ejecutadas en el DOM ===
// ========== Utils ==========
// === AGENTE DEEP: tools (solo Evoluciones) ===

// Localiza el contenedor del "Historial de registros de HC"
function findTimelineContainer() {
  // 1) ancla por texto del encabezado
  const header = [...document.querySelectorAll('h1,h2,h3,h4,div,strong,span')]
    .find(el => /Historial de registros de HC/i.test(el.textContent || ''));
  if (!header) return null;

  // 2) busca un contenedor lógico a la derecha del header
  // (sube un poco y luego toma el contenedor padre más cercano con varios hijos)
  let box = header.closest('section,div,article') || header.parentElement;
  for (let i = 0; i < 3 && box && box.children && box.children.length < 2; i++) {
    box = box.parentElement;
  }
  return box || null;
}

// Devuelve los ítems (evoluciones) clickeables del timeline (de arriba hacia abajo)
function getTimelineItems() {
  const cont = findTimelineContainer();
  if (!cont) return [];

  // Heurística robusta: tomamos botones/enlaces “píldora” a la derecha (Consulta general, Ecocardiograma, Control de resultados)
  const pills = [...cont.querySelectorAll('a,button,div,span')]
    .filter(el => /Consulta general|Ecocardiograma|Control de resultados/i.test(el.textContent || ''));

  // Normalizamos a "ítem clickeable" subiendo al contenedor más cercano que responda al click
  const items = pills.map(el => {
    const clickable = el.closest('a,button,[onclick]') || el;
    const wrapper   = clickable.closest('li,div,article,section') || clickable;
    return { clickable, wrapper };
  });

  // Quitamos duplicados por wrapper
  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    if (!seen.has(it.wrapper)) {
      seen.add(it.wrapper);
      uniq.push(it);
    }
  }
  return uniq;
}

// Clickea el ítem N (0 = el más reciente visible)
async function clickTimelineNth(n = 0) {
  const items = getTimelineItems();
  if (!items.length) return { ok: false, reason: 'timeline_empty' };
  const idx = Math.max(0, Math.min(n, items.length - 1));
  items[idx].clickable.click();
  await new Promise(r => setTimeout(r, 600)); // pequeño delay para que cargue la evolución
  return { ok: true, total: items.length, index: idx };
}

// Abre el primer ítem cuyo “pill” contenga alguna etiqueta solicitada (p.ej. Ecocardiograma)
async function openTimelineByLabel(labels = ['Ecocardiograma', 'Control de resultados']) {
  const cont = findTimelineContainer();
  if (!cont) return { ok: false, reason: 'no_timeline' };

  const all = getTimelineItems();
  if (!all.length) return { ok: false, reason: 'timeline_empty' };

  for (let i = 0; i < all.length; i++) {
    const txt = (all[i].wrapper.textContent || '').trim();
    if (labels.some(l => new RegExp(l, 'i').test(txt))) {
      all[i].clickable.click();
      await new Promise(r => setTimeout(r, 600));
      return { ok: true, match: txt, index: i, total: all.length };
    }
  }
  return { ok: false, reason: 'no_label_match', total: all.length };
}

// Extrae el texto “principal” de la evolución abierta (toda la card de la izquierda)
function scrapeEvolutionText() {
  // buscamos la card central con campos como Motivo, Detalle ECG, Resultados de estudios complementarios, etc.
  const candidates = [...document.querySelectorAll('section,div,article')]
    .filter(el => /Motivo de consulta|Resultados de estudios|Detalle ECG|Plan|Diagnóstico/i.test(el.textContent || ''));

  // nos quedamos con el bloque más grande que contenga varios ítems
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const score = (el.textContent || '').length;
    if (score > bestScore) { best = el; bestScore = score; }
  }
  const text = (best ? best.textContent : document.body.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return { ok: !!text, text };
}

// Intenta extraer el resultado del ecocardiograma de la evolución abierta
function extractLastEcho(text) {
  if (!text) return null;

  // 1) si hay un bloque que empiece por "Ecocardiograma:" lo tomamos completo hasta el fin de párrafo
  const m1 = text.match(/Ecocardiograma:\s*([\s\S]{0,800}?)(?:\n{2,}|Plan:|Diagnóstico|Examen físico|Motivo|Detalle|$)/i);
  if (m1) return m1[1].trim();

  // 2) si no, buscamos “Eco bed|Ecocardio|ECO doppler|Eco:” y tomamos la oración/bloque
  const m2 = text.match(/(Eco(?:cardiograma)?(?:\s+bedside)?[:\s-]*[\s\S]{0,500}?)(?:\n{2,}|Plan:|Diagnóstico|Examen físico|Motivo|Detalle|$)/i);
  if (m2) return m2[1].trim();

  // 3) fallback: si en "Resultados de estudios complementarios" hay algo, tomamos ese párrafo
  const m3 = text.match(/Resultados? de estudios complementarios:?[\s\n]*([\s\S]{0,700}?)(?:\n{2,}|Plan:|Diagnóstico|Examen físico|Motivo|Detalle|$)/i);
  if (m3) return m3[1].trim();

  return null;
}

// ==== Mensajería para background.js ====
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.kind === 'AGENT:LIST_TIMELINE') {
        const items = getTimelineItems();
        sendResponse({ ok: true, total: items.length });
        return;
      }
      if (msg?.kind === 'AGENT:OPEN_BY_LABEL') {
        const res = await openTimelineByLabel(msg.labels || undefined);
        sendResponse(res);
        return;
      }
      if (msg?.kind === 'AGENT:OPEN_NTH') {
        const res = await clickTimelineNth(msg.n ?? 0);
        sendResponse(res);
        return;
      }
      if (msg?.kind === 'AGENT:SCRAPE_EVO') {
        const { ok, text } = scrapeEvolutionText();
        sendResponse({ ok, text });
        return;
      }
      if (msg?.kind === 'AGENT:SCRAPE_LAST_ECHO') {
        const { ok, text } = scrapeEvolutionText();
        if (!ok) { sendResponse({ ok: false, reason: 'no_text' }); return; }
        const echo = extractLastEcho(text);
        sendResponse({ ok: !!echo, echo, raw: text });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open
});
// === END AGENTE DEEP: tools (solo Evoluciones) ===
