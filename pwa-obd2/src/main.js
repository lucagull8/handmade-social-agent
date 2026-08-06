// -----------------------------------------------------------------------------
// PWA "Diagnosi Auto — OBD2" — punto di ingresso.
// UI in italiano, gestione stato semplice basata su re-render della schermata
// attiva. Nessun framework per restare leggeri.
// -----------------------------------------------------------------------------

import './styles.css';
import { ElmBleClient } from './ble.js';
import { MODE01, parseDtcResponse, parseClearResponse } from './obd.js';
import { describeDtc } from './dtc.js';
import { interpretaDtc, getApiKey, setApiKey, hasApiKey } from './openai.js';
import { createDemoClient, fakeInterpretazione, DEMO_DTCS } from './demo.js';

// ---------- Registrazione service worker (PWA) -------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(err => {
      console.warn('SW non registrato:', err);
    });
  });
}

// ---------- Stato applicazione ----------------------------------------------
const state = {
  screen: 'connessione',      // 'connessione' | 'dtc' | 'live' | 'impostazioni'
  client: null,               // ElmBleClient oppure demo client
  demo: false,
  connected: false,
  connecting: false,
  initDone: false,
  logs: [],
  dtcCodes: [],               // array di stringhe "P0301"
  dtcInterpretazioni: {},     // { P0301: { significato, ... } | { errore: '...' } }
  livePolling: null,          // handle setInterval
  liveData: { rpm: null, speed: null, coolant: null },
  toast: null                 // { type, msg }
};

const $app = document.getElementById('app');

// ---------- Utilities di rendering ------------------------------------------
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
function toast(type, msg) {
  state.toast = { type, msg };
  render();
  setTimeout(() => { if (state.toast?.msg === msg) { state.toast = null; render(); } }, 5000);
}
function log(msg) {
  state.logs.unshift(`${new Date().toLocaleTimeString()} — ${msg}`);
  state.logs = state.logs.slice(0, 200);
  // Aggiorna il logbox se visibile senza re-render completo
  const box = document.getElementById('logbox');
  if (box) box.textContent = state.logs.join('\n');
}

// ---------- Header + tab bar -------------------------------------------------
function renderHeader() {
  const pill = state.demo
    ? h('span', { class: 'status-pill demo' }, 'MODALITÀ DEMO')
    : state.connected
      ? h('span', { class: 'status-pill on' }, 'Adattatore collegato')
      : h('span', { class: 'status-pill off' }, 'Non collegato');

  return h('header', { class: 'topbar' }, [
    h('div', { class: 'brand' }, [
      h('div', { class: 'logo' }, 'D'),
      h('h1', {}, 'Diagnosi Auto')
    ]),
    pill
  ]);
}
function renderTabs() {
  const tab = (id, label) => h('button', {
    class: state.screen === id ? 'active' : '',
    onclick: () => { state.screen = id; render(); }
  }, label);
  return h('nav', { class: 'tabs' }, [
    tab('connessione', 'Connessione'),
    tab('dtc',         'Codici errore'),
    tab('live',        'Dati live'),
    tab('impostazioni','Impostazioni')
  ]);
}

