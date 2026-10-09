// -----------------------------------------------------------------------------
// Modulo OBD-II — costruisce i comandi PID e parsa le risposte esadecimali
// dell'ELM327.
//
// Struttura di una risposta ELM327 (modalità 01, PID 0C = giri motore):
//   Comando : "010C\r"
//   Risposta: "41 0C 1A F8\r>"
//
//   - "41" = 0x40 + modalità richiesta (01 → 41)
//   - "0C" = PID richiesto
//   - "1A F8" = due byte di dati → giri = ((A*256)+B)/4 = (0x1A*256+0xF8)/4 = 1726 rpm
//
// Le risposte possono contenere più righe (multi-frame) o header CAN se ATH1
// è attivo; noi disabilitiamo l'echo e assumiamo protocollo automatico.
// -----------------------------------------------------------------------------

// Rimuove spazi, righe multiple e messaggi di stato ELM327 dalla risposta.
// Ritorna solo la porzione utile in esadecimale come stringa unica di byte.
function extractHexBytes(raw, mode, pid) {
  const modeReplyPrefix = (0x40 + parseInt(mode, 16)).toString(16).padStart(2, '0').toUpperCase();
  const pidHex = pid ? pid.toUpperCase() : null;

  // Uniamo tutte le righe rimuovendo spazi
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  // Gestione errori tipici dell'ELM327
  for (const l of lines) {
    const u = l.toUpperCase();
    if (u.includes('NO DATA')) throw new Error('NO_DATA');
    if (u.includes('UNABLE TO CONNECT')) throw new Error('UNABLE_TO_CONNECT');
    if (u.includes('CAN ERROR')) throw new Error('CAN_ERROR');
    if (u.includes('BUS INIT') && u.includes('ERROR')) throw new Error('BUS_INIT_ERROR');
    if (u.startsWith('?')) throw new Error('BAD_COMMAND');
    if (u.includes('STOPPED')) throw new Error('STOPPED');
    if (u.includes('SEARCHING')) continue; // ignoralo, riga informativa
  }

  // Cerca la riga che contiene la risposta corretta (es. "41 0C ...")
  for (const line of lines) {
    const compact = line.replace(/\s+/g, '').toUpperCase();
    const startIdx = compact.indexOf(modeReplyPrefix + (pidHex || ''));
    if (startIdx !== -1) {
      const dataStart = startIdx + modeReplyPrefix.length + (pidHex ? pidHex.length : 0);
      return compact.slice(dataStart);
    }
  }
  // Nessuna corrispondenza: torniamo la concatenazione grezza per parsing custom (modo 03)
  return lines.join('').replace(/\s+/g, '').toUpperCase();
}

// -----------------------------------------------------------------------------
// Modo 01 — parametri live
// -----------------------------------------------------------------------------

// PID 0x0C — giri motore: ((A*256)+B)/4
export function parseRpm(raw) {
  const bytes = extractHexBytes(raw, '01', '0C');
  if (bytes.length < 4) throw new Error('Risposta RPM troppo corta');
  const A = parseInt(bytes.substr(0, 2), 16);
  const B = parseInt(bytes.substr(2, 2), 16);
  return Math.round(((A * 256) + B) / 4);
}

// PID 0x0D — velocità: A (km/h)
export function parseSpeed(raw) {
  const bytes = extractHexBytes(raw, '01', '0D');
  if (bytes.length < 2) throw new Error('Risposta velocità troppo corta');
  return parseInt(bytes.substr(0, 2), 16);
}

// PID 0x05 — temperatura liquido refrigerante: A - 40 (°C)
export function parseCoolantTemp(raw) {
  const bytes = extractHexBytes(raw, '01', '05');
  if (bytes.length < 2) throw new Error('Risposta temperatura troppo corta');
  return parseInt(bytes.substr(0, 2), 16) - 40;
}

