"""
agent_ai.py — Handmade by Leila
1. Legge tutte le immagini da /post_da_pubblicare/ (esclude quelle già proposte)
2. Usa GPT-4o Vision per scegliere la foto più adatta al feed Instagram
3. Genera copy autentico per il post
4. Invia il payload al webhook Make.com per l'approvazione via Telegram
"""

import os
import sys
import base64
import json
import requests
from pathlib import Path
from openai import OpenAI

# ── Config ───────────────────────────────────────────────────────────────────
OPENAI_API_KEY   = os.environ["OPENAI_API_KEY"]
MAKE_WEBHOOK_URL = os.environ["MAKE_WEBHOOK_URL"]
POST_FOLDER      = Path("post_da_pubblicare")
HISTORY_FILE     = Path("posted_images.json")

BRAND_SYSTEM_PROMPT = """Sei il social media manager di "Handmade by Leila".
Leila è un'artigiana italiana che crea oggetti fatti a mano con materiali naturali.
Valori del brand: fatto a mano, materiali naturali, tempo lento, pezzi unici.
Tono: caldo, familiare, in prima persona — come se scrivessi a un'amica.
Evita: linguaggio da marketing, emoji eccessive, paragoni con prodotti industriali, claim non veri."""


# ── Storia pubblicazioni ──────────────────────────────────────────────────────
def load_history() -> list[str]:
    """Carica la lista delle immagini già proposte."""
    if HISTORY_FILE.exists():
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_history(history: list[str]):
    """Salva la lista delle immagini già proposte."""
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


# ── Selezione immagine ────────────────────────────────────────────────────────
def get_all_images() -> list[Path]:
    """Restituisce tutte le immagini in post_da_pubblicare/."""
    extensions = {".jpg", ".jpeg", ".png", ".webp"}
    return sorted(
        [f for f in POST_FOLDER.iterdir() if f.is_file() and f.suffix.lower() in extensions],
        key=lambda f: f.name
    )


def get_unposted_images(all_images: list[Path], history: list[str]) -> list[Path]:
    """Filtra le immagini non ancora proposte. Se tutte pubblicate, resetta."""
    posted_set = set(history)
    unposted = [img for img in all_images if img.name not in posted_set]

    if not unposted:
        print("🔄 Tutte le immagini sono state proposte — ricominciamo dall'inizio!")
        save_history([])
        return all_images

    return unposted


def image_to_base64(path: Path) -> tuple[str, str]:
    """Ritorna (base64_string, mime_type)."""
    mime_map = {
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".webp": "image/webp",
    }
    mime = mime_map.get(path.suffix.lower(), "image/jpeg")
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8"), mime


def select_best_image(images: list[Path]) -> Path:
    """
    Se c'è solo un'immagine, la usa direttamente.
    Altrimenti usa GPT-4o per scegliere la foto più adatta al feed Instagram.
    """
    if len(images) == 1:
        print(f"   Solo 1 immagine disponibile: {images[0].name}")
        return images[0]

    print(f"   Analizzo {len(images)} immagini con GPT-4o per scegliere la migliore...")

    client = OpenAI(api_key=OPENAI_API_KEY)

    content = []
    for img in images:
        b64, mime = image_to_base64(img)
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime};base64,{b64}",
                "detail": "low"  # "low" per risparmiare token nella selezione
            }
        })

    filenames = ", ".join(img.name for img in images)
    content.append({
        "type": "text",
        "text": (
            f"Sei il social media manager di 'Handmade by Leila', brand artigianale italiano.\n"
            f"Hai {len(images)} foto disponibili da pubblicare su Instagram (mostrate nell'ordine sopra).\n\n"
            "Scegli QUALE pubblicare ADESSO considerando:\n"
            "- Impatto visivo e qualità della foto\n"
            "- Varietà rispetto ai post tipici di un feed artigianale (colori, soggetto, composizione)\n"
            "- Quale cattura meglio l'essenza del brand 'fatto a mano con amore'\n\n"
            f"Scegli tra: {filenames}\n\n"
            "Rispondi SOLO con il nome esatto del file scelto. Nessun altro testo."
        )
    })

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Sei un esperto di Instagram aesthetics e social media per brand artigianali."},
            {"role": "user", "content": content}
        ],
        max_tokens=50,
        temperature=0.3,
    )

    chosen_name = response.choices[0].message.content.strip().strip('"').strip("'")
    print(f"   GPT-4o ha scelto: {chosen_name}")

    # Trova l'immagine corrispondente
    for img in images:
        if img.name == chosen_name or img.name in chosen_name or chosen_name in img.name:
            return img

    # Fallback se il nome non corrisponde esattamente
    print(f"   ⚠️ Nome '{chosen_name}' non corrisponde esattamente — uso il primo disponibile.")
    return images[0]


# ── Generazione copy ──────────────────────────────────────────────────────────
def generate_copy(image_path: Path) -> dict:
    """Chiama GPT-4o Vision e ritorna dict con caption, hashtags, alt_text."""
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
                        "image_url": {
                            "url": f"data:{mime};base64,{b64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Guarda questa foto di un prodotto artigianale di Leila "
                            "e scrivi un post Instagram autentico.\n\n"
                            "Rispondi SOLO con un JSON valido — nessun testo fuori dal JSON:\n"
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

    # Rimuovi markdown code fence se presente
    if content.startswith("```"):
        parts = content.split("```")
        content = parts[1]
        if content.startswith("json"):
            content = content[4:]
    content = content.strip()

    return json.loads(content)


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

    # 1. Carica storia pubblicazioni
    history = load_history()
    print(f"📋 Immagini già proposte: {len(history)}")

    # 2. Trova tutte le immagini disponibili
    all_images = get_all_images()
    if not all_images:
        print("❌ Nessuna immagine in post_da_pubblicare/ — skip.")
        sys.exit(0)
    print(f"🗂  Immagini totali nella cartella: {len(all_images)}")

    # 3. Filtra le non ancora proposte
    unposted = get_unposted_images(all_images, history)
    print(f"📸 Immagini disponibili (non ancora proposte): {len(unposted)}")

    # 4. GPT-4o sceglie la migliore per il feed
    print("\n🎨 Selezione immagine ottimale per il feed...")
    image_path = select_best_image(unposted)
    print(f"✅ Immagine scelta: {image_path.name}")

    # 5. Segna come proposta (prima di inviare, per sicurezza)
    history = load_history()  # rilegge in caso di reset
    if image_path.name not in history:
        history.append(image_path.name)
        save_history(history)
        print(f"💾 {image_path.name} aggiunto a posted_images.json")

    # 6. Genera copy con GPT-4o Vision
    print("\n💬 Generazione copy con GPT-4o Vision...")
    copy = generate_copy(image_path)
    print("✅ Copy generato!")

    # 7. Invia a Make.com
    send_to_make(image_path, copy)

    print("\n🎉 Done! Il post è in coda su Make.com — attendi l'approvazione su Telegram.")


if __name__ == "__main__":
    main()