// ---------- Schermata: CONNESSIONE ------------------------------------------
function screenConnessione() {
  const supported = ElmBleClient.isSupported();

  const onboarding = h('div', { class: 'panel onboarding' }, [
    h('h2', {}, 'Come collegare l\'auto'),
    h('ol', {}, [
      h('li', {}, [ h('span', { class: 'tag' }, '1'), 'Inserisci l\'adattatore Vgate nella presa OBD dell\'auto (di solito sotto il volante).' ]),
      h('li', {}, [ h('span', { class: 'tag' }, '2'), 'Gira la chiave su MAR (senza avviare il motore). Il led dell\'adattatore deve accendersi.' ]),
      h('li', {}, [ h('span', { class: 'tag' }, '3'), 'Sul PC controlla che il Bluetooth sia acceso. Non serve accoppiare l\'adattatore dalle impostazioni di Windows.' ]),
      h('li', {}, [ h('span', { class: 'tag' }, '4'), 'Premi "Cerca adattatore", scegli il tuo Vgate iCar Pro dalla finestra di Chrome, e poi premi "Connetti".' ])
    ])
  ]);

  const supportBox = !supported
    ? h('div', { class: 'callout bad' }, 'Questo browser non supporta Web Bluetooth. Apri l\'app in Chrome o Edge desktop su http://localhost:5173.')
    : null;

  const controls = h('div', { class: 'panel stack' }, [
    h('h2', {}, 'Adattatore OBD-II'),
    h('p', { class: 'muted' }, state.connected
      ? (state.demo ? 'Sei in MODALITÀ DEMO: puoi provare tutte le schermate senza auto.' : 'Adattatore collegato. Puoi passare a "Codici errore" o "Dati live".')
      : 'Non sei collegato. Puoi collegarti a un adattatore reale o usare la modalità DEMO.'),
    h('div', { class: 'row' }, [
      h('button', {
        class: 'btn primary',
        disabled: !supported || state.connecting || state.connected,
        onclick: onCercaEConnetti
      }, state.connecting ? 'Connessione...' : 'Cerca adattatore e connetti'),
      h('button', {
        class: 'btn ghost',
        disabled: !state.connected,
        onclick: onDisconnetti
      }, 'Disconnetti'),
      h('button', {
        class: 'btn warn',
        disabled: state.connected,
        onclick: onAvviaDemo
      }, 'Avvia modalità DEMO')
    ]),
    state.initDone
      ? h('div', { class: 'callout ok' }, 'Inizializzazione ELM327 completata. Puoi leggere i codici o i dati live.')
      : null,
    h('div', {}, [
      h('label', { class: 'field' }, 'Log tecnico (utile per debug)'),
      h('div', { id: 'logbox', class: 'logbox' }, state.logs.join('\n'))
    ])
  ]);

  return h('div', { class: 'stack' }, [supportBox, onboarding, controls]);
}

async function onCercaEConnetti() {
  try {
    state.connecting = true; render();
    if (!(await ElmBleClient.isBluetoothAvailable())) {
      throw new Error('Il Bluetooth del PC è spento. Accendilo dalle impostazioni di Windows e riprova.');
    }
    const client = new ElmBleClient();
    client.onLog = log;
    client.onDisconnect = () => {
      state.connected = false;
      state.initDone = false;
      stopLivePolling();
      toast('warn', 'Adattatore disconnesso.');
      render();
    };
    await client.requestDevice();
    await client.connect();
    state.client = client;
    state.demo = false;
    state.connected = true;
    render();
    log('Avvio inizializzazione ELM327...');
    await client.initElm();
    state.initDone = true;
    toast('ok', 'Adattatore pronto!');
  } catch (err) {
    log(`Errore: ${err.message}`);
    // Errori tipici Chrome quando l'utente chiude il picker
    if (/user cancelled|User cancelled/i.test(err.message)) {
      toast('warn', 'Selezione annullata.');
    } else {
      toast('bad', err.message);
    }
  } finally {
    state.connecting = false; render();
  }
}
async function onDisconnetti() {
  stopLivePolling();
  try { await state.client?.disconnect(); } catch { /* ignore */ }
  state.client = null; state.connected = false; state.initDone = false; state.demo = false;
  toast('info', 'Disconnesso.');
  render();
}
async function onAvviaDemo() {
  const client = createDemoClient({ onLog: log });
  state.client = client; state.demo = true; state.connected = true;
  await client.initElm();
  state.initDone = true;
  toast('info', 'MODALITÀ DEMO attiva. I dati sono simulati.');
  render();
}

