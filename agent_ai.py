"""
agent_ai.py — Handmade by Leila
1. Legge le immagini da /post_da_pubblicare/
2. Usa GPT-4o Vision per scegliere la foto più adatta al feed Instagram (max 10 random)
3. Sposta l'immagine scelta in /pubblicati/ (così non viene riselezionata)
4. Genera copy autentico per il post
5. Invia il payload al webhook Make.com per l'approvazione via Telegram
"""

import os
import sys
import base64
import json
import random
import shutil
import time
import requests
from datetime import datetime, timezone, time as dt_time
from pathlib import Path
from openai import OpenAI

# ── Config ───────────────────────────────────────────────────────────────────
OPENAI_API_KEY    = os.environ["OPENAI_API_KEY"]
MAKE_WEBHOOK_URL  = os.environ["MAKE_WEBHOOK_URL"]
POST_FOLDER       = Path("post_da_pubblicare")
PUBBLICATI_FOLDER = Path("pubblicati")
MAX_CANDIDATES    = 10  # Max immagini analizzate da GPT-4o per la selezione
LAST_RUN_FILE     = Path("last_run.json")

# ID univoco per ogni run (GitHub lo fornisce automaticamente, fallback a timestamp)
RUN_ID = os.environ.get("GITHUB_RUN_ID", str(int(time.time())))

# Giorno (Python weekday: Lunedì=0 ... Domenica=6) e ora UTC minima di pubblicazione.
# Il workflow gira ogni 15 min in una finestra intorno a questi orari: se GitHub
# Actions ritarda il trigger esatto, il primo tick utile dentro la finestra
# esegue comunque la pubblicazione — niente più "non è ancora partito".
SCHEDULE_UTC = {
    2: dt_time(9, 0),   # Mercoledì, 09:00 UTC (11:00/10:00 ora italiana)
    6: dt_time(8, 0),   # Domenica,   08:00 UTC (10:00/9:00 ora italiana)
}


def should_run_now(force: bool = False) -> bool:
    """
    Gate idempotente: esegue SOLO se
    1) oggi è un giorno di pubblicazione programmato,
    2) è già passato l'orario target di oggi,
    3) non abbiamo già pubblicato oggi.
    Evita sia i "non parte mai" (ritardo GitHub) sia i doppioni
    (retry multipli nella stessa finestra oraria).
    """
    if force:
        print("⚡ Esecuzione forzata (workflow_dispatch con force=true) — salto i controlli di orario.")
        return True

    now = datetime.now(timezone.utc)
    today_str = now.date().isoformat()

    target = SCHEDULE_UTC.get(now.weekday())
    if target is None:
        print(f"⏭️  Oggi ({now:%A}) non è un giorno di pubblicazione programmato — skip.")
        return False

    if now.time() < target:
        print(f"⏭️  Ancora presto: sono le {now:%H:%M} UTC, target {target:%H:%M} UTC — skip, riprovo al prossimo tick.")
        return False

    if LAST_RUN_FILE.exists():
        last = json.loads(LAST_RUN_FILE.read_text()).get("last_publish_date")
        if last == today_str:
            print(f"⏭️  Già pubblicato oggi ({today_str}) — skip per evitare doppioni.")
            return False

    return True


def mark_run_done():
    LAST_RUN_FILE.write_text(json.dumps({"last_publish_date": datetime.now(timezone.utc).date().isoformat()}, indent=2))

BRAND_SYSTEM_PROMPT = """Sei il social media manager di "Handmade by Leila".
Leila è un'artigiana italiana che crea oggetti fatti a mano con materiali naturali.
Valori del brand: fatto a mano, materiali naturali, tempo lento, pezzi unici.
Tono: caldo, familiare, in prima persona — come se scrivessi a un'amica.
Evita: linguaggio da marketing, emoji eccessive, paragoni con prodotti industriali, claim non veri."""


# ── Selezione immagine ────────────────────────────────────────────────────────
def get_images_to_publish() -> list[Path]:
    """Restituisce tutte le immagini disponibili in post_da_pubblicare/."""
    extensions = {".jpg", ".jpeg", ".png", ".webp"}
    images = [
        f for f in POST_FOLDER.iterdir()
        if f.is_file() and f.suffix.lower() in extensions
    ]
    return sorted(images, key=lambda f: f.name)


def image_to_base64(path: Path) -> tuple[str, str]:
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp"}
    mime = mime_map.get(path.suffix.lower(), "image/jpeg")
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8"), mime


def select_best_image(images: list[Path]) -> Path:
    """
    Campiona fino a MAX_CANDIDATES immagini random e usa GPT-4o per
    scegliere quella più adatta al feed. Garantisce nessun duplicato
    perché le immagini già proposte sono già in pubblicati/.
    """
    if len(images) == 1:
        print(f"   Solo 1 immagine disponibile: {images[0].name}")
        return images[0]

    # Campiona casualmente (evita di mandare 70 immagini a GPT-4o)
    candidates = random.sample(images, min(MAX_CANDIDATES, len(images)))
    print(f"   Campiono {len(candidates)} immagini su {len(images)} disponibili...")

    client = OpenAI(api_key=OPENAI_API_KEY)

    content = []
    for img in candidates:
        b64, mime = image_to_base64(img)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "low"}
        })

    filenames = ", ".join(img.name for img in candidates)
    content.append({
        "type": "text",
        "text": (
            f"Sei il social media manager di 'Handmade by Leila', brand artigianale italiano.\n"
            f"Hai {len(candidates)} foto disponibili da pubblicare su Instagram.\n\n"
            "Scegli QUALE pubblicare ADESSO considerando:\n"
            "- Impatto visivo e qualità della foto\n"
            "- Varietà (colori, soggetto, composizione) per un feed equilibrato\n"
            "- Quale cattura meglio l'essenza del brand 'fatto a mano con amore'\n\n"
            f"Scegli tra: {filenames}\n\n"
            "Rispondi SOLO con il nome esatto del file. Nessun altro testo."
        )
    })

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Sei un esperto di Instagram aesthetics per brand artigianali."},
            {"role": "user", "content": content}
        ],
        max_tokens=50,
        temperature=0.3,
    )

    chosen_name = response.choices[0].message.content.strip().strip('"').strip("'")
    print(f"   GPT-4o ha scelto: {chosen_name}")

    for img in candidates:
        if img.name == chosen_name or img.name in chosen_name or chosen_name in img.name:
            return img

    print(f"   ⚠️ Nome '{chosen_name}' non corrisponde — uso il primo del campione.")
    return candidates[0]


