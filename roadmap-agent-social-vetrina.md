# Roadmap — AI Agent pubblicazione social (vetrina artigianale)

## Obiettivo
Sistema automatico che, 2 volte a settimana, prende una foto da Google Drive,
genera un post (copy + hashtag) con AI, lo invia in approvazione via Telegram,
e se approvato lo pubblica su Instagram + Facebook. Costo infrastruttura: €0
(escluse chiamate API AI, ~€0,20-0,50/mese totali).

## Stack
- Node.js (script, no framework web necessario)
- GitHub Actions (scheduling, sia per la proposta che per il polling delle approvazioni)
- Google Drive API (magazzino foto)
- Telegram Bot API (canale di approvazione)
- Meta Graph API (Instagram + Facebook publish)
- Claude API o GPT API (generazione copy)
- MongoDB Atlas free tier o anche solo file JSON su repo per stato (vedi Fase 5)

---

## FASE 0 — Setup account e credenziali (manuale, non da Claude Code)
Da fare prima di iniziare a scrivere codice:

1. Pagina Facebook + account Instagram Business collegato (admin: Luca)
2. App su developers.facebook.com → ottenere `App ID`, `App Secret`
3. Generare `long-lived access token` con permessi:
   `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`,
   `pages_show_list`
4. ID della Pagina Facebook e ID account Instagram Business (`ig_user_id`)
5. Bot Telegram via @BotFather → `BOT_TOKEN`, e proprio `chat_id` personale
6. Google Cloud Console → Service Account con accesso a Google Drive API →
   file `credentials.json`, condividere le cartelle Drive con l'email del
   service account
7. Due cartelle su Google Drive: `Da Pubblicare` e `Archivio` (annotare i
   relativi folder ID)
8. API key Claude o OpenAI
9. Repo GitHub privato per il progetto (per usare GitHub Actions + Secrets)

Tutte le credenziali vanno salvate come **GitHub Secrets** del repo, non in
chiaro nel codice.

---

## FASE 1 — Scaffold progetto
**Prompt per Claude Code:**
> Crea uno scaffold Node.js (ESM, no TypeScript) con questa struttura:
> - `/src/drive.js` — funzioni per leggere/spostare file su Google Drive
> - `/src/telegram.js` — funzioni per inviare messaggi/foto con bottoni inline e leggere updates
> - `/src/meta.js` — funzioni per pubblicare su Instagram e Facebook via Graph API
> - `/src/ai.js` — funzione che genera copy a partire da foto + profilo brand
> - `/src/state.js` — gestione stato post in attesa di approvazione (vedi Fase 5)
> - `/profile/brand.json` — profilo brand (Fase 2)
> - `/scripts/propose.js` — entrypoint Flusso A
> - `/scripts/check-approvals.js` — entrypoint Flusso B
> - `.github/workflows/propose.yml` e `.github/workflows/check-approvals.yml`
> - `.env.example` con tutte le variabili necessarie
> - `package.json` con dipendenze: `googleapis`, `node-telegram-bot-api` (o `telegraf`),
>   `@anthropic-ai/sdk` (o `openai`), `axios`, `dotenv`

---

## FASE 2 — Profilo Brand (file di configurazione statico)
**Prompt per Claude Code:**
> Crea `/profile/brand.json` con questa struttura, da compilare con i dati reali:
> ```json
> {
>   "nome_attivita": "",
>   "artigiano": "",
>   "tecnica": [],
>   "tono_voce": "caldo, familiare, in prima persona, no linguaggio da marketing",
>   "storia_breve": "",
>   "valori": ["fatto a mano", "materiali naturali", "tempo lento", "pezzi unici"],
>   "cose_da_evitare": ["paragoni con prodotti industriali", "tono aziendale", "emoji eccessive", "claim non veri"],
>   "esempi_tono_voce": []
> }
> ```
> `esempi_tono_voce`: 3-4 frasi scritte/dette realmente dalla mamma (anche
> trascritte da vocali), usate come few-shot nel prompt AI.

*(Questo file lo compiliamo insieme a parte, prima o dopo lo scaffold — non è
codice, è contenuto.)*

---

## FASE 3 — Flusso A: Proposta (Drive → AI → Telegram)
**Prompt per Claude Code:**
> Implementa `scripts/propose.js`:
> 1. Connettersi a Google Drive con service account, leggere il primo file
>    immagine nella cartella `Da Pubblicare` (ordinato per data di upload)
> 2. Se non ci sono file, loggare e uscire senza errori
> 3. Caricare `/profile/brand.json` e gli ultimi 3 post pubblicati (da
>    `state.json`, vedi Fase 5) per evitare ripetizioni
> 4. Chiamare l'AI (Claude API, vedi prompt template sotto) passando l'immagine
>    e il profilo brand, ottenere: testo del post + 5-8 hashtag
> 5. Inviare via Telegram: la foto + il testo generato + due bottoni inline
>    `Approva ✅` e `Rifiuta ❌` con callback_data che referenzia l'ID del file Drive
> 6. Salvare in `state.json` il post proposto con stato `pending` e timestamp