// ---------- Schermata: DTC ---------------------------------------------------
function screenDtc() {
  const canReadWrite = state.connected && state.initDone;

  const controls = h('div', { class: 'panel stack' }, [
    h('h2', {}, 'Codici errore (spia motore)'),
    h('p', { class: 'muted' }, canReadWrite
      ? 'Premi "Leggi codici" per interrogare la centralina.'
      : 'Prima devi collegarti (o avviare la modalità DEMO) nella scheda "Connessione".'),
    h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', disabled: !canReadWrite, onclick: onLeggiDtc }, 'Leggi codici errore'),
      h('button', { class: 'btn bad', disabled: !canReadWrite || state.dtcCodes.length === 0, onclick: onCancellaDtc }, 'Spegni spia (cancella)')
    ])
  ]);

  const results = h('div', { class: 'stack' });
  if (state.dtcCodes.length === 0) {
    results.appendChild(h('div', { class: 'panel callout ok' },
      canReadWrite ? 'Nessun codice memorizzato al momento. Premi "Leggi codici" per interrogare la centralina.'
                   : 'Collegati prima all\'adattatore per leggere i codici.'));
  } else {
    for (const code of state.dtcCodes) {
      results.appendChild(renderDtcCard(code));
    }
  }
  return h('div', { class: 'stack' }, [controls, results]);
}

function renderDtcCard(code) {
  const interp = state.dtcInterpretazioni[code];
  const shortDesc = describeDtc(code);

  const urgenza = interp?.urgenza || 'media';
  const badgeClass = urgenza === 'bassa' ? 'low' : urgenza === 'alta' ? 'high' : 'med';
  const badgeText  = urgenza === 'bassa' ? 'Urgenza bassa' : urgenza === 'alta' ? 'Urgenza alta' : 'Urgenza media';

  const posso = interp?.posso_guidare?.toLowerCase();
  const guidaClass = posso === 'sì' ? 'ok' : posso === 'no' ? 'bad' : 'warn';
  const guidaText = posso ? {
    'sì': '✅ Puoi guidare',
    'no': '⛔ Non guidare',
    'sì ma con cautela': '⚠️ Guida con cautela'
  }[posso] || `Guida: ${interp.posso_guidare}` : null;

  const head = h('div', { class: 'dtc-head' }, [
    h('span', { class: 'dtc-code' }, code),
    h('span', { class: 'dtc-desc' }, shortDesc),
    interp && !interp.errore ? h('span', { class: `dtc-badge ${badgeClass}` }, badgeText) : null,
    guidaText ? h('span', { class: `callout ${guidaClass}` }, guidaText) : null
  ]);

  let body;
  if (interp && interp.errore) {
    body = h('div', { class: 'callout bad' }, `Errore interpretazione: ${interp.errore}`);
  } else if (interp) {
    body = h('div', { class: 'dtc-body' }, [
      h('div', { class: 'dtc-row' }, [ h('div', { class: 'label' }, 'Cosa significa'),      h('div', {}, interp.significato) ]),
      h('div', { class: 'dtc-row' }, [ h('div', { class: 'label' }, 'Causa probabile'),     h('div', {}, interp.causa_probabile) ]),
      h('div', { class: 'dtc-row' }, [ h('div', { class: 'label' }, 'Perché'),              h('div', {}, interp.perche_guida) ]),
      h('div', { class: 'dtc-row' }, [ h('div', { class: 'label' }, 'Costo indicativo'),    h('div', {}, interp.costo_indicativo_eur) ]),
      h('div', { class: 'dtc-row' }, [ h('div', { class: 'label' }, 'Cosa fare'),           h('div', {}, interp.cosa_fare) ])
    ]);
  } else {
    body = h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', onclick: () => onInterpretaDtc(code) },
        state.demo && !hasApiKey() ? 'Spiegami (DEMO)' : 'Spiegami con AI')
    ]);
  }

  return h('div', { class: 'dtc-card' }, [head, body]);
}

async function onLeggiDtc() {
  try {
    log('Invio comando 03 (lettura DTC)...');
    const raw = await state.client.sendCommand('03', { timeoutMs: 8000 });
    log(`Risposta: ${raw.replace(/\n/g, ' | ')}`);
    const codes = parseDtcResponse(raw);
    state.dtcCodes = codes;
    state.dtcInterpretazioni = {};
    if (codes.length === 0) toast('ok', 'Nessun codice errore memorizzato.');
    else toast('info', `Trovati ${codes.length} codici.`);
    render();
  } catch (err) {
    log(`Errore lettura DTC: ${err.message}`);
    toast('bad', umanizzaErroreObd(err.message));
  }
}