def move_to_pubblicati(image_path: Path) -> Path:
    """
    Sposta l'immagine da post_da_pubblicare/ a pubblicati/.
    Ritorna il nuovo path (usato per generare l'URL GitHub corretto).
    """
    PUBBLICATI_FOLDER.mkdir(exist_ok=True)
    dest = PUBBLICATI_FOLDER / image_path.name
    shutil.move(str(image_path), str(dest))
    print(f"📁 Spostata: post_da_pubblicare/{image_path.name} → pubblicati/{image_path.name}")
    return dest


# ── Generazione copy ──────────────────────────────────────────────────────────
def generate_copy(image_path: Path) -> dict:
    client = OpenAI(api_key=OPENAI_API_KEY)
    b64, mime = image_to_base64(image_path)

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": BRAND_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Guarda questa foto di un prodotto artigianale di Leila "
                            "e scrivi un post Instagram autentico.\n\n"
                            "Rispondi SOLO con un JSON valido:\n"
                            "{\n"
                            '  "caption": "testo del post (max 2000 caratteri, warm & personale, 1-2 emoji ok)",\n'
                            '  "hashtags": ["handmade", "fattoamano", "artigianato", "handmadebyleila"],\n'
                            '  "alt_text": "descrizione breve immagine per accessibilità (max 100 char)"\n'
                            "}"
                        ),
                    },
                ],
            },
        ],
        max_tokens=1000,
        temperature=0.75,
    )

    content = response.choices[0].message.content.strip()
    if content.startswith("```"):
        parts = content.split("```")
        content = parts[1]
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content.strip())


# ── Invio a Make ──────────────────────────────────────────────────────────────
def get_raw_github_url(image_path: Path) -> str:
    repo   = os.environ.get("GITHUB_REPOSITORY", "lucagull8/handmade-social-agent")
    branch = os.environ.get("GITHUB_REF_NAME", "main")
    return f"https://raw.githubusercontent.com/{repo}/{branch}/{image_path.as_posix()}"


def send_to_make(image_path: Path, copy: dict) -> dict:
    image_url    = get_raw_github_url(image_path)
    hashtags_str = " ".join(f"#{h.lstrip('#')}" for h in copy["hashtags"])
    full_caption = f"{copy['caption']}\n\n{hashtags_str}"

    payload = {
        "run_id":         RUN_ID,
        "image_url":      image_url,
        "caption":        full_caption,
        "alt_text":       copy.get("alt_text", ""),
        "image_filename": image_path.name,
    }

    print(f"\n📤 Invio payload a Make.com...")
    print(f"   Immagine : {image_path.name}")
    print(f"   URL      : {image_url}")
    print(f"   Caption  : {copy['caption'][:80]}{'...' if len(copy['caption']) > 80 else ''}")

    resp = requests.post(MAKE_WEBHOOK_URL, json=payload, timeout=30)
    resp.raise_for_status()
    print(f"   Make ha risposto: HTTP {resp.status_code}")
    return payload


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("🤖 Agent AI — Handmade by Leila")
    print("=" * 42)

    force = os.environ.get("FORCE_RUN", "").lower() == "true"
    if not should_run_now(force=force):
        sys.exit(0)

    # 1. Trova immagini disponibili in post_da_pubblicare/
    images = get_images_to_publish()
    if not images:
        print("❌ Nessuna immagine in post_da_pubblicare/ — skip.")
        sys.exit(0)
    print(f"📸 {len(images)} immagini disponibili in post_da_pubblicare/")

    # 2. GPT-4o sceglie la migliore tra un campione random
    print("\n🎨 Selezione immagine ottimale per il feed...")
    image_path = select_best_image(images)
    print(f"✅ Immagine scelta: {image_path.name}")

    # 3. Sposta in pubblicati/ PRIMA di generare l'URL
    #    (così l'URL GitHub sarà corretto quando Make pubblica su Instagram)
    published_path = move_to_pubblicati(image_path)

    # 4. Genera copy con GPT-4o Vision
    print("\n💬 Generazione copy con GPT-4o Vision...")
    copy = generate_copy(published_path)
    print("✅ Copy generato!")

    # 5. Invia a Make.com (URL punta a pubblicati/)
    send_to_make(published_path, copy)

    # 6. Segna la pubblicazione di oggi come fatta (evita retry doppi nella finestra)
    mark_run_done()

    print("\n🎉 Done! Il post è in coda su Make.com — attendi l'approvazione su Telegram.")


if __name__ == "__main__":
    main()
