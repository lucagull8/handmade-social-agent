// -----------------------------------------------------------------------------
// Chiamata a OpenAI per interpretare i codici DTC in italiano semplice.
//
// Priorità di lettura della API key:
//   1. localStorage (impostata dall'utente in Impostazioni)
//   2. Variabile d'ambiente VITE_OPENAI_API_KEY (da .env.local)
//
// Il file .env.local è già in .gitignore: la chiave NON viene mai
// committata nel repo, ma resta comoda perché non devi inserirla dall'UI
// ogni volta che pulisci il browser. Vite espone al client le variabili
// che iniziano con VITE_ (vedi https://vitejs.dev/guide/env-and-mode).
// -----------------------------------------------------------------------------

import { OPENAI_CONFIG } from './config.js';

// Chiave dall'ambiente Vite (definita in .env.local, mai committata)
const ENV_KEY = (import.meta.env && import.meta.env.VITE_OPENAI_API_KEY) || '';

export function getApiKey() {
  return localStorage.getItem(OPENAI_CONFIG.apiKeyStorageKey) || ENV_KEY || '';
}
export function setApiKey(k) {
  if (!k) localStorage.removeItem(OPENAI_CONFIG.apiKeyStorageKey);
  else localStorage.setItem(OPENAI_CONFIG.apiKeyStorageKey, k.trim());
}
export function hasApiKey() {
  return !!getApiKey();
}

// Prompt di sistema: forziamo linguaggio molto semplice, evitiamo gergo,
// e chiediamo un formato JSON preciso così l'UI lo mostra sempre uguale.
const SYSTEM_PROMPT = `Sei un meccanico esperto che parla in italiano MOLTO SEMPLICE, come se spiegassi a una persona anziana che non sa niente di motori.
Vietato usare sigle tecniche (LTFT, MAF, MAP, EGR, DPF, banco 1, ecc.) senza tradurle a parole comuni.
Rispondi SEMPRE con un oggetto JSON valido, senza testo prima o dopo, con questi campi esatti:
{
  "significato": "in una frase spiega cosa non va (parole semplici, max 25 parole)",
  "causa_probabile": "spiega la causa più probabile, come lo diresti al bar (max 40 parole)",
  "posso_guidare": "sì" oppure "no" oppure "sì ma con cautela",
  "perche_guida": "spiega perché in una frase semplice",
  "urgenza": "bassa" oppure "media" oppure "alta",
  "costo_indicativo_eur": "range indicativo in euro tipo '50-150 €' oppure 'da 200 a 600 €'",
  "cosa_fare": "3 azioni concrete numerate, brevi, dal tono rassicurante"
}
Se il codice è generico o poco chiaro, dai comunque una risposta prudente ma non allarmistica.`;

// Chiama la Chat Completions API per un singolo DTC.
// Ritorna l'oggetto JSON parsato o lancia un errore comprensibile.
export async function interpretaDtc(code, descrizioneBreve) {
  const key = getApiKey();
  if (!key) {
    throw new Error('Nessuna API key OpenAI impostata. Vai in Impostazioni e inseriscila.');
  }

  const userMsg = `Codice DTC: ${code}
Descrizione tecnica breve (fonte locale): ${descrizioneBreve || '(non disponibile)'}
Auto: generica (OBD-II standard, veicolo europeo, benzina o diesel).
Rispondi SOLO con il JSON descritto.`;

  const body = {
    model: OPENAI_CONFIG.model,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg }
    ]
  };

  let resp;
  try {
    resp = await fetch(OPENAI_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Impossibile contattare OpenAI (rete assente?): ${err.message}`);
  }

  if (!resp.ok) {
    let details = '';
    try {
      const j = await resp.json();
      details = j.error?.message || JSON.stringify(j);
    } catch { details = await resp.text(); }
    if (resp.status === 401) throw new Error('API key OpenAI non valida. Controllala nelle Impostazioni.');
    if (resp.status === 429) throw new Error('Hai superato i limiti di OpenAI. Riprova tra poco o controlla il tuo credito.');
    throw new Error(`Errore OpenAI ${resp.status}: ${details}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta OpenAI vuota.');

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Risposta OpenAI non in formato JSON valido.');
  }
}
