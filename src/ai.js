import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function generatePost(imageBase64, mimeType, lastPosts = []) {
  const brand = JSON.parse(
    readFileSync(join(__dirname, '..', 'profile', 'brand.json'), 'utf-8')
  );

  const client = new Anthropic();

  const ultimi = lastPosts.length > 0
    ? lastPosts.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : 'Nessun post precedente.';

  const prompt = `Sei il social media manager di ${brand.nome_attivita}, una vetrina di lavori artigianali fatti a mano da ${brand.artigiano}.

Tono di voce: ${brand.tono_voce}
Storia: ${brand.storia_breve}
Valori da trasmettere: ${brand.valori.join(', ')}
Da evitare sempre: ${brand.cose_da_evitare.join(', ')}

Esempi di come parla ${brand.artigiano} (imita questo stile):
${brand.esempi_tono_voce.join('\n')}

Genera un post Instagram/Facebook per la creazione mostrata nella foto.
Il post deve:
- Essere in prima persona, come se scrivesse ${brand.artigiano}
- Massimo 80 parole
- Includere 5-8 hashtag pertinenti (mix nicchia artigianale + generici)
- Non sembrare scritto da un'AI
- Avere una struttura diversa rispetto a questi ultimi post:
${ultimi}

Rispondi SOLO in JSON valido: {"testo": "...", "hashtag": ["...", "..."]}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const text = response.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI non ha restituito JSON valido');
  return JSON.parse(match[0]);
}
