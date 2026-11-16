// Onglet "Chat" : conversation avec Claude, qui reçoit en contexte
// les derniers écarts de cotes, surebets et le journal de paris.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'low';

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const INSTRUCTIONS = `Tu es l'assistant intégré de l'application "Écarts de cotes", un comparateur des cotes Winamax, Unibet et Betclic (source : Flashscore).
Ton rôle : aider l'utilisateur à repérer les cotes mal ajustées entre ces trois books, à comprendre les chiffres de l'application et à gérer sa bankroll.

Principes :
- L'analyse porte sur les cotes elles-mêmes (écarts entre books, cote juste du consensus, value, surebets, marges, mouvements), pas sur l'analyse sportive. Ne donne pas de pronostic sportif sauf si l'utilisateur le demande explicitement, et dans ce cas précise que ce n'est pas le cœur de l'outil.
- Définitions utilisées par l'app :
  * Écart % = meilleure cote / moins bonne cote - 1, pour la même sélection.
  * Cote juste = 1 / probabilité moyenne des books après retrait de leur marge.
  * Value % = meilleure cote × probabilité juste - 1. Positive = la meilleure cote paie plus que le consensus.
  * Surebet = somme des 1/meilleure cote < 1 sur toutes les issues d'un marché.
  * Mouvement = cote actuelle vs cote d'ouverture chez un book.
- Rappelle quand c'est utile qu'un gros écart peut aussi venir d'une info (blessure, compo) intégrée par un book avant les autres, d'une cote pas encore mise à jour, ou d'une erreur de relevé ; il faut vérifier la cote sur le site du book avant de parier.
- Les données datent du dernier scan indiqué ; dis-le si elles semblent anciennes.
- Réponds en français, de façon concise et concrète, avec des chiffres. Utilise du Markdown simple (listes, gras, tableaux courts).
- Jeu responsable : ne pousse jamais à miser plus, rappelle les limites de bankroll si l'utilisateur semble s'emballer.`;

function formatContext(snapshot) {
  return `Données actuelles de l'application (JSON) :\n${JSON.stringify(snapshot)}`;
}

/**
 * Envoie la conversation à Claude et transmet le texte au fur et à mesure via onText.
 */
async function streamChat({ messages, snapshot, onText, signal }) {
  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: formatContext(snapshot) },
      ],
      messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
    },
    { signal }
  );
  stream.on('text', (t) => onText(t));
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    onText("\n\n_(Claude n'a pas pu répondre à cette demande.)_");
  }
  return final;
}

module.exports = { streamChat, MODEL };
