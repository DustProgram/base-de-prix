// Couche IA multi-fournisseurs : Claude (SDK Anthropic), Gemini (REST) et
// Mistral (REST). Tourne dans le processus principal — les clés API ne sont
// jamais exposées au renderer. Deux usages : extraction de prix depuis des
// documents, et chiffrage rapide d'une DPGF contre la base de prix.
const { z } = require('zod')
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod')
let Anthropic = require('@anthropic-ai/sdk')
Anthropic = Anthropic.default || Anthropic

const PROVIDERS = {
  claude:  { label: 'Claude (Anthropic)', model: 'claude-opus-5',          keyName: 'anthropic_api_key', priceIn: 5,    priceOut: 25, pdf: true },
  gemini:  { label: 'Gemini (Google)',    model: 'gemini-3.1-pro-preview', keyName: 'gemini_api_key',    priceIn: 1.25, priceOut: 10, pdf: true },
  mistral: { label: 'Mistral',            model: 'mistral-large-latest',   keyName: 'mistral_api_key',   priceIn: 2,    priceOut: 6,  pdf: false }
}
// Tarifs USD / million de tokens : INDICATIFS (affichage), à jour au mieux.

/* ★ v2.7.1 — les noms de modèles bougent côté fournisseurs ("no longer
   available", paliers d'abonnement…). Le modèle est donc :
   1. celui configuré par l'utilisateur (Paramètres, transmis par appel),
   2. sinon celui appris pendant la session (bascule automatique réussie),
   3. sinon le défaut ci-dessus.
   En cas d'erreur "modèle indisponible", on retente UNE fois avec le modèle
   suggéré par l'API (Gemini) ou un modèle du palier gratuit (Mistral), et on
   mémorise ce qui marche pour les appels suivants. */
const runtimeModel = {}
function sanitizeModel(m) {
  m = String(m || '').trim()
  return /^[a-zA-Z0-9._\/-]{3,80}$/.test(m) ? m : ''
}
function pickModel(provider, wanted) {
  return sanitizeModel(wanted) || runtimeModel[provider] || PROVIDERS[provider].model
}
// Modèle de repli quand l'erreur indique un problème de disponibilité
function fallbackModelFor(provider, currentModel, errMsg) {
  if (provider === 'gemini' && /no longer available|not found|not supported|deprecated/i.test(errMsg)) {
    const names = [...errMsg.matchAll(/models\/([a-zA-Z0-9._-]{3,80})/g)].map(m => m[1])
    return names.find(n => n !== currentModel) || null
  }
  if (provider === 'mistral' && /subscription tier|not available|invalid model|no access/i.test(errMsg)) {
    return currentModel !== 'mistral-small-latest' ? 'mistral-small-latest' : null
  }
  return null
}

const MAX_PDF_BYTES = 19 * 1024 * 1024 // Gemini inline ~20 Mo ; Claude 30 Mo (borné au plus strict commun)

function costUSD(provider, inTok, outTok) {
  const p = PROVIDERS[provider]
  return Math.round((inTok / 1e6 * p.priceIn + outTok / 1e6 * p.priceOut) * 10000) / 10000
}

/* ============================================================
   TRANSPORTS — chaque fournisseur renvoie { data, usage:{in,out} }
   ou lève une Error avec message utilisateur.
   ============================================================ */