async function onCancellaDtc() {
  const ok = confirm(
    'ATTENZIONE\n\n' +
    'Stai per cancellare i codici di errore e spegnere la spia motore.\n' +
    'Se il problema è ancora presente la spia si riaccenderà da sola.\n\n' +
    'Vuoi procedere?'
  );
  if (!ok) return;
  try {
    log('Invio comando 04 (cancella DTC)...');
    const raw = await state.client.sendCommand('04', { timeoutMs: 6000 });
    log(`Risposta: ${raw.replace(/\n/g, ' | ')}`);
    parseClearResponse(raw);
    state.dtcCodes = [];
    state.dtcInterpretazioni = {};
    toast('ok', 'Codici cancellati. Se la spia era accesa dovrebbe spegnersi.');
    render();
  } catch (err) {
    log(`Errore cancellazione DTC: ${err.message}`);
    toast('bad', umanizzaErroreObd(err.message));
  }
}

async function onInterpretaDtc(code) {
  // In demo, se non c'è API key, usiamo l'interpretazione finta.
  if (state.demo && !hasApiKey()) {
    state.dtcInterpretazioni[code] = fakeInterpretazione(code);
    render();
    return;
  }
  try {
    state.dtcInterpretazioni[code] = { significato: 'Chiedo all\'assistente AI...', causa_probabile: '', posso_guidare: '', perche_guida: '', urgenza: 'media', costo_indicativo_eur: '', cosa_fare: '' };
    render();
    const res = await interpretaDtc(code, describeDtc(code));
    state.dtcInterpretazioni[code] = res;
  } catch (err) {
    state.dtcInterpretazioni[code] = { errore: err.message };
  } finally {
    render();
  }
}

function umanizzaErroreObd(msg) {
  const m = msg.toUpperCase();
  if (m.includes('NO_DATA')) return 'La centralina non ha risposto. Prova a girare la chiave, o accendere il motore, e riprova.';
  if (m.includes('UNABLE_TO_CONNECT')) return 'L\'adattatore non riesce a parlare con la centralina. Verifica che la chiave sia su MAR.';
  if (m.includes('BUS_INIT') || m.includes('BUS INIT')) return 'Il bus dell\'auto non risponde. Prova a spegnere e riaccendere.';
  return `Problema di comunicazione: ${msg}`;
}

// ---------- Schermata: LIVE --------------------------------------------------
function screenLive() {
  const canRead = state.connected && state.initDone;
  const running = !!state.livePolling;
  const controls = h('div', { class: 'panel stack' }, [
    h('h2', {}, 'Dati live del motore'),
    h('p', { class: 'muted' }, canRead
      ? 'Se il motore è spento vedrai valori a zero o assenti. Per giri e temperatura serve il motore avviato.'
      : 'Prima devi collegarti (o avviare DEMO).'),
    h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', disabled: !canRead || running, onclick: startLivePolling }, 'Avvia lettura'),
      h('button', { class: 'btn ghost',   disabled: !running, onclick: stopLivePolling }, 'Ferma lettura')
    ])
  ]);

  const gauge = (label, value, unit) => h('div', { class: 'gauge' }, [
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value == null ? '—' : String(value)),
    h('div', { class: 'unit' }, unit)
  ]);

  const grid = h('div', { class: 'panel' }, [
    h('div', { class: 'live-grid' }, [
      gauge('Giri motore',    state.liveData.rpm,      'giri/min'),
      gauge('Velocità',       state.liveData.speed,    'km/h'),
      gauge('Temp. liquido',  state.liveData.coolant,  '°C')
    ])
  ]);

  return h('div', { class: 'stack' }, [controls, grid]);
}