**Template prompt AI da passare a Claude Code per `ai.js`:**
```
Sei il social media manager di {nome_attivita}, una vetrina di lavori
artigianali fatti a mano da {artigiano}.

Tono di voce: {tono_voce}
Storia: {storia_breve}
Valori da trasmettere: {valori}
Da evitare sempre: {cose_da_evitare}

Esempi di come parla {artigiano} (imita questo stile, non un tono generico):
{esempi_tono_voce}

Genera un post Instagram/Facebook per la creazione mostrata nella foto.
Il post deve:
- Essere in prima persona, come se scrivesse {artigiano}
- Massimo 80 parole
- Includere 5-8 hashtag pertinenti (mix nicchia artigianale + generici)
- Non sembrare scritto da un'AI
- Avere una struttura diversa rispetto a questi ultimi post pubblicati:
{ultimi_post}

Rispondi SOLO in JSON: {"testo": "...", "hashtag": ["...", "..."]}
```

**GitHub Actions schedule** (`propose.yml`): cron 2 volte a settimana, orario
a scelta (es. `0 9 * * 1,4` per lunedì e giovedì alle 9 UTC, da convertire in
orario IT).

---

## FASE 4 — Flusso B: Approvazione e pubblicazione
**Prompt per Claude Code:**
> Implementa `scripts/check-approvals.js`, pensato per girare ogni 5-10 minuti:
> 1. Leggere i `getUpdates` da Telegram (con `offset` salvato in `state.json`
>    per non rileggere update già processati)
> 2. Per ogni callback `Approva`: recuperare il post pending corrispondente,
>    pubblicare su Instagram (flusso a due step: creare media container con
>    URL pubblico dell'immagine, poi pubblicare) e su Facebook Page (post con
>    foto), poi spostare il file su Drive da `Da Pubblicare` a `Archivio`,
>    aggiornare `state.json` a `published`, rispondere su Telegram con
>    conferma
> 3. Per ogni callback `Rifiuta`: aggiornare stato a `rejected`, NON spostare
>    il file (resta disponibile per rigenerazione manuale o futura riproposta),
>    rispondere su Telegram con conferma
> 4. Gestire errori Meta API con retry singolo e notifica Telegram in caso di
>    fallimento persistente

**Nota tecnica importante per Claude Code**: l'immagine va resa raggiungibile
da un URL pubblico per la chiamata alla Graph API (Meta non accetta upload
binario diretto per Instagram). Soluzioni: usare il link diretto di Google
Drive resto pubblico in lettura, o fare un upload temporaneo su un bucket
pubblico. Specificare a Claude Code quale preferisci (Drive pubblico in
read-only è la più semplice).

**GitHub Actions schedule** (`check-approvals.yml`): `*/10 * * * *`.

---

## FASE 5 — Gestione stato
**Prompt per Claude Code:**
> Implementa `src/state.js`: stato persistito come file `state.json` dentro
> il repo stesso, aggiornato e commit-pushato automaticamente dal workflow
> GitHub Actions a fine esecuzione (usare `git config` + `git commit` + `git push`
> dentro il workflow YAML con il token di GitHub Actions). Struttura:
> ```json
> {
>   "telegram_offset": 0,
>   "posts": [
>     {"drive_file_id": "...", "status": "pending|published|rejected", "testo": "...", "hashtag": [...], "timestamp": "..."}
>   ]
> }
> ```
> Alternativa se si preferisce non commitare stato nel repo: MongoDB Atlas
> free tier con una singola collection `posts`.

---

## FASE 6 — Token refresh Meta
**Prompt per Claude Code:**
> Implementa uno script separato `scripts/refresh-token.js` che rinnova il
> long-lived token Meta (durata 60 giorni) e aggiorna il GitHub Secret via
> GitHub API, con un workflow schedulato ogni 50 giorni come promemoria/
> esecuzione automatica.

---

## FASE 7 — Testing end-to-end
- Test manuale con 2-3 foto reali in `Da Pubblicare`
- Verifica formattazione post su IG (limiti caratteri, hashtag) e FB
- Verifica gestione "Drive vuoto" (nessun errore, log silenzioso)
- Verifica doppia approvazione accidentale (idempotenza: se un post è già
  `published`, un secondo click su Approva non deve ripubblicare)

---

## Ordine di esecuzione consigliato per Claude Code
1. Fase 1 (scaffold)
2. Fase 5 (state, serve alle altre fasi)
3. Fase 3 (Flusso A) — testabile da solo, vedi se il post proposto è buono
4. Fase 4 (Flusso B) — la parte più delicata, Meta API
5. Fase 6 (token refresh)
6. Fase 7 (testing)
Fase 2 (profilo brand) va compilata con contenuti reali in parallelo, prima
serve almeno una bozza per testare Fase 3.