async function callClaude({ apiKey, model, system, text, pdfBase64, zodSchema, maxTokens }) {
  const client = new Anthropic({ apiKey, maxRetries: 3 })
  const content = []
  if (pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } })
  content.push({ type: 'text', text })
  let response
  try {
    response = await client.messages.parse({
      model: model || PROVIDERS.claude.model,
      max_tokens: maxTokens || 32000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(zodSchema) }
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Clé API Claude invalide ou révoquée (Paramètres).')
    if (err instanceof Anthropic.RateLimitError) throw new Error('Limite de débit Claude atteinte, réessayez dans quelques minutes.')
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Connexion à l\'API Claude impossible (réseau/proxy).')
    if (err instanceof Anthropic.APIError) throw new Error(`Erreur API Claude (${err.status}) : ${err.message}`)
    throw err
  }
  if (response.stop_reason === 'refusal') throw new Error('L\'API Claude a refusé de traiter ce contenu.')
  if (response.stop_reason === 'max_tokens') throw new Error('Réponse tronquée (document trop long) — scindez le fichier ou réduisez le lot.')
  if (!response.parsed_output) throw new Error('Réponse Claude illisible (JSON invalide), réessayez.')
  return {
    data: response.parsed_output,
    usage: { in: response.usage.input_tokens, out: response.usage.output_tokens }
  }
}

// Schéma JSON compact injecté dans le prompt pour Gemini/Mistral
function schemaPromptBlock(zodSchema) {
  const js = z.toJSONSchema(zodSchema)
  delete js.$schema
  return `\n\nRéponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, pas de bloc markdown) respectant STRICTEMENT ce schéma JSON :\n${JSON.stringify(js)}`
}

function parseAndValidate(rawText, zodSchema, providerLabel) {
  let txt = String(rawText || '').trim()
  // Certains modèles emballent malgré tout dans ```json … ```
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) txt = fence[1].trim()
  let obj
  try { obj = JSON.parse(txt) } catch (e) {
    throw new Error(`Réponse ${providerLabel} illisible (JSON invalide).`)
  }
  const parsed = zodSchema.safeParse(obj)
  if (!parsed.success) throw new Error(`Réponse ${providerLabel} hors schéma : ${parsed.error.issues[0] ? parsed.error.issues[0].path.join('.') + ' — ' + parsed.error.issues[0].message : 'inconnu'}`)
  return parsed.data
}

async function callGemini({ apiKey, model, system, text, pdfBase64, zodSchema }) {
  model = model || PROVIDERS.gemini.model
  const parts = []
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } })
  parts.push({ text: text + schemaPromptBlock(zodSchema) })
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 32768 }
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Clé API Gemini invalide (Paramètres).')
    if (res.status === 429) throw new Error('Limite de débit Gemini atteinte, réessayez dans quelques minutes.')
    throw new Error(`Erreur API Gemini : ${msg}`)
  }
  const cand = json.candidates && json.candidates[0]
  if (!cand || !cand.content || !cand.content.parts) {
    const block = json.promptFeedback && json.promptFeedback.blockReason
    throw new Error(block ? `Gemini a refusé le contenu (${block}).` : 'Réponse Gemini vide.')
  }
  const raw = cand.content.parts.map(p => p.text || '').join('')
  const um = json.usageMetadata || {}
  return {
    data: parseAndValidate(raw, zodSchema, 'Gemini'),
    usage: { in: um.promptTokenCount || 0, out: um.candidatesTokenCount || 0 }
  }
}

async function callMistral({ apiKey, model, system, text, pdfBase64, zodSchema }) {
  if (pdfBase64) throw new Error('Mistral ne lit pas les PDF dans cette application — utilisez Claude ou Gemini pour les PDF (Mistral reste utilisable pour les Excel et le chiffrage).')
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || PROVIDERS.mistral.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text + schemaPromptBlock(zodSchema) }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 32768,
      temperature: 0.1
    })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json.message || (json.error && json.error.message)) || `HTTP ${res.status}`
    if (res.status === 401) throw new Error('Clé API Mistral invalide (Paramètres).')
    if (res.status === 429) throw new Error('Limite de débit Mistral atteinte, réessayez dans quelques minutes.')
    throw new Error(`Erreur API Mistral : ${msg}`)
  }
  const raw = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
  const u = json.usage || {}
  return {
    data: parseAndValidate(raw, zodSchema, 'Mistral'),
    usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 }
  }
}

