// -----------------------------------------------------------------------------
// Modulo BLE — gestisce connessione Web Bluetooth verso l'ELM327 e
// implementa la comunicazione a "linee" con prompt '>'.
//
// Flusso:
//   1. requestDevice() → l'utente sceglie l'adattatore nel picker Chrome
//   2. gatt.connect() → apre la connessione GATT
//   3. troviamo il servizio 0xFFF0 e le due caratteristiche fff1/fff2
//   4. abilitiamo le notifiche su fff1 e iniziamo a bufferizzare i byte
//   5. sendCommand("ATZ") scrive "ATZ\r" e ritorna una Promise che si risolve
//      quando arriva il prompt '>' (oppure va in timeout)
// -----------------------------------------------------------------------------

import { BLE_CONFIG, ELM_CONFIG } from './config.js';

export class ElmBleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.writeChar = null;
    this.notifyChar = null;

    // Buffer di testo accumulato dalle notify (finché non arriva '>')
    this._buffer = '';
    // Coda dei comandi in attesa di risposta { resolve, reject, timeoutId }
    this._pending = null;

    // Codificatore/decoder per convertire stringhe <-> byte BLE
    this._encoder = new TextEncoder();
    this._decoder = new TextDecoder();

    // Callback di notifica esterna (log console UI, disconnessione, ...)
    this.onLog = null;
    this.onDisconnect = null;
  }

  // Verifica supporto Web Bluetooth (Chrome/Edge desktop lo hanno; Firefox no)
  static isSupported() {
    return typeof navigator !== 'undefined'
      && !!navigator.bluetooth
      && typeof navigator.bluetooth.requestDevice === 'function';
  }

  // Verifica che il Bluetooth sia disponibile (adattatore attivo).
  // Nota: getAvailability() torna false anche se l'utente ha bloccato il
  // permesso a livello di sistema.
  static async isBluetoothAvailable() {
    try {
      if (!navigator.bluetooth || !navigator.bluetooth.getAvailability) return true;
      return await navigator.bluetooth.getAvailability();
    } catch {
      return false;
    }
  }

  _log(...args) {
    if (this.onLog) this.onLog(args.join(' '));
    // Utile in fase di debug diretto dalla console DevTools di Chrome
    console.log('[BLE]', ...args);
  }

  // Apre il picker Chrome per scegliere l'adattatore ELM327.
  // Nota importante: i filtri servono sia a mostrare solo device compatibili,
  // sia a dichiarare i servizi che vogliamo usare (altrimenti getPrimaryService
  // fallirebbe con "SecurityError").
  async requestDevice() {
    if (!ElmBleClient.isSupported()) {
      throw new Error('Il browser non supporta Web Bluetooth. Usa Chrome o Edge su Windows/Mac/Linux Desktop.');
    }
    const available = await ElmBleClient.isBluetoothAvailable();
    if (!available) {
      throw new Error('Il Bluetooth del PC sembra spento o non disponibile. Attivalo dalle impostazioni di Windows e riprova.');
    }

    // Filtro: nomi tipici degli adattatori + servizio principale.
    // "optionalServices" dichiara TUTTI i servizi che poi useremo.
    const filters = BLE_CONFIG.namePrefixes.map(prefix => ({ namePrefix: prefix }));
    // Includiamo anche il filtro per servizio (alcuni dongle non hanno nome)
    filters.push({ services: [BLE_CONFIG.primaryService] });

    this.device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [
        BLE_CONFIG.primaryService,
        ...BLE_CONFIG.alternativeServices
      ]
    });

    this._log(`Device scelto: ${this.device.name || '(senza nome)'} — ${this.device.id}`);
    this.device.addEventListener('gattserverdisconnected', () => this._handleDisconnect());
    return this.device;
  }

  async connect() {
    if (!this.device) throw new Error('Nessun dispositivo selezionato. Premi prima "Cerca adattatore".');

    this._log('Apertura connessione GATT...');
    this.server = await this.device.gatt.connect();

    this._log('Ricerca servizio primario...');
    this.service = await this.server.getPrimaryService(BLE_CONFIG.primaryService);

    this._log('Ricerca caratteristiche fff1 (notify) e fff2 (write)...');
    this.notifyChar = await this.service.getCharacteristic(BLE_CONFIG.notifyCharacteristic);
    this.writeChar = await this.service.getCharacteristic(BLE_CONFIG.writeCharacteristic);

    // Abilita le notify e collega il gestore di ricezione
    this.notifyChar.addEventListener('characteristicvaluechanged',
      (event) => this._handleIncoming(event.target.value));
    await this.notifyChar.startNotifications();

    this._log('Connessione BLE stabilita.');
  }

  isConnected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  async disconnect() {
    try {
      if (this.notifyChar) {
        try { await this.notifyChar.stopNotifications(); } catch { /* ignore */ }
      }
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
    } finally {
      this._resetPending(new Error('Disconnesso'));
      this._buffer = '';
      this.service = null;
      this.writeChar = null;
      this.notifyChar = null;
      this.server = null;
    }
  }

  _handleDisconnect() {
    this._log('Adattatore disconnesso.');
    this._resetPending(new Error('Adattatore disconnesso durante la comunicazione'));
    if (this.onDisconnect) this.onDisconnect();
  }

  _resetPending(err) {
    if (this._pending) {
      clearTimeout(this._pending.timeoutId);
      this._pending.reject(err);
      this._pending = null;
    }
  }

  // Riceviamo i byte dalla caratteristica di notify. L'ELM327 spedisce
  // ASCII terminato dal prompt '>'. Accumuliamo in _buffer finché non lo
  // vediamo, poi risolviamo la Promise del comando in corso.
  _handleIncoming(dataView) {
    const chunk = this._decoder.decode(dataView);
    this._buffer += chunk;

    // Alcuni ELM327 mandano ' >' o '\r>' — normalizziamo
    if (this._buffer.includes(ELM_CONFIG.prompt)) {
      const raw = this._buffer;
      this._buffer = '';
      const cleaned = this._cleanResponse(raw);
      if (this._pending) {
        clearTimeout(this._pending.timeoutId);
        const { resolve } = this._pending;
        this._pending = null;
        resolve(cleaned);
      } else {
        this._log('Risposta ricevuta senza comando in attesa:', cleaned);
      }
    }
  }

  // Pulisce la risposta grezza dell'ELM327:
  //  - rimuove eventuale eco del comando (in caso ATE0 non abbia ancora fatto effetto)
  //  - rimuove il prompt finale '>'
  //  - normalizza CR/LF -> singoli newline
  //  - collassa spazi multipli
  _cleanResponse(raw) {
    let s = raw.replace(/\r/g, '\n').replace(/\n+/g, '\n');
    s = s.replace(/>\s*$/, '');
    return s.trim();
  }

  // Invia un comando ELM327 e attende la risposta completa (fino al prompt '>').
  // I chunk BLE massimi sono 20 byte su alcuni stack Windows: per i comandi
  // AT/OBD (max ~10 caratteri) siamo sempre nel limite.
  async sendCommand(cmd, { timeoutMs } = {}) {
    if (!this.writeChar) throw new Error('Non connesso all\'adattatore.');
    if (this._pending) {
      throw new Error('Comunicazione in corso, attendere...');
    }

    const timeout = timeoutMs || ELM_CONFIG.responseTimeoutMs;
    const payload = this._encoder.encode(cmd + ELM_CONFIG.lineTerminator);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pending = null;
        this._buffer = '';
        reject(new Error(`Timeout attesa risposta per "${cmd}"`));
      }, timeout);

      this._pending = { resolve, reject, timeoutId, cmd };

      // writeValueWithoutResponse è più veloce ma non sempre supportato;
      // ricadiamo su writeValue se necessario.
      const writeOp = this.writeChar.writeValueWithoutResponse
        ? this.writeChar.writeValueWithoutResponse(payload)
        : this.writeChar.writeValue(payload);

      writeOp.catch(err => {
        clearTimeout(timeoutId);
        this._pending = null;
        reject(err);
      });
    });
  }

  // Esegue la sequenza di init ELM327 (ATZ, ATE0, ATL0, ATSP0)
  async initElm() {
    const responses = [];
    for (const cmd of ELM_CONFIG.initSequence) {
      this._log(`INIT → ${cmd}`);
      try {
        const resp = await this.sendCommand(cmd, { timeoutMs: 6000 });
        this._log(`INIT ← ${resp.replace(/\n/g, ' | ')}`);
        responses.push({ cmd, resp });
      } catch (err) {
        this._log(`INIT errore su ${cmd}: ${err.message}`);
        throw new Error(`Init ELM327 fallito al comando ${cmd}: ${err.message}`);
      }
      // Attesa breve tra un AT e l'altro (soprattutto dopo ATZ)
      await new Promise(r => setTimeout(r, ELM_CONFIG.initDelayMs));
    }
    return responses;
  }
}
