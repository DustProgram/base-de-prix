// Extraction de prix depuis des documents (PDF / texte Excel) via l'API Claude.
// Tourne dans le processus principal : la clé API n'est jamais exposée au renderer.
const { z } = require('zod')
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod')
let Anthropic = require('@anthropic-ai/sdk')
Anthropic = Anthropic.default || Anthropic

const MODEL = 'claude-opus-5'
// Tarifs USD par million de tokens (pour l'estimation affichée à l'utilisateur)
const PRICE_INPUT_PER_MTOK = 5
const PRICE_OUTPUT_PER_MTOK = 25

// 32 Mo : limite de requête de l'API pour les documents
const MAX_PDF_BYTES = 30 * 1024 * 1024

const LigneSchema = z.object({
  repere: z.string().describe("Code/repère article si présent dans le document (ex: PV-001, 2.1.4), sinon chaîne vide"),
  designation: z.string().describe("Désignation de l'ouvrage, complète mais concise, sans le prix ni la quantité"),
  lot: z.string().describe('Lot BTP choisi EXACTEMENT dans la liste fournie (recopier la ligne entière, ex: "04 - Gros Oeuvre")'),
  unite: z.string().describe('Unité du prix unitaire : m2, ml, m3, u, ens, kg, h, forfait…'),
  prix: z.number().describe('Prix UNITAIRE HT en euros (jamais un montant total)'),
  quantite: z.number().nullable().describe('Quantité indiquée dans le document si présente, sinon null'),
  date: z.string().describe('Date propre à cette ligne au format YYYY-MM-DD, ou chaîne vide pour utiliser la date du document'),
  confiance: z.enum(['haute', 'moyenne', 'basse']).describe("Confiance dans l'exactitude de cette ligne")
})

const ExtractionSchema = z.object({
  projet: z.string().describe('Nom du chantier/projet identifié dans le document, chaîne vide si introuvable'),
  date_document: z.string().describe('Date du document au format YYYY-MM-DD, chaîne vide si introuvable'),
  lignes: z.array(LigneSchema),
  avertissements: z.array(z.string()).describe('Problèmes rencontrés : pages illisibles, colonnes ambiguës, prix douteux…')
})

function buildSystemPrompt(lots) {
  return `Tu es un économiste de la construction expert en dépouillement d'offres BTP françaises (DPGF, devis, bordereaux de prix, estimations).

Ta mission : extraire TOUS les prix unitaires HT exploitables du document fourni, pour alimenter une base de prix d'entreprise.

Règles impératives :
- N'extrais que des PRIX UNITAIRES (€/m2, €/ml, €/u…). Ignore les totaux, sous-totaux, récapitulatifs, montants de lot, TVA, et les lignes "pour mémoire" / "sans objet" / options non chiffrées.
- Une ligne titre/chapitre sans prix n'est pas extraite ; rattache son contexte à la désignation des sous-lignes (ex: "Clôture de chantier — pour le parking").
- Si un prix unitaire n'est pas affiché mais que montant total et quantité le sont, calcule prix = montant / quantité et marque la confiance "moyenne".
- Convertis les dates au format YYYY-MM-DD. Les nombres français utilisent la virgule décimale et l'espace des milliers : "1 234,56" = 1234.56.
- Classe chaque ligne dans un lot en recopiant EXACTEMENT une entrée de cette liste :
${lots.map(l => `  - ${l}`).join('\n')}
  Si aucun lot ne convient vraiment, choisis le plus proche et marque la confiance "basse".
- Reprends le repère/code article du document s'il existe, sinon laisse "repere" vide.
- Signale dans "avertissements" tout ce qui a gêné l'extraction (scan illisible, colonnes fusionnées, devise autre que l'euro…).`
}

function buildUserText({ filename, text, hints }) {
  let t = `Document à dépouiller : "${filename || 'document'}"`
  if (hints && hints.projet) t += `\nProjet/chantier probable (issu du contexte) : ${hints.projet}`
  if (hints && hints.date) t += `\nDate probable du document : ${hints.date}`
  if (text) {
    t += `\n\nContenu du document (extrait automatiquement du fichier Excel, une section par feuille) :\n\n${text}`
  }
  t += `\n\nExtrais tous les prix unitaires selon les règles.`
  return t
}

function costUSD(usage) {
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  const outTok = usage.output_tokens || 0
  return inTok / 1e6 * PRICE_INPUT_PER_MTOK + outTok / 1e6 * PRICE_OUTPUT_PER_MTOK
}

/**
 * Extrait les prix d'un document.
 * @param {object} opts
 * @param {string} opts.apiKey   Clé API Anthropic
 * @param {'pdf'|'text'} opts.kind
 * @param {string} [opts.base64] PDF encodé base64 (kind = 'pdf')
 * @param {string} [opts.text]   Contenu texte/CSV (kind = 'text')
 * @param {string} opts.filename Nom du fichier d'origine
 * @param {string[]} opts.lots   Lots de l'entreprise
 * @param {object} [opts.hints]  {projet, date}
 */
async function extractPrices({ apiKey, kind, base64, text, filename, lots, hints }) {
  const client = new Anthropic({ apiKey, maxRetries: 3 })

  const content = []
  if (kind === 'pdf') {
    if (!base64) return { ok: false, error: 'PDF vide' }
    if (base64.length * 0.75 > MAX_PDF_BYTES) {
      return { ok: false, error: 'PDF trop volumineux (> 30 Mo). Scindez-le en plusieurs fichiers.' }
    }
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 }
    })
    content.push({ type: 'text', text: buildUserText({ filename, hints }) })
  } else {
    if (!text || !text.trim()) return { ok: false, error: 'Aucun contenu texte à analyser' }
    content.push({ type: 'text', text: buildUserText({ filename, text, hints }) })
  }

  let response
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 32000,
      system: buildSystemPrompt(lots || []),
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(ExtractionSchema) }
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'Clé API invalide ou révoquée. Vérifiez-la dans Paramètres.' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Limite de débit API atteinte. Réessayez dans quelques minutes.', retryable: true }
    }
    if (err instanceof Anthropic.BadRequestError) {
      return { ok: false, error: 'Requête refusée par l\'API : ' + err.message }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: 'Connexion à l\'API impossible (réseau/proxy).', retryable: true }
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Erreur API (${err.status}) : ${err.message}`, retryable: err.status >= 500 }
    }
    return { ok: false, error: err.message }
  }

  if (response.stop_reason === 'refusal') {
    return { ok: false, error: 'L\'API a refusé de traiter ce document.' }
  }
  if (response.stop_reason === 'max_tokens') {
    return { ok: false, error: 'Document trop long pour une seule analyse. Scindez le fichier (≈50 pages max).' }
  }
  const data = response.parsed_output
  if (!data) {
    return { ok: false, error: 'Réponse illisible (JSON invalide). Réessayez.', retryable: true }
  }

  return {
    ok: true,
    data,
    model: MODEL,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens
    },
    costUSD: Math.round(costUSD(response.usage) * 10000) / 10000
  }
}

module.exports = { extractPrices, MODEL }