// Appel structuré générique : relance sur JSON hors schéma, et bascule
// automatique de modèle quand l'API signale un modèle indisponible.
async function aiStructured({ provider, apiKey, model, system, text, pdfBase64, zodSchema, maxTokens }) {
  const fn = provider === 'gemini' ? callGemini : provider === 'mistral' ? callMistral : callClaude
  let currentModel = pickModel(provider, model)
  let modelNote = ''
  let triedFallback = false
  let lastErr

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fn({ apiKey, model: currentModel, system, text, pdfBase64, zodSchema, maxTokens })
      runtimeModel[provider] = currentModel // ce modèle marche → mémoriser pour la session
      return { ...r, modelUsed: currentModel, modelNote }
    } catch (e) {
      lastErr = e
      // 1. Modèle indisponible → basculer UNE fois sur le modèle suggéré/de repli
      const fb = !triedFallback && fallbackModelFor(provider, currentModel, e.message)
      if (fb) {
        triedFallback = true
        modelNote = `Modèle « ${currentModel} » indisponible → bascule automatique sur « ${fb} »`
        currentModel = fb
        continue
      }
      // 2. Réponse illisible/hors schéma → une relance simple
      if (/illisible|hors schéma|vide/i.test(e.message)) continue
      throw e
    }
  }
  throw lastErr
}

/* ============================================================
   EXTRACTION DE PRIX (Import IA)
   ============================================================ */