function startLivePolling() {
  if (state.livePolling) return;
  const poll = async () => {
    try {
      // Interroghiamo in serie (ELM327 gestisce un comando alla volta)
      const rpmRaw     = await state.client.sendCommand(MODE01.rpm.cmd,         { timeoutMs: 2500 }).catch(() => null);
      const speedRaw   = await state.client.sendCommand(MODE01.speed.cmd,       { timeoutMs: 2500 }).catch(() => null);
      const coolantRaw = await state.client.sendCommand(MODE01.coolantTemp.cmd, { timeoutMs: 2500 }).catch(() => null);
      if (rpmRaw)     try { state.liveData.rpm     = MODE01.rpm.parse(rpmRaw); } catch { /* skip */ }
      if (speedRaw)   try { state.liveData.speed   = MODE01.speed.parse(speedRaw); } catch { /* skip */ }
      if (coolantRaw) try { state.liveData.coolant = MODE01.coolantTemp.parse(coolantRaw); } catch { /* skip */ }
      render();
    } catch (err) {
      log(`Errore live: ${err.message}`);
    }
  };
  poll();
  state.livePolling = setInterval(poll, 1500);
  render();
}
function stopLivePolling() {
  if (state.livePolling) { clearInterval(state.livePolling); state.livePolling = null; render(); }
}

// ---------- Schermata: IMPOSTAZIONI -----------------------------------------
function screenImpostazioni() {
  return h('div', { class: 'panel stack' }, [
    h('h2', {}, 'Impostazioni'),
    h('p', {}, 'Per far spiegare i codici errore in italiano semplice, l\'app usa l\'AI di OpenAI (GPT-4). Serve una chiave personale (crea la tua su platform.openai.com).'),
    h('label', { class: 'field', for: 'apikey' }, 'API key OpenAI (sk-...)'),
    h('input', { class: 'text', id: 'apikey', type: 'password', placeholder: 'sk-...', value: getApiKey() }),
    h('p', { class: 'muted' }, 'La chiave viene salvata SOLO sul tuo computer (in localStorage del browser). Non viene inviata a nessuno se non a OpenAI.'),
    h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', onclick: () => {
        const v = document.getElementById('apikey').value.trim();
        setApiKey(v);
        toast('ok', v ? 'API key salvata.' : 'API key rimossa.');
        render();
      }}, 'Salva'),
      h('button', { class: 'btn ghost', onclick: () => {
        if (confirm('Sicuro di voler rimuovere la API key salvata?')) {
          setApiKey(''); document.getElementById('apikey').value = '';
          toast('info', 'API key rimossa.');
        }
      }}, 'Rimuovi')
    ]),
    h('hr', {}),
    h('h2', {}, 'Informazioni'),
    h('p', { class: 'muted' }, 'Adattatore atteso: ELM327 su Bluetooth Low Energy (BLE) — es. Vgate iCar Pro Bluetooth 4.0. Il browser deve essere Chrome o Edge desktop.'),
    h('p', { class: 'muted' }, 'In MODALITÀ DEMO non serve né adattatore né chiave OpenAI (le spiegazioni sono precompilate).')
  ]);
}

// ---------- Render principale ------------------------------------------------
function render() {
  $app.innerHTML = '';
  $app.appendChild(renderHeader());
  $app.appendChild(renderTabs());

  if (state.toast) {
    $app.appendChild(h('div', { class: `callout ${state.toast.type}` }, state.toast.msg));
  }

  let screen;
  switch (state.screen) {
    case 'dtc':          screen = screenDtc(); break;
    case 'live':         screen = screenLive(); break;
    case 'impostazioni': screen = screenImpostazioni(); break;
    case 'connessione':
    default:             screen = screenConnessione(); break;
  }
  $app.appendChild(screen);
}

// Primo render
render();

// Cleanup: se l'utente cambia scheda e stava leggendo live, fermiamo il polling
window.addEventListener('beforeunload', () => {
  try { state.client?.disconnect(); } catch { /* ignore */ }
});
