export {};
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'medreg_local_demo.html', enabled: true });
});
chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId) chrome.sidePanel.open({ tabId });
  });
});

// Passthrough de highlights al content script
chrome.runtime.onMessage.addListener((msg) => {
  const pass = ['highlight', 'highlightMany', 'highlightNegados', 'clearHighlights'];
  if (!pass.includes(msg?.action)) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, msg);
  });
});

/* ===========================
   Google Calendar (igual que antes)
   =========================== */
const GAPI = {
  token: null,
  getTokenInteractive() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (tkn) => {
        if (chrome.runtime.lastError || !tkn) return reject(chrome.runtime.lastError || new Error('no token'));
        GAPI.token = tkn; resolve(tkn);
      });
    });
  },
  async fetchJSON(url, opts = {}) {
    const token = GAPI.token || await GAPI.getTokenInteractive();
    const res = await fetch(url, {
      ...opts,
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
      GAPI.token = null; return GAPI.fetchJSON(url, opts);
    }
    if (!res.ok) {
      let msg = `Calendar API ${res.status}`;
      try { const j = await res.json(); msg += j?.error?.message ? `: ${j.error.message}` : ""; }
      catch { const t = await res.text(); if (t) msg += `: ${t}`; }
      throw new Error(msg);
    }
    return res.json();
  },
  listUpcoming(maxResults = 15) {
    const now = new Date().toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}`;
    return GAPI.fetchJSON(url);
  },
  createEvent({ summary, description, startISO, endISO }) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
    const body = { summary: summary || "(sin título)", description: description || "",
      start: { dateTime: startISO, timeZone: tz }, end: { dateTime: endISO, timeZone: tz } };
    return GAPI.fetchJSON(url, { method: "POST", body: JSON.stringify(body) });
  },
  async logout() {
    if (!GAPI.token) return;
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token: GAPI.token }, r));
    GAPI.token = null;
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'GAPI_LOGIN')             { await GAPI.getTokenInteractive(); sendResponse({ ok: true }); }
      else if (msg?.type === 'GAPI_LOGOUT')       { await GAPI.logout();              sendResponse({ ok: true }); }
      else if (msg?.type === 'GAPI_LIST_EVENTS')  { const data = await GAPI.listUpcoming(15); sendResponse({ ok: true, data }); }
      else if (msg?.type === 'GAPI_CREATE_EVENT') { const data = await GAPI.createEvent(msg.payload || {}); sendResponse({ ok: true, data }); }
    } catch (e) { sendResponse({ ok: false, error: e?.message || String(e) }); }
  })();
  return true;
});

async function revokeTokenIfAny(token) {
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  } catch {}
  await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
}
async function logoutAll(clearAll) {
  try {
    if (typeof GAPI !== 'undefined' && GAPI.token) {
      await revokeTokenIfAny(GAPI.token); GAPI.token = null;
    } else {
      chrome.identity.getAuthToken({ interactive: false }, async (tkn) => { if (tkn) await revokeTokenIfAny(tkn); });
    }
    if (clearAll) { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); }
    else { await chrome.storage.local.remove(['medreg.protocolos_cache','medreg.protocolos_selected','medreg.extractions']); }
    chrome.tabs.create({ url: 'https://accounts.google.com/Logout' });
  } catch (e) { throw e; }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try { if (msg?.type === 'GLOBAL_LOGOUT') { await logoutAll(!!msg.payload?.clearAll); sendResponse({ ok: true }); } }
    catch (e) { sendResponse({ ok: false, error: e?.message || String(e) }); }
  })(); return true;
});

/* ===========================
   OpenRouter – Helpers
   =========================== */
async function getOpenRouterKey() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get(["openrouter_api_key"]),
    chrome.storage.sync.get(["openrouter_api_key", "medreg.openrouter_key"])
  ]);
  return (local.openrouter_api_key || sync.openrouter_api_key || sync["medreg.openrouter_key"] || "");
}
function getRefererForOR() {
  return { "HTTP-Referer": "https://medex.ar", "X-Title": "MedReg Deep Agent" };
}