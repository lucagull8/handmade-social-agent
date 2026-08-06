# Diagnosi Auto — PWA OBD2 (italiano)

PWA leggera in italiano per leggere e interpretare gli errori del motore
tramite un adattatore **OBD-II Bluetooth Low Energy** (testata con **Vgate
iCar Pro Bluetooth 4.0**).

L'app è pensata per essere aperta su **Chrome desktop** (Windows 11) via
`http://localhost:5173`, che è un contesto sicuro e abilita **Web Bluetooth**
senza bisogno di HTTPS.

- Lettura codici errore (mode 03)
- Spegnimento spia motore / cancellazione codici (mode 04) con conferma
- Parametri live (giri motore, velocità, temperatura liquido)
- Interpretazione dei codici in **italiano semplice** tramite GPT-4 (OpenAI)
- **Modalità DEMO** per provare la UI senza adattatore né API key

---

## 1. Avvio rapido

Serve solo Node.js 18+.

```bash
cd pwa-obd2
npm install
npm run dev
```

Poi apri **Chrome desktop** su:

```
http://localhost:5173
```

> ⚠️ **Firefox non supporta Web Bluetooth.** Usa Chrome o Edge desktop.

## 2. Provare subito la MODALITÀ DEMO

1. Apri l'app in Chrome su `http://localhost:5173`.
2. Nella scheda **Connessione**, premi **"Avvia modalità DEMO"**.
3. Vai su **Codici errore** → **Leggi codici**. Verranno mostrati 3 DTC
   realistici (P0301, P0420, P0442) con spiegazioni precompilate.
4. Vai su **Dati live** → **Avvia lettura**. I valori sono simulati.

In DEMO non serve né API key né adattatore.

## 3. Inserire la API key di OpenAI

Serve solo se vuoi le spiegazioni dei DTC generate dall'AI (fuori dalla DEMO,
o in DEMO se vuoi vedere risposte "vere").

1. Crea una chiave su <https://platform.openai.com/api-keys> (formato `sk-...`).
2. Nell'app apri la scheda **Impostazioni**.
3. Incolla la chiave nel campo **API key OpenAI** e premi **Salva**.
4. La chiave viene salvata **solo nel tuo browser** (`localStorage`), non
   viene mai messa nel codice né inviata a servizi diversi da OpenAI.

Modello usato di default: `gpt-4o-mini` (cambia il valore in
`src/config.js` → `OPENAI_CONFIG.model` se vuoi un altro).

## 4. Uso reale in auto (PC portatile vicino alla vettura)

1. Su Windows 11 controlla che il **Bluetooth sia acceso** (Impostazioni →
   Bluetooth e dispositivi). Non serve accoppiare l'adattatore Vgate dalle
   impostazioni di Windows: fa tutto la pagina web.
2. **Non chiudere** il terminale con `npm run dev` in esecuzione. Il PC deve
   restare acceso e connesso al server locale.
3. Vai in auto col portatile. Inserisci l'adattatore **Vgate iCar Pro** nella
   presa **OBD-II** (di solito sotto il volante, lato guida).
4. Gira la chiave su **MAR** senza avviare il motore. Il led
   dell'adattatore si accende.
5. Apri Chrome su `http://localhost:5173`, scheda **Connessione**, premi
   **"Cerca adattatore e connetti"**. Nella finestra di Chrome scegli il tuo
   Vgate iCar Pro. Attendi il messaggio *"Adattatore pronto!"*.
6. Vai su **Codici errore** → **Leggi codici**. Poi premi *"Spiegami con AI"*
   sotto ciascun codice per la spiegazione in italiano semplice.
7. Per i **parametri live** (giri, velocità, temperatura) devi **avviare il
   motore**: a chiave su MAR senza motore restano a zero.
8. Per **spegnere la spia motore** usa **"Spegni spia (cancella)"**. Se il
   guasto è ancora presente, la spia si riaccenderà dopo qualche minuto.

## 5. Struttura del progetto

```
pwa-obd2/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   ├── manifest.webmanifest
│   ├── service-worker.js
│   └── icons/icon.svg
└── src/
    ├── main.js       # UI + orchestrazione stato
    ├── styles.css
    ├── config.js     # ⚙️ UUID BLE e config ELM327 (modificabili)
    ├── ble.js        # Web Bluetooth + protocollo ELM327 (con buffer prompt)
    ├── obd.js        # Parser OBD-II (mode 01/03/04)
    ├── dtc.js        # Dizionario descrizioni brevi DTC
    ├── openai.js     # Chiamata GPT-4 in italiano semplice
    └── demo.js       # Client fake per MODALITÀ DEMO
```

## 6. Personalizzazione dell'adattatore

Se hai un adattatore ELM327 BLE diverso dal Vgate, modifica solo
`src/config.js`:

```js
export const BLE_CONFIG = {
  primaryService:       '0000fff0-0000-1000-8000-00805f9b34fb',
  notifyCharacteristic: '0000fff1-0000-1000-8000-00805f9b34fb',
  writeCharacteristic:  '0000fff2-0000-1000-8000-00805f9b34fb',
  ...
};
```

Servizi alternativi comuni:
- `0000fff0` + `fff1/fff2` (Vgate iCar Pro, cloni economici) — default
- `000018f0` + `2af0/2af1` (alcuni cloni recenti)
- `0000ffe0` + `ffe1` (alcuni ELM327 marcati "V-Link")

## 7. Problemi comuni

| Sintomo | Cosa fare |
|---|---|
| "Il browser non supporta Web Bluetooth" | Usa **Chrome** o **Edge** desktop, non Firefox. |
| Nessun device nel picker Chrome | Verifica che il Bluetooth di Windows sia acceso; che l'adattatore sia inserito nella presa OBD e la chiave su MAR; il led dell'adattatore deve lampeggiare/accendersi. |
| "Timeout attesa risposta per ATZ" | L'adattatore risponde lentamente al reset: premi di nuovo *Connetti*. Se persiste, prova a scollegare fisicamente l'adattatore per 10 secondi. |
| "NO DATA" | La centralina non risponde: la chiave deve essere almeno su MAR; per i parametri live serve motore avviato. |
| Bluetooth spento | L'app te lo dice, va acceso dalle Impostazioni di Windows. |
| Certificato / HTTPS | Non serve HTTPS in locale: `http://localhost` e `http://127.0.0.1` sono contesti sicuri per Web Bluetooth. |

## 8. Note tecniche

- **Web Bluetooth** funziona su Chromium desktop (Chrome/Edge/Opera/Brave)
  e su Android Chrome. **Non funziona** su Firefox né su iOS.
- I comandi ELM327 terminano con `\r` e le risposte terminano con il prompt
  `>`. Il modulo `ble.js` bufferizza le notify BLE fino a quel prompt.
- La sequenza di init è: `ATZ` (reset), `ATE0` (echo off), `ATL0` (LF off),
  `ATSP0` (protocollo automatico).
- Il parser DTC copre sia risposte CAN (con byte "numero di DTC") sia
  varianti non-CAN, saltando padding `0000`.

## 9. Non incluso (fase successiva)

- Azzeramento tagliando (dipende dal costruttore, non è OBD-II standard)
- Database veicoli specifici (OBD-II è già standard)
