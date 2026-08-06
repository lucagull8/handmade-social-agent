// -----------------------------------------------------------------------------
// Configurazione BLE per l'adattatore ELM327 (Vgate iCar Pro BT 4.0 e cloni).
// Modifica qui gli UUID se usi un adattatore diverso.
//
// Formato UUID BLE "16-bit" espansi al pattern base 128-bit:
//   0000XXXX-0000-1000-8000-00805f9b34fb
//
// La maggior parte dei cloni ELM327 BLE cinesi (Vgate, VEEPEAK BLE+, VLINKER,
// generici) espongono il servizio 0xFFF0 con:
//   - 0xFFF1  → notify   (dati in ingresso dall'ELM327)
//   - 0xFFF2  → write    (comandi verso l'ELM327)
//
// Alcuni cloni usano invece 0x18F0 / 0x2AF0-2AF1. Se il tuo dongle usa quelli,
// aggiungi il servizio a ALT_SERVICES e adatta i writeChar/notifyChar.
// -----------------------------------------------------------------------------

export const BLE_CONFIG = {
  // Servizio principale (16-bit 0xFFF0 espanso)
  primaryService: '0000fff0-0000-1000-8000-00805f9b34fb',

  // Caratteristica per RICEVERE dati dall'ELM327 (notify)
  notifyCharacteristic: '0000fff1-0000-1000-8000-00805f9b34fb',

  // Caratteristica per INVIARE comandi all'ELM327 (write)
  writeCharacteristic: '0000fff2-0000-1000-8000-00805f9b34fb',

  // Servizi alternativi da dichiarare nel filtro di richiesta device
  // (aiuta Chrome a mostrare anche adattatori che non pubblicizzano 0xFFF0)
  alternativeServices: [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb'
  ],

  // Prefissi nome tipici degli adattatori (per il filtro di richiesta)
  namePrefixes: [
    'IOS-Vlink',
    'VLink',
    'Vgate',
    'iCar',
    'OBDII',
    'OBD',
    'OBDBLE',
    'V-LINK',
    'ELM327',
    'V-Gate'
  ]
};

// -----------------------------------------------------------------------------
// Configurazione protocollo ELM327
// -----------------------------------------------------------------------------
export const ELM_CONFIG = {
  // Terminatore di ogni comando ELM327
  lineTerminator: '\r',

  // Prompt che segnala "risposta completa, ELM327 pronto per il prossimo comando"
  prompt: '>',

  // Timeout per una singola risposta (ms). Alcuni comandi (ATZ) sono lenti.
  responseTimeoutMs: 5000,

  // Attesa tra un comando e l'altro nella sequenza di init (ms)
  initDelayMs: 250,

  // Sequenza di inizializzazione dopo la connessione.
  // ATZ  = reset dell'adattatore
  // ATE0 = disattiva echo (le risposte non ripetono il comando)
  // ATL0 = disattiva line feed (usiamo solo \r come separatore)
  // ATSP0= protocollo automatico (l'ELM sceglie da solo tra CAN, ISO, KWP...)
  initSequence: ['ATZ', 'ATE0', 'ATL0', 'ATSP0']
};

// -----------------------------------------------------------------------------
// Configurazione OpenAI
// -----------------------------------------------------------------------------
export const OPENAI_CONFIG = {
  // Modello usato per l'interpretazione dei codici DTC
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  // Chiave localStorage in cui viene salvata l'API key
  apiKeyStorageKey: 'obd2_openai_api_key'
};