const LigneSchema = z.object({
  repere: z.string().describe("Code/repère article si présent dans le document (ex: PV-001, 2.1.4), sinon chaîne vide"),
  designation: z.string().describe("Désignation de l'ouvrage, complète mais concise, sans le prix ni la quantité"),
  lot: z.string().describe('Lot BTP choisi EXACTEMENT dans la liste fournie (recopier la ligne entière)'),
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

function buildExtractionSystem(lots) {
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

async function extractPrices({ provider = 'claude', apiKey, model, kind, base64, text, filename, lots, hints }) {
  if (kind === 'pdf') {
    if (!base64) return { ok: false, error: 'PDF vide' }
    if (base64.length * 0.75 > MAX_PDF_BYTES) {
      return { ok: false, error: 'PDF trop volumineux (> 19 Mo pour ce fournisseur). Scindez-le en plusieurs fichiers.' }
    }
  } else if (!text || !text.trim()) {
    return { ok: false, error: 'Aucun contenu texte à analyser' }
  }

  let userText = `Document à dépouiller : "${filename || 'document'}"`
  if (hints && hints.projet) userText += `\nProjet/chantier probable : ${hints.projet}`
  if (hints && hints.date) userText += `\nDate probable du document : ${hints.date}`
  if (kind !== 'pdf') userText += `\n\nContenu du document (extrait du fichier Excel, une section par feuille) :\n\n${text}`
  userText += `\n\nExtrais tous les prix unitaires selon les règles.`

  try {
    const r = await aiStructured({
      provider, apiKey, model,
      system: buildExtractionSystem(lots || []),
      text: userText,
      pdfBase64: kind === 'pdf' ? base64 : undefined,
      zodSchema: ExtractionSchema
    })
    return {
      ok: true,
      data: r.data,
      provider,
      model: r.modelUsed,
      modelNote: r.modelNote || '',
      usage: { input_tokens: r.usage.in, output_tokens: r.usage.out },
      costUSD: costUSD(provider, r.usage.in, r.usage.out)
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/* ============================================================
   CHIFFRAGE RAPIDE DPGF
   Le renderer envoie un lot de lignes DPGF non chiffrées + un extrait
   ciblé de la base (candidats par similarité). Le modèle renvoie un prix,
   la méthode et l'HYPOTHÈSE prise, par ligne.
   ============================================================ */

const ChiffrageSchema = z.object({
  lignes: z.array(z.object({
    index: z.number().describe('Recopier l\'index de la ligne DPGF fourni'),
    prix: z.number().nullable().describe('Prix unitaire HT proposé en euros, ou null si non chiffrable'),
    methode: z.enum(['repere_exact', 'moyenne_ratio', 'proratisation_dimensionnelle', 'extrapolation', 'non_chiffrable'])
      .describe('Comment le prix a été construit'),
    repere_source: z.string().describe('Repère(s) de la base utilisé(s), séparés par des virgules, ou chaîne vide'),
    hypothese: z.string().describe('Hypothèse prise, en une ou deux phrases claires (dimensions, ratio utilisé, ajustements…)'),
    confiance: z.enum(['haute', 'moyenne', 'basse'])
  }))
})

const CHIFFRAGE_SYSTEM = `Tu es un économiste de la construction. Tu chiffres rapidement des lignes de DPGF en t'appuyant EXCLUSIVEMENT sur la base de prix interne fournie (extraits "CANDIDATS" par ligne). Tu n'inventes JAMAIS un prix de marché : tout prix doit se déduire de la base.

Méthodes autorisées, de la plus sûre à la moins sûre :
1. repere_exact — un candidat correspond au même ouvrage, même unité : reprendre son prix (dernier ou moyenne si plusieurs).
2. moyenne_ratio — plusieurs candidats du même type d'ouvrage : utiliser leur moyenne.
3. proratisation_dimensionnelle — les candidats sont le même ouvrage à d'autres dimensions : ramener à un prix par m² (ou ml) à partir des dimensions présentes dans les désignations, puis multiplier par la surface/longueur de la ligne à chiffrer. Exemple : portes 200x90 et 150x90 en base → prix/m² moyen de porte → × surface de la porte 147x90 demandée. Détaille le calcul dans l'hypothèse.
4. extrapolation — candidat proche mais ouvrage différent (variante de matériau, complexité) : ajuster avec prudence et le DIRE dans l'hypothèse.
5. non_chiffrable — aucun candidat pertinent : prix null et hypothèse expliquant ce qui manque.

Règles :
- Ne mélange jamais des unités incompatibles (un prix au m² ne chiffre pas une ligne au forfait sans le signaler en extrapolation basse confiance).
- L'hypothèse doit permettre à un économiste de vérifier le calcul en 10 secondes (cite les repères, les dimensions lues et le ratio).
- Prix HT en euros, nombres avec point décimal.
- Recopie exactement l'index fourni pour chaque ligne.`

async function chiffrerLignes({ provider = 'claude', apiKey, model, lignes, projet }) {
  // lignes : [{index, descriptif, unite, qte, candidats:[{rep, desg, unite, moy, min, max, dern, cnt}]}]
  let text = `Chantier à chiffrer : ${projet || '(non précisé)'}\n\n`
  text += lignes.map(l => {
    const cands = (l.candidats || []).map(c =>
      `    - [${c.rep}] "${c.desg}" | ${c.unite} | moy ${c.moy} € | min ${c.min} € | max ${c.max} € | dernier ${c.dern} € | ${c.cnt} prix`
    ).join('\n') || '    (aucun candidat trouvé dans la base)'
    return `LIGNE index=${l.index}\n  Descriptif : ${l.descriptif}\n  Unité : ${l.unite || '?'} · Quantité : ${l.qte || '?'}\n  CANDIDATS de la base :\n${cands}`
  }).join('\n\n')
  text += '\n\nChiffre chaque ligne selon les règles.'

  try {
    const r = await aiStructured({
      provider, apiKey, model,
      system: CHIFFRAGE_SYSTEM,
      text,
      zodSchema: ChiffrageSchema,
      maxTokens: 16000
    })
    return {
      ok: true,
      data: r.data,
      provider,
      model: r.modelUsed,
      modelNote: r.modelNote || '',
      usage: { input_tokens: r.usage.in, output_tokens: r.usage.out },
      costUSD: costUSD(provider, r.usage.in, r.usage.out)
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

module.exports = { PROVIDERS, extractPrices, chiffrerLignes }