// PID 0x2F — livello carburante: A * 100 / 255 (%)
export function parseFuelLevel(raw) {
  const bytes = extractHexBytes(raw, '01', '2F');
  if (bytes.length < 2) throw new Error('Risposta livello carburante troppo corta');
  return Math.round((parseInt(bytes.substr(0, 2), 16) * 100) / 255);
}

// Comandi modo 01
export const MODE01 = {
  rpm:         { cmd: '010C', parse: parseRpm },
  speed:       { cmd: '010D', parse: parseSpeed },
  coolantTemp: { cmd: '0105', parse: parseCoolantTemp },
  fuelLevel:   { cmd: '012F', parse: parseFuelLevel }
};

// -----------------------------------------------------------------------------
// Modo 03 — lettura DTC memorizzati
// -----------------------------------------------------------------------------

// Converte due byte in un codice DTC standard (es. "0301" → "P0301").
// Il primo NIBBLE codifica il sistema:
//   00 → P0..., 01 → P1..., 10 → P2..., 11 → P3...
//   00 → C0..., 01 → C1..., 10 → C2..., 11 → C3...   (C = 01)
//   00 → B0..., 01 → B1..., 10 → B2..., 11 → B3...   (B = 10)
//   00 → U0..., 01 → U1..., 10 → U2..., 11 → U3...   (U = 11)
export function decodeDtc(byte1, byte2) {
  const b1 = parseInt(byte1, 16);
  const b2 = parseInt(byte2, 16);
  const systems = ['P', 'C', 'B', 'U'];
  const system = systems[(b1 & 0xC0) >> 6];
  const firstDigit = (b1 & 0x30) >> 4;
  const rest =
    (b1 & 0x0F).toString(16) +
    ((b2 & 0xF0) >> 4).toString(16) +
    (b2 & 0x0F).toString(16);
  return (system + firstDigit + rest).toUpperCase();
}

// Parsa una risposta a comandi di lettura DTC (mode 03/07/0A).
// Struttura tipica CAN: "<MR> <N> P1 P2 P3 P4 P5 P6"  dove:
//   - "<MR>" = mode reply (0x40 + mode: 43 per 03, 47 per 07, 4A per 0A)
//     GIA' RIMOSSO da extractHexBytes()
//   - "<N>"  = numero di DTC (solo sui protocolli CAN)
//   - poi coppie di 2 byte, una per DTC, eventualmente terminate da "0000"
// Il parametro `mode` serve a dire a extractHexBytes quale prefisso togliere.
export function parseDtcResponse(raw, mode = '03') {
  const bytes = extractHexBytes(raw, mode, null);
  if (!bytes || bytes.length < 2) return [];

  let cursor = 0;

  // Se il primo byte residuo puo' plausibilmente essere il "conteggio DTC"
  // atteso in CAN (valore <= 20 e coerente con lo spazio rimanente), lo saltiamo.
  const maybeCount = parseInt(bytes.substr(cursor, 2), 16);
  const remainingDtcSlots = (bytes.length - cursor - 2) / 4;
  if (!Number.isNaN(maybeCount) && maybeCount <= 20 && maybeCount <= remainingDtcSlots) {
    cursor += 2;
  }

  const codes = [];
  while (cursor + 4 <= bytes.length) {
    const b1 = bytes.substr(cursor, 2);
    const b2 = bytes.substr(cursor + 2, 2);
    if (b1 === '00' && b2 === '00') break; // padding: fine dei DTC
    codes.push(decodeDtc(b1, b2));
    cursor += 4;
  }
  return codes;
}

// -----------------------------------------------------------------------------
// Modo 04 — cancellazione DTC / spegnimento spia motore
// -----------------------------------------------------------------------------
// Basta inviare "04" e attendere "44" o un OK dell'ELM327.
export function parseClearResponse(raw) {
  const u = raw.toUpperCase();
  if (u.includes('44')) return true;
  if (u.includes('NO DATA')) throw new Error('NO_DATA');
  return true; // molti ELM rispondono solo con prompt
}
