"""
agent_ai.py — Handmade by Leila
Seleziona l'immagine più recente da /post_da_pubblicare/, genera copy con
GPT-4o Vision e invia il payload al webhook Make.com per l'approvazione.
"""

import os
import sys
import base64
import json
import requests
from pathlib import Path
from openai import OpenAI

# ── Config ───────────────────────────────────────────────────────────────────
OPENAI_API_KEY  = os.environ["OPENAI_API_KEY"]
MAKE_WEBHOOK_URL = os.environ["MAKE_WEBHOOK_URL"]
POST_FOLDER     = Path("post_da_pubblicare")

BRAND_SYSTEM_PROMPT = """Sei il social media manager di "Handmade by Leila".
Leila è un'artigiana italiana che crea oggetti fatti a mano con materiali naturali.
Valori del brand: fatto a mano, materiali naturali, tempo lento, pezzi unici.
Tono: caldo, familiare, in prima persona — come se scrivessi a un'amica.
Evita: linguaggio da marketing, emoji eccessive, paragoni con prodotti industriali, claim non veri."""


# ── Helpers ──────────────────────────────────────────────────────────────────
def get_latest_image() -> Path:
    """Restituisce l'immagine più recente (per data di modifica) nella cartella."""
    extensions = {".jpg", ".jpeg", ".png", ".webp"}
    images = [
        f for f in POST_FOLDER.iterdir()
        if f.is_file() and f.suffix.lower() in extensions
    ]
    if not images:
        print("❌ Nessuna immagine trovata in post_da_pubblicare/ — skip.")
        sys.exit(0)

    images.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return images[0]


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


def get_raw_github_url(image_path: Path) -> str:
    """Costruisce l'URL pubblico raw.githubusercontent.com per l'immagine."""
    repo   = os.environ.get("GITHUB_REPOSITORY", "lucagull8/handmade-social-agent")
    branch = os.environ.get("GITHUB_REF_NAME", "main")
    # Usa forward slash anche su Windows
    posix_path = image_path.as_posix()
    return f"https://raw.githubusercontent.com/{repo}/{branch}/{posix_path}"


def send_to_make(image_path: Path, copy: dict) -> dict:
    """Invia il payload JSON al webhook Make.com."""
    image_url     = get_raw_github_url(image_path)
    hashtags_str  = " ".join(f"#{h.lstrip('#')}" for h in copy["hashtags"])
    full_caption  = f"{copy['caption']}\n\n{hashtags_str}"

    payload = {
        "image_url":       image_url,
        "caption":         full_caption,
        "alt_text":        copy.get("alt_text", ""),
        "image_filename":  image_path.name,
    }

    print(f"\n📤 Invio payload a Make.com...")
    print(f"   🖼  Immagine : {image_path.name}")
    print(f"   🔗 URL      : {image_url}")
    print(f"   💬 Caption  : {copy['caption'][:80]}{'...' if len(copy['caption']) > 80 else ''}")

    resp = requests.post(MAKE_WEBHOOK_URL, json=payload, timeout=30)
    resp.raise_for_status()

    print(f"   ✅ Make ha risposto: HTTP {resp.status_code}")
    return payload


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("🤖 Agent AI — Handmade by Leila")
    print("=" * 42)

    # 1. Trova l'immagine più recente
    image_path = get_latest_image()
    print(f"📸 Immagine selezionata: {image_path.name}")

    # 2. Genera copy con GPT-4o Vision
    print("💬 Generazione copy con GPT-4o Vision...")
    copy = generate_copy(image_path)
    print("✅ Copy generato con successo.")

    # 3. Invia a Make.com (che gestisce Telegram + Meta)
    send_to_make(image_path, copy)

    print("\n🎉 Done! Il post è in coda su Make.com — attendi l'approvazione su Telegram.")


if __name__ == "__main__":
    main()
