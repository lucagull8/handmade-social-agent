// -----------------------------------------------------------------------------
// Piccolo dizionario di descrizioni brevi per i DTC più comuni.
// Serve solo come fallback: la spiegazione "umana" completa arriva da GPT.
// Non è esaustivo — OBD-II ne definisce migliaia. Se il codice non è qui,
// mostriamo comunque "Codice generico OBD-II" e ci affidiamo all'AI.
// -----------------------------------------------------------------------------

const DTC_BASE = {
  // --- Powertrain – misture aria/carburante ---
  P0100: 'Sensore flusso aria (MAF) — segnale anomalo',
  P0101: 'Sensore flusso aria (MAF) — valore fuori range',
  P0102: 'Sensore flusso aria (MAF) — segnale troppo basso',
  P0103: 'Sensore flusso aria (MAF) — segnale troppo alto',
  P0106: 'Sensore pressione aria (MAP) — valore anomalo',
  P0113: 'Sensore temperatura aria aspirata — segnale alto',
  P0117: 'Sensore temperatura refrigerante — segnale basso',
  P0118: 'Sensore temperatura refrigerante — segnale alto',
  P0128: 'Motore non raggiunge la temperatura di esercizio (termostato)',
  P0130: 'Sonda lambda 1 (banco 1) — anomalia segnale',
  P0131: 'Sonda lambda 1 (banco 1) — tensione bassa',
  P0132: 'Sonda lambda 1 (banco 1) — tensione alta',
  P0133: 'Sonda lambda 1 (banco 1) — risposta lenta',
  P0134: 'Sonda lambda 1 (banco 1) — nessuna attività',
  P0135: 'Riscaldatore sonda lambda 1 (banco 1) — guasto',
  P0136: 'Sonda lambda 2 (banco 1) — anomalia segnale',
  P0141: 'Riscaldatore sonda lambda 2 (banco 1) — guasto',
  P0171: 'Miscela troppo magra (banco 1) — poca benzina o troppa aria',
  P0172: 'Miscela troppo ricca (banco 1) — troppa benzina',
  P0174: 'Miscela troppo magra (banco 2)',
  P0175: 'Miscela troppo ricca (banco 2)',

  // --- Accensione / mancate accensioni (misfire) ---
  P0300: 'Mancata accensione casuale in più cilindri',
  P0301: 'Mancata accensione — cilindro 1',
  P0302: 'Mancata accensione — cilindro 2',
  P0303: 'Mancata accensione — cilindro 3',
  P0304: 'Mancata accensione — cilindro 4',
  P0305: 'Mancata accensione — cilindro 5',
  P0306: 'Mancata accensione — cilindro 6',

  // --- Catalizzatore / EGR / evaporativi ---
  P0401: 'Sistema EGR — flusso insufficiente',
  P0402: 'Sistema EGR — flusso eccessivo',
  P0420: 'Efficienza catalizzatore sotto soglia (banco 1)',
  P0430: 'Efficienza catalizzatore sotto soglia (banco 2)',
  P0442: 'Piccola perdita nel circuito vapori benzina (evap.)',
  P0455: 'Grossa perdita nel circuito vapori benzina (tappo carburante?)',
  P0456: 'Piccolissima perdita nel circuito vapori benzina',

  // --- Iniezione / alimentazione ---
  P0201: 'Iniettore cilindro 1 — circuito guasto',
  P0202: 'Iniettore cilindro 2 — circuito guasto',
  P0203: 'Iniettore cilindro 3 — circuito guasto',
  P0204: 'Iniettore cilindro 4 — circuito guasto',
  P0087: 'Pressione rampa carburante — troppo bassa',
  P0088: 'Pressione rampa carburante — troppo alta',

  // --- Farfalla / attuatori ---
  P0121: 'Sensore posizione farfalla — segnale anomalo',
  P0122: 'Sensore posizione farfalla — segnale basso',
  P0123: 'Sensore posizione farfalla — segnale alto',
  P2135: 'Sensori posizione farfalla — segnali incoerenti',

  // --- Turbo / diesel ---
  P0234: 'Turbo — sovrappressione',
  P0299: 'Turbo — sottopressione',
  P2002: 'Filtro antiparticolato (FAP/DPF) — efficienza scarsa',

  // --- Rete di bordo (U) ---
  U0100: 'Persa comunicazione con la centralina motore (ECU)',
  U0101: 'Persa comunicazione con la centralina del cambio',

  // --- Chassis (C) esempi ---
  C0035: 'Sensore velocità ruota anteriore sinistra — anomalia',
  C0040: 'Sensore velocità ruota anteriore destra — anomalia',

  // --- Body (B) esempi ---
  B0001: 'Airbag lato guida — anomalia'
};

// Ritorna descrizione breve; se sconosciuto, dà una descrizione generica
// basata sul prefisso del codice.
export function describeDtc(code) {
  if (!code) return '';
  const known = DTC_BASE[code.toUpperCase()];
  if (known) return known;
  const prefix = code[0].toUpperCase();
  const family = { P: 'Powertrain (motore/cambio)', C: 'Chassis (ABS/sospensioni)', B: 'Body (abitacolo/airbag)', U: 'Rete di bordo (comunicazione centraline)' }[prefix] || 'Generico';
  return `Codice ${family} — descrizione non nel dizionario locale, chiedo all'assistente AI.`;
}
