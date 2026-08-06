// -----------------------------------------------------------------------------
// MODALITÀ DEMO — simula l'adattatore ELM327 e i dati OBD-II con valori
// realistici, per poter provare la UI senza avere l'auto o l'adattatore.
// -----------------------------------------------------------------------------

// Codici DTC di demo (uno "grave", uno "medio", uno "leggero")
export const DEMO_DTCS = ['P0301', 'P0420', 'P0442'];

// Ritorna un oggetto "connessione fake" con la stessa API del client BLE:
// initElm(), sendCommand(), disconnect(), isConnected(), ecc.
export function createDemoClient({ onLog } = {}) {
  let connected = true;
  let rpm = 850;
  let speed = 0;
  let coolant = 45; // temperatura salirà simulando il motore acceso

  const log = (m) => { onLog && onLog(m); console.log('[DEMO]', m); };

  // Simula la salita graduale della temperatura e piccole oscillazioni
  setInterval(() => {
    if (coolant < 90) coolant += 1;
    rpm = 800 + Math.round(Math.sin(Date.now() / 800) * 60);
  }, 1500);

  return {
    isDemo: true,
    isConnected: () => connected,
    onLog: log,
    async initElm() {
      log('DEMO: init ELM327 (finto)...');
      await wait(400);
      return [
        { cmd: 'ATZ', resp: 'ELM327 v1.5 (DEMO)' },
        { cmd: 'ATE0', resp: 'OK' },
        { cmd: 'ATL0', resp: 'OK' },
        { cmd: 'ATSP0', resp: 'OK' }
      ];
    },
    async disconnect() { connected = false; log('DEMO: disconnesso'); },

    // Comandi OBD: intercettiamo i più comuni e ritorniamo risposte ELM327 finte
    async sendCommand(cmd /*, opts */) {
      await wait(120 + Math.random() * 120);
      const c = cmd.toUpperCase().replace(/\s+/g, '');
      if (c === '03') {
        // Costruiamo una risposta CAN-style: "43 03 03 01 04 20 04 42"
        // 43 = mode+40, 03 = numero DTC, poi coppie di byte codificati
        const bytesPairs = DEMO_DTCS.map(encodeDtcToBytes).join('');
        return `43 03 ${formatBytes(bytesPairs)}`.trim();
      }
      if (c === '04') return '44';
      if (c === '010C') {
        // giri: (A*256+B)/4 = rpm  →  raw = rpm*4
        const raw = rpm * 4;
        const A = (raw >> 8) & 0xFF, B = raw & 0xFF;
        return `41 0C ${hex(A)} ${hex(B)}`;
      }
      if (c === '010D') {
        return `41 0D ${hex(speed)}`;
      }
      if (c === '0105') {
        return `41 05 ${hex(coolant + 40)}`;
      }
      if (c === '012F') {
        return `41 2F ${hex(Math.round(0.75 * 255))}`;
      }
      // Comandi AT ignorati → OK
      if (c.startsWith('AT')) return 'OK';
      return 'NO DATA';
    }
  };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function hex(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }

// Trasforma "P0301" in "03 01" (due byte). Vedi decodeDtc in obd.js per il
// meccanismo inverso. Qui rifacciamo l'inverso:
function encodeDtcToBytes(code) {
  const systems = { P: 0b00, C: 0b01, B: 0b10, U: 0b11 };
  const sys = systems[code[0]] << 6;
  const first = parseInt(code[1], 16) << 4;
  const second = parseInt(code[2], 16);
  const third = parseInt(code[3], 16) << 4;
  const fourth = parseInt(code[4], 16);
  const b1 = sys | first | second;
  const b2 = third | fourth;
  return hex(b1) + hex(b2);
}
function formatBytes(hexstr) {
  return hexstr.match(/.{2}/g).join(' ');
}

// Interpretazione GPT finta (usata quando la API key non è impostata e siamo in demo)
export function fakeInterpretazione(code) {
  const map = {
    P0301: {
      significato: "Un cilindro del motore ogni tanto non si accende bene.",
      causa_probabile: "Molto spesso è colpa di una candela o di una bobina che sta invecchiando.",
      posso_guidare: "sì ma con cautela",
      perche_guida: "Puoi andare piano fino al meccanico, ma non tirare il motore.",
      urgenza: "media",
      costo_indicativo_eur: "50-200 €",
      cosa_fare: "1) Non tirare il motore. 2) Vai dal meccanico entro pochi giorni. 3) Fai controllare candele e bobine."
    },
    P0420: {
      significato: "Il filtro dei gas di scarico (marmitta catalitica) sta perdendo colpi.",
      causa_probabile: "Il catalizzatore è vecchio o intasato, oppure una sonda non legge più bene.",
      posso_guidare: "sì",
      perche_guida: "Non è un pericolo immediato, ma non aspettare troppo per farlo controllare.",
      urgenza: "media",
      costo_indicativo_eur: "150-800 €",
      cosa_fare: "1) Porta l'auto dal meccanico nelle prossime settimane. 2) Fai controllare le sonde di scarico. 3) Chiedi un preventivo prima di sostituire il catalizzatore."
    },
    P0442: {
      significato: "Piccola perdita nel sistema che raccoglie i vapori della benzina.",
      causa_probabile: "Spesso basta il tappo del serbatoio non chiuso bene o rovinato.",
      posso_guidare: "sì",
      perche_guida: "Non tocca la guida, è solo un problema di emissioni.",
      urgenza: "bassa",
      costo_indicativo_eur: "10-100 €",
      cosa_fare: "1) Controlla che il tappo del serbatoio sia chiuso bene. 2) Se persiste, sostituisci il tappo. 3) Se rimane, chiedi al meccanico di controllare i tubetti dei vapori."
    }
  };
  return map[code] || {
    significato: "Anomalia rilevata dalla centralina.",
    causa_probabile: "Non conosco questo codice nel dettaglio, meglio farlo controllare.",
    posso_guidare: "sì ma con cautela",
    perche_guida: "Senza sapere cos'è, meglio non affaticare il motore.",
    urgenza: "media",
    costo_indicativo_eur: "da valutare",
    cosa_fare: "1) Evita lunghi viaggi. 2) Prenota un controllo. 3) Riprova a leggere i codici tra qualche giorno."
  };
}
