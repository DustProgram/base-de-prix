# 📋 Base de Prix — Évolutions v2.3 → v2.7.0

## ⚡ v2.7.0 — Chiffrage rapide IA, choix du fournisseur (Claude/Gemini/Mistral), page DPGF fluide

### ⚡ Chiffrage rapide IA de la DPGF (avec rapport d'hypothèses)

Nouveau bouton **« ⚡ Chiffrage rapide IA »** dans la page DPGF : l'IA chiffre les
lignes sans prix (ou toutes, au choix) en s'appuyant **exclusivement sur votre
base de prix** — jamais sur des prix de marché inventés.

- Pour chaque ligne, l'app présélectionne les meilleurs candidats de la base
  (similarité) et l'IA choisit la méthode : repère exact, moyenne/ratio,
  **proratisation dimensionnelle** (ex : porte 147×90 à chiffrer avec des portes
  200×90 et 150×90 en base → prix au m² moyen × surface cible), extrapolation
  prudente, ou « non chiffrable »
- **Rapport d'hypothèses** complet : chaque prix est accompagné de son hypothèse
  vérifiable en 10 secondes (repères utilisés, dimensions lues, calcul), avec
  confiance 🟢🟡🔴, résumé par méthode, coût API, copie en un clic
- Les lignes chiffrées portent un ⚡ (survol = hypothèse) ; toute reprise
  manuelle efface l'hypothèse ; respect du filtre « Estimer avec »
  (vente/débours/tous) ; progression par lots de 30 lignes, annulable

### 🔀 Choix du fournisseur IA : Claude, Gemini ou Mistral

Paramètres → 🤖 IA : sélecteur de fournisseur + une clé par service (chiffrées).

- **Claude** (claude-opus-5) — PDF ✅ · **Gemini** (gemini-2.5-pro) — PDF ✅ ·
  **Mistral** (mistral-large-latest) — PDF ❌ (Excel et chiffrage uniquement,
  message explicite si on lui donne un PDF)
- Vaut pour l'**Import IA** ET le **chiffrage rapide** ; sorties JSON validées
  par schéma avec relance automatique si la réponse est hors format

### 🚀 Page DPGF fluide avec des milliers de lignes

Les boutons E/R et la saisie de prix regénéraient TOUTE la liste (4000+ lignes =
plusieurs secondes de gel — sans rapport avec la sync Google Sheets, qui ne
touche pas à la DPGF) :

- Modifier une ligne ne met à jour QUE cette ligne dans la page
- Rendu paginé par tranches de 300 lignes (+1000 / tout afficher)
- Nouveau badge Σ total HT de la DPGF dans l'en-tête

---

## 🐛 v2.6.3 — Fix import DPGF « X feuilles, 0 ligne » (validé sur DPGF réelle)

Retour terrain : une DPGF de 14 feuilles était bien détectée mais **0 ligne**
n'en sortait. Deux causes cumulées, plus deux améliorations :

- **La colonne prix n'était jamais reconnue** quand l'en-tête contenait « H.T. »
  (« PRIX UNITAIRE H.T. », « PU HT »…) : l'exclusion anti-totaux rejetait `h.t`.
  Corrigé : « prix unitaire / PU » accepté avec HT/TTC ; seuls total/montant
  restent exclus.
- **Une DPGF à chiffrer (colonne prix vide) donnait 0 ligne** : depuis la
  v2.5.3, une ligne sans prix était classée « titre parent » et jamais importée.
  Un article est maintenant reconnu par : repère + désignation + (unité OU
  quantité OU prix). Les feuilles **sans colonne repère** sont aussi importées
  (avant : tout attendait un parent qui n'existait pas → 0 ligne).
- **Colonnes quantité « Q », « Q MOE », « Q ENT »** désormais reconnues (en plus
  de Qté/Quantités/Nb).
- **Détection plus stricte** : une feuille n'est proposée comme DPGF que si
  l'en-tête porte au moins 2 marqueurs (repère/unité/qté/prix) en plus de la
  désignation — les feuilles « Récap » ne sont plus des faux positifs.
- Si malgré tout 0 ligne sort, un **diagnostic par feuille** est affiché dans la
  console (Ctrl+Maj+I) pour analyse.

Validé sur la DPGF réelle du retour terrain : 13 feuilles importées,
**4022 lignes** extraites (unités + quantités), récap TCE écarté.

---

## ⚡ v2.6.2 — Second lot d'optimisations (fluidité durable jusqu'à ~20 000 prix)

- **Undo/redo** : l'état n'est plus copié en profondeur (stringify + parse ×2 par
  action, ~60 Mo de RAM sur 40 niveaux) mais stocké en une seule chaîne JSON —
  ~2× moins de travail par action, ~3× moins de mémoire
- **Sauvegarde** : l'écriture localStorage (~1,5 Mo sérialisés à chaque
  modification) est différée de 500 ms et regroupée ; écriture forcée à la
  fermeture de l'application (aucune perte possible)
- **Google Sheets** : l'« ombre » de sync n'est plus re-parsée depuis
  localStorage à chaque rafraîchissement du bandeau (cache mémoire)
- **Modale « Choisir un repère » (DPGF)** : le regroupement complet de la base
  n'est plus refait à chaque frappe (construit une fois par ouverture),
  recherche debouncée 150 ms, affichage plafonné à 250 repères
- **Écran de validation Import IA** : index doublons/anomalies pré-calculés en
  un passage (au lieu d'un parcours de base par ligne), pagination 300 lignes,
  écouteur d'édition délégué unique
- **Compteurs de lots** (sidebar) calculés en un seul passage au lieu de 14

---

## ⚡ v2.6.1 — Performances 4000+ prix, types Débours/Vente, ratios corrigés + personnalisés

### ⚡ Performances (retour terrain : 4631 prix)

Le rendu de « Tous les prix » était quadratique : pour CHAQUE ligne affichée, l'app
refaisait une recherche complète dans la base (`indexOf` + détection d'anomalie par
filtre complet), et re-générait tout le tableau à chaque frappe de recherche.

- Filtrage en un seul passage avec index conservé, détection d'anomalie via un
  index pré-calculé (O(1) par ligne)
- Recherche « debouncée » (200 ms) : plus de re-rendu à chaque caractère
- Pagination : 300 lignes affichées, boutons « +1000 » / « Tout afficher »
- Un seul écouteur d'édition délégué au lieu d'un par cellule

### 🏷 Types de prix : Débours vs Vente

Chaque prix porte désormais un type : **🧾 Débours** (devis sous-traitants, coûts
chantier) ou **💰 Vente** (DPGF prix client), ou reste « non défini ».

- Choix du type à la saisie (modale, saisie masse, Import IA — débours par défaut)
- Bouton **« 🏷 Typer le filtre »** dans Tous les prix : reclassement en masse des
  lignes filtrées (idéal pour typer l'existant par projet/lot)
- Filtre par type dans Tous les prix + colonne badge V/D triable
- **Ratios** et **estimation DPGF** calculables au choix sur : tous les prix,
  vente uniquement, ou débours uniquement (sélecteurs dédiés, mémorisés)
- Les anomalies ne comparent plus que des prix du même type (un débours face à un
  prix de vente n'est pas une anomalie, c'est une marge)
- Colonne « Type » ajoutée à la feuille Google Sheets (migration automatique de
  l'en-tête ; la première sync après mise à jour re-pousse toutes les lignes)

### 🧩 Ratios auto par type d'ouvrage — regroupement corrigé

Retour terrain : « porte bois » et « porte métallique » étaient regroupées (les mots
creux « fourniture », « pose »… gonflaient la similarité).

- **Mots creux BTP ignorés** dans le calcul de similarité
- **Matériaux incompatibles jamais regroupés** (bois ≠ métal ≠ alu ≠ PVC…)
- **Signatures techniques discriminantes** : C25/30 ≠ C30/37, CEM II ≠ CEM III,
  XC/XF, DN, diamètres, épaisseurs, EI/CF… Un béton « Ecopact C30/37 CEM III » est
  classé par sa classe technique, pas par sa marque
- **Unités normalisées** (m² = M2 = m2, FFT = forfait, PCE = u…) et **jamais
  mélangées** dans un même groupe (fini les moyennes forfait + m2)

### 🛠 Ratios personnalisés (« Mes ratios »)

Troisième vue dans la page Ratios : créez vos propres regroupements.

- Nom, lot (optionnel), unité (recommandé), **mots-clés de recherche automatique**
  dans les désignations (ex : `c30/37, cem iii`) et mots-clés d'exclusion
- Aperçu en direct, exclusion de lignes à la case à cocher, **ajout manuel** de prix
  précis via recherche — ou ratio 100 % manuel sans mots-clés
- Alerte « ⚠️ unités mélangées » si le ratio combine des unités différentes

### 🐛 Corrections

- Le titre de « Tous les prix » restait bloqué sur le dernier lot cliqué même en
  mode « tous les lots »
- La modification d'un prix (modale ✏️) perdait son identifiant stable, ce que la
  sync Google Sheets voyait comme une suppression + un ajout

---

## 🚀 v2.6.0 — Import IA, Google Sheets collaboratif, ratios par type d'ouvrage

### 🤖 Import IA (PDF / Excel → base de prix)

Nouveau module **Import IA** (sidebar → Outils) : déposez vos offres de chantier,
devis ou DPGF chiffrées (PDF, y compris scannés, ou Excel), l'API Claude
(`claude-opus-5`) en extrait les prix unitaires HT avec projet, date, unité,
et propose un lot et un repère (similarité avec la base existante).

- File d'attente multi-fichiers, traitement séquentiel, pause/reprise, coût estimé affiché par fichier
- **Écran de validation obligatoire** avant import : ⚠️ prix anormal vs historique, ♻️ doublon probable, 🔻 confiance faible, édition par double-clic
- Les Excel sont convertis en texte localement (SheetJS) pour réduire le coût API
- Clé API saisie dans Paramètres, **stockée chiffrée** (safeStorage/DPAPI), jamais exposée au renderer
- Glisser-déposer de PDF depuis n'importe quelle page

### 🟩 Liaison Google Sheets (base maître collaborative)

Alternative à la liaison Excel/NAS : une **feuille Google Sheets partagée** devient
la base maître, éditable par plusieurs utilisateurs en même temps.

- Connexion « Se connecter avec Google » (OAuth 2.0 application de bureau, PKCE, jetons chiffrés localement)
- Onglet `BASE_PRIX` créé automatiquement avec en-têtes ; chaque ligne porte un **ID stable**, l'auteur et la date de modification
- **Sync ligne à ligne** (append/update/delete ciblés) au lieu du remplacement de fichier entier : fini les écrasements croisés
- Fusion à 3 sources (local / feuille / dernier état connu) : les modifs des collègues sont adoptées, les vôtres poussées, les conflits résolus en faveur du local avec avertissement
- Vérification des modifications externes toutes les 60 s, mode hors-ligne, compteur de modifs en attente dans le bandeau, protection à la fermeture
- La liaison Excel classique reste disponible (mais exclusive : Excel OU Sheets)

### 🧩 Ratios par type d'ouvrage + tri multi-niveaux

- Page Ratios : nouveau bouton **« Par type d'ouvrage »** — les prix aux désignations
  similaires (même lot, même unité) sont regroupés automatiquement par similarité
  textuelle, même avec des repères ou chantiers différents ; moyenne/min/max/médiane/dernier
  calculés sur le groupe, détail par chantier et par date au clic
- Page Base : bouton **« Lot › Date › Chantier »** pour trier par lot, puis date (récent d'abord), puis chantier

### 🔧 Technique

- Chaque prix porte désormais un identifiant stable `id` (migration automatique, transparente)
- Nouveaux modules : `lib/` (processus principal : secrets, API Claude, Google Sheets) et `renderer/`
- Dépendances : `@anthropic-ai/sdk`, `zod`

---


**Date de livraison :** 28 avril 2026
**Version actuelle :** 2.5.3
**Compatibilité :** données v2.2 → v2.5.3 sans migration nécessaire

---

## 🔧 v2.5.3 — Import DPGF avec cellules fusionnées + sous-lignes

### 🐛 Détection des cellules fusionnées dans les en-têtes

Beaucoup de DPGF ont une cellule **"DÉSIGNATION DES OUVRAGES"** fusionnée horizontalement sur 3-4 colonnes (par exemple C, D, E). Avant cette version, l'app ne détectait que la première colonne, manquant tout le contenu des sous-colonnes.

**Maintenant :**
- Lecture des plages de fusion via SheetJS (`!merges`)
- La zone "Désignation" est traitée comme un **bloc** allant de la 1re colonne à la dernière de la fusion
- Heuristique de secours si pas de fusion explicite : extension vers la droite tant que les cellules d'en-tête sont vides

### 🌳 Gestion des articles parents et sous-lignes

Cas typique d'un DPGF :

```
Repère 2.1.2 | Clôture de chantier              ← TITRE PARENT (pas de prix)
             | a) pour le bâtiment       144 ml × 10 €
             | b) pour le parking 30     123 ml × 10 €
             | c) pour le parking 63     177 ml × 10 €
             | modifié zone unique       150 ml × 10 €
```

L'algorithme reconnaît maintenant ce schéma et importe **4 prix** rattachés au repère `2.1.2`, avec la désignation enrichie :
- `Clôture de chantier - a) pour le bâtiment`
- `Clôture de chantier - b) pour le parking 30 places`
- etc.

Résultat dans la page Ratios : le repère `2.1.2 Clôture de chantier` aura **4 prix** comparables, donc une vraie moyenne calculable.

### 🚫 Détection automatique des lignes de section

Les lignes de section (en jaune dans Excel) comme `2.1 TRAVAUX PREPARATOIRES` ou `2.2 TRAVAUX DE TERRASSEMENTS` sont **automatiquement ignorées** :
- Repère court (1-2 niveaux comme `2.1`, `2.2`)
- Texte en MAJUSCULES
- Pas de prix

Elles ne sont pas importées comme articles ni considérées comme des parents.

### 📑 Regex étendues

Plus de variantes d'en-têtes reconnues :
- **Repère** : `repère, rep, n°, n° art, numéro, art, ref, article, code, item, poste`
- **Désignation** : `design, descript, libell, article, nature, prestation, ouvrage, dénomination`
- **Unité** : `u, unité, unités, un, um`
- **Quantité** : `qt, qté, quantité, quantités, nombre, nb` (avec gestion des accents)
- **Prix** : `prix, prix unit, pu, p.u, tarif, montant` (sans confusion avec "produit HT" ou "total")

### 📊 Test grandeur nature

Validation effectuée sur un DPGF Hôtel B&B Rouen complet (12 feuilles, 233 lignes/feuille en moyenne) :
- **442 prix importés** correctement répartis
- Toutes les fusions C-E auto-détectées
- Repères avec sous-items correctement regroupés (par exemple `2.5.5` avec 7 prix, `2.6.10` avec 9 prix)

### 🎯 Lignes "art. non compris"

Les lignes marquées "art. non compris" dans la colonne Produit H.T sont importées **avec leur prix unitaire** : ce sont de vraies données prix de votre entreprise, juste pas chiffrées dans ce DPGF particulier. Elles enrichissent votre base pour les futures consultations.

---

## 🔧 v2.5.2 — Corrections détection conflit + popup anomalie

### 🐛 Bug de double-comptage des modifications corrigé

La détection de conflit affichait parfois les **mêmes modifications des deux côtés** (en local ET en externe). Causes identifiées :
- L'auto-sync mettait à jour le cache **trop tard**, créant une confusion sur la référence
- Le polling 60s rechargeait silencieusement depuis Excel, polluant le cache

**Correction :** la règle est maintenant claire et stricte :
- Le **CACHE** est la référence absolue (= état du fichier officiel au moment de notre dernière action)
- **Mes modifications** = différence entre Cache et Local (uniquement)
- **Modifications externes** = différence entre Cache et Officiel (uniquement)
- **Conflits réels** = un prix modifié des deux côtés avec des valeurs différentes

### 🚫 Polling 60s ne recharge plus jamais automatiquement

Le polling passif détectait les modifications externes et **rechargeait silencieusement** quand on n'avait pas de modif locale. Maintenant il se contente d'**alerter** (toast + bandeau de liaison violet pulsant "🌍 Modifié par un autre utilisateur"). Toute adoption d'une modification externe doit passer par la modale conflit, déclenchée à la prochaine sync (Ctrl+S).

### ⚠️ Popup riche au clic sur le ⚠️ d'anomalie

Avant : le ⚠️ orange à côté d'un prix anormal n'avait qu'un tooltip natif `"Prix anormal vs historique"`. Aucune action possible.

Maintenant, **clic sur le ⚠️** ouvre une popup détaillée avec :
- Description précise du problème (`+103% au-dessus du max historique`)
- Stats complètes pour le repère : Min / Max / Moyenne / Médiane / Nombre de prix
- Écart en % vs moyenne
- Les 3 derniers prix de référence pour comparaison
- 3 boutons d'action :
  - **Fermer** (laisser tel quel)
  - **✏️ Modifier le prix** (ouvre la modale d'édition)
  - **✅ C'est normal, ne plus afficher** (marque le prix comme normal et fait disparaître le ⚠️)

### 🔄 Marquage "C'est normal" intelligent

Le marquage est lié à la **signature exacte du prix** (incluant le montant). Si tu modifies ensuite ce prix, le marquage saute automatiquement et l'app ré-évalue : si le nouveau prix est toujours anormal, le ⚠️ revient. Tu n'as pas le risque de masquer une vraie alerte par mégarde.

### 📊 Logging console pour debug

À chaque sync, l'app affiche dans la console DevTools (Ctrl+Shift+I) :
- Le hash actuel du fichier officiel
- Le hash mémorisé du cache
- L'état "forced" ou non
- Le résultat (push OK / conflit détecté)

Très utile pour diagnostiquer si quelque chose se passe mal.

### 🎨 Bandeau de liaison enrichi

Nouvelle couleur **violette pulsante** quand le polling détecte une modification externe non encore résolue : `🌍 Modifié par un autre utilisateur` avec bouton direct **Synchroniser et résoudre**.

---

## 🔧 v2.5.1 — Corrections (28 avril 2026)

### 🐛 Détection de conflit complètement refaite

La modale de résolution de conflit n'affichait pas le détail des changements à cause de plusieurs bugs :
- `parseBaseSheet` supposait un layout fixe (ligne d'en-tête sur ligne 4) → maintenant **détection automatique** dans les 10 premières lignes
- `computeConflict` n'avait pas de `try/catch` → plantage silencieux si Excel corrompu ou feuille `BASE_PRIX` manquante
- Détection limitée aux ajouts → maintenant **6 catégories** détectées : ajouts, modifications, suppressions (locales et externes), plus les **vrais conflits** (modifié des deux côtés)
- Détail replié par défaut → maintenant **ouvert par défaut** avec sections dépliables par couleur

### 🎨 Affichage enrichi de la modale

- **Diagnostic en tête** : `Local 145 prix · Cache 142 prix · Officiel 148 prix`
- **Pour les modifications** : affiche `avant : 134,50 € → après : 142,80 €`
- **Pour les vrais conflits** : affiche `📌 base commune · 🏠 vous · 🌍 autre`
- **Messages d'erreur explicites** si feuille BASE_PRIX absente, fichier corrompu, etc.

### 🔀 Fusion intelligente plus fine

Le mode "Fusionner" gère désormais correctement :
- Vos suppressions volontaires (n'introduit pas à nouveau les prix supprimés externes)
- Vos modifications prioritaires sur les modifications externes que vous n'avez pas touchées
- Les vrais conflits : garde votre version + ajoute la version distante avec un suffixe `[autre utilisateur]` sur le projet

### 🛡️ Try/catch sur la sync

Si la sync échoue après une résolution de conflit, le toast l'indique clairement (avant : succès affiché à tort).

---

## 🛡️ v2.3 — Sécurité & robustesse

L'objectif de cette version est d'éliminer tout risque de perte de données et de gérer proprement les modifications concurrentes par plusieurs utilisateurs.

### 🔄 Cache local + détection de conflit

Quand vous liez un fichier Excel, l'application crée maintenant une **copie locale** dans `%APPDATA%\Base de Prix\cache\`. Toutes vos modifications transitent par ce cache avant d'être poussées vers le fichier officiel. Le hash SHA-256 du fichier officiel est mémorisé au moment du lien.

**Avantages :**
- Travailler hors-ligne reste possible (le fichier officiel peut être inaccessible)
- Performance améliorée (pas besoin de re-télécharger pour chaque action)
- **Détection des modifications externes** : si quelqu'un d'autre modifie le fichier pendant que vous travaillez, l'app le détecte au moment de la sync

### ⚠️ Modale de résolution de conflit (4 options)

Lorsqu'un conflit est détecté, une modale détaillée s'affiche :
- **🔀 Fusionner intelligemment** (recommandé) : garde tout, dédoublonne par signature
- **🏆 Mes modifs sont prioritaires** : ignore les ajouts externes
- **🤝 Les modifs externes sont prioritaires** : adopte la version distante (snapshot auto avant)
- **✋ Annuler** : garde vos modifs en local, ne push rien

La modale affiche le nombre d'ajouts locaux vs externes, la liste des conflits (même repère + date + projet, prix différent) et des détails dépliables pour chaque catégorie.

### 📂 Modale de choix au lien Excel (3 options)

Au lieu d'écraser silencieusement, le lien d'un fichier Excel propose maintenant :
- **📥 Charger Excel → App** : remplace les données locales par celles du fichier
- **📤 Pousser App → Excel** : écrase le fichier avec les données locales
- **🔀 Fusion intelligente** : combine les deux (dédoublonnage par signature)

### 💾 Snapshots automatiques

Avant chaque opération sensible (sync, résolution de conflit, suppression de lot, reset), un **snapshot JSON** est créé automatiquement dans `%APPDATA%\Base de Prix\snapshots\`. Les 20 derniers sont conservés.

Une nouvelle page **Historique** dans Paramètres permet de lister tous les snapshots avec date, taille et label, restaurer un snapshot d'un clic, créer un snapshot manuel à tout moment et supprimer un snapshot.

### 🚪 Confirmation de fermeture

Si vous fermez l'application avec des modifications non synchronisées, une modale propose :
- **✅ Synchroniser maintenant** (puis fermer)
- **💾 Garder en local et fermer** (sync au prochain démarrage)
- **❌ Annuler la fermeture**

Si vous n'avez aucune modif en attente, la fermeture est instantanée.

### 🌐 Mode hors-ligne automatique

Si le fichier Excel lié devient inaccessible (chantier, NAS down, OneDrive non synchronisé) :
- Bandeau orange "⚠️ Hors-ligne — sync au retour"
- L'app continue à fonctionner normalement en local
- Toutes les modifs sont mémorisées dans le cache
- Sync automatique dès que le fichier redevient accessible

### 🔍 Détection passive des modifications externes (60s)

Toutes les 60 secondes en arrière-plan (option désactivable dans Paramètres), l'app vérifie le hash du fichier officiel. Si une modification externe est détectée, le bandeau de liaison clignote en bleu pour vous alerter.

### ↩ Annulation (Ctrl+Z)

Toutes les opérations destructives (suppression, fusion, sync, résolution de conflit) sont maintenant **annulables** :
- Toast avec lien "↩ Annuler" affiché 5 secondes après l'opération
- Raccourci **Ctrl+Z** disponible partout dans l'app
- Pile de 20 niveaux d'annulation conservée par session

### 🔒 Confirmation "EFFACER" pour le reset complet

Le bouton "Réinitialiser tout" demande maintenant de **taper "EFFACER" en majuscules** pour confirmer (au lieu d'un simple OK/Annuler trop facile à cliquer par erreur). Une sauvegarde JSON automatique est créée avant la suppression.

### 💾 Sauvegarde JSON automatique au démarrage

Au démarrage de l'app, si la base contient des données, une copie JSON datée est ajoutée dans `%APPDATA%\Base de Prix\backups\`. Les 7 dernières sont conservées en rotation.

---

## 🎨 v2.4 — UX & métier

L'objectif est de rendre l'application **plus rapide à utiliser** au quotidien.

### 📊 Ratios dépliables avec détail des prix

Sur la page Ratios, cliquez sur n'importe quelle ligne pour la **déplier** et voir :
- Tous les prix qui composent le ratio (date, projet, désignation, prix, unité)
- L'**écart en %** par rapport à la moyenne (vert si <20%, orange si 20-50%, rouge si >50%)
- Stats détaillées : Min / Max / Moyenne / Médiane
- Boutons rapides ✏️ Modifier et 🗑 Supprimer pour chaque prix

Boutons globaux : "Tout déployer / Tout replier".

### 🔢 Tri des colonnes

Les colonnes des tableaux **Base** et **Ratios** sont maintenant triables (clic sur l'en-tête). Indicateurs ▲▼ visibles. Tri par défaut intelligent.

### ✏️ Édition inline dans la base

Double-cliquez sur n'importe quelle cellule éditable de la **Base** pour la modifier directement, sans ouvrir la modale d'édition. Validation par Entrée, annulation par Échap.

### 🔍 Filtres combinés

Les filtres (recherche + lot + année + projet) sont maintenant **cumulatifs** et instantanés.

### ⌨️ Raccourcis clavier

| Raccourci | Action |
|---|---|
| Ctrl+N | Ajouter un prix |
| Ctrl+F | Focus sur le champ recherche |
| Ctrl+S | Sync forcée vers Excel |
| Ctrl+Z | Annuler la dernière action |
| F2 | Édition inline du champ sélectionné |
| Échap | Fermer toutes les modales ouvertes |

### 🎯 Drag & drop fichiers

Glissez-déposez un fichier `.xlsx` ou `.xlsm` n'importe où sur la fenêtre :
- Sur la page Base → propose de lier le fichier
- Sur la page DPGF → charge le DPGF
- Overlay visuel "📁 Déposer pour..." pendant le drag

### 🔍 Détection automatique d'anomalies

Lors de la saisie d'un prix (modale ou masse), si le prix est **hors plage min-max** des prix existants pour le même repère, un indicateur ⚠️ jaune apparaît avec le détail Min/Max/Moyenne historique.

### 🎯 Suggestions intelligentes en DPGF (similarité textuelle)

Lors de l'association d'une ligne DPGF à un repère existant, l'app suggère maintenant les repères les plus proches **textuellement** (algorithme Jaccard sur les tokens de la désignation), triés par pertinence avec un indicateur ⭐.

Vous gagnez un temps considérable sur les gros DPGF (>200 lignes) car les bons repères apparaissent en tête de liste.

### 🌗 Mode sombre

Bouton 🌗 dans la barre du haut. Persistance de la préférence. Tous les modals, tableaux et formulaires sont adaptés.

### 📦 Détection de doublons à l'ajout

Lors de l'ajout d'un prix, si un prix **identique** existe déjà (même repère + date + projet + prix), l'app le détecte et propose : modifier l'existant, ajouter quand même (cas d'un vrai doublon métier), ou annuler.

---

## 🏗️ v2.5 — Personnalisation des lots

### 📋 Lots entièrement personnalisables

Les 14 lots ne sont plus codés en dur. Une nouvelle section **Paramètres → 🏗️ Gestion des lots** permet de gérer la liste complète :

#### ✏️ Renommer un lot
Migration **automatique** de tous les prix attachés. Avertissement si le lot contient des prix. Nouvelle couleur configurable.

#### ➕ Ajouter un lot
Numéro suggéré automatiquement, couleur choisie via picker, ajout immédiat dans la sidebar et les filtres.

#### 🗑 Supprimer un lot
Si le lot contient des prix, choix entre :
- **📥 Réaffecter à un autre lot** (les prix sont migrés)
- **🗑 Supprimer aussi les prix** (snapshot auto avant)

Suppression refusée s'il n'y a qu'un seul lot.

#### ⠿ Réorganiser par drag & drop
Glissez-déposez les lots pour changer leur ordre. L'ordre se reflète immédiatement dans la sidebar, les filtres et le fichier Excel généré.

#### 🎨 Recolorier un lot
Clic sur la pastille de couleur pour ouvrir le picker. Mise à jour partout instantanément.

#### 🔄 Restaurer les 14 lots par défaut
Bouton "Restaurer" en bas de la liste, avec confirmation.

### 📊 Migration et compatibilité descendante

- Les prix existants sont **migrés automatiquement** lors d'un renommage
- Le fichier Excel généré embarque une **feuille `_META`** qui contient la liste des lots et leurs couleurs
- Au lien d'un fichier Excel, l'app lit cette méta pour récupérer la définition des lots de l'autre utilisateur

---

## 🆕 Nouveaux fichiers créés à l'installation

L'application crée automatiquement le dossier suivant au premier démarrage :

```
%APPDATA%\Base de Prix\           (Windows)
├── cache\                         ← copie locale du fichier Excel lié
│   └── linked_excel.bin
├── snapshots\                     ← snapshots horodatés (20 derniers)
│   ├── snap_2026-04-28_07-12-34_demarrage.json
│   ├── snap_2026-04-28_08-45-12_avant-sync.json
│   └── ...
├── backups\                       ← backups JSON quotidiens (7 derniers)
│   └── backup_2026-04-28.json
└── logs\                          ← logs (futur)
```

Sur Mac : `~/Library/Application Support/Base de Prix/`
Sur Linux : `~/.config/Base de Prix/`

---

## ⚙️ Nouvelles préférences utilisateur

Ajoutées dans **Paramètres** :

| Préférence | Défaut | Description |
|---|---|---|
| Mode sombre | OFF | Thème sombre pour toute l'app |
| Sync auto à chaque modif | ON | Push automatique vers Excel après chaque action |
| Vérification externe (60s) | ON | Check passif du fichier officiel en arrière-plan |
| Snapshots automatiques | ON | Création de snapshots avant opérations sensibles |

---

## 🔧 Améliorations techniques sous le capot

### Architecture
- **Hash SHA-256** calculé côté Node.js pour fiabilité
- **IPC isolation** maintenue (contextBridge, pas de nodeIntegration)
- **Sécurité chemins** : `safeRelPath()` interdit les `..` et chemins absolus
- **Gestion fermeture asynchrone** : intercept de `window.close`, attente de la confirmation renderer (timeout 10s par sécurité)

### Performance
- Cache local évite la relecture complète du fichier Excel à chaque sync
- Polling externe paramétrable (60s par défaut, désactivable)
- Debounce sur les opérations de sync rapprochées

### Fiabilité
- Pile d'undo de 20 niveaux par session
- Snapshots automatiques avant toute opération destructive
- 7 backups JSON quotidiens en rotation
- Validation des paths contre l'évasion de répertoire

---

## 🚀 Migration depuis la v2.2

**Aucune action requise.** L'application v2.5 :

1. Lit votre `localStorage` v2.2 (base de prix, préférences, lots) tel quel
2. Initialise les nouveaux dossiers `cache/`, `snapshots/`, `backups/`, `logs/`
3. Si vous aviez un fichier Excel lié, fait un snapshot initial dans le cache
4. Régénère les couleurs des lots si elles manquent

**Première sync après installation** : un snapshot complet est créé avant tout push, et le hash du fichier officiel est mémorisé. Les sync suivantes utiliseront le système de détection de conflit.

---

## 📝 Reste à venir (v2.6 et suivantes)

Évolutions discutées mais reportées :
- **Mode Google Sheets** : connexion OAuth2 + sync temps réel via API Sheets (en alternative au mode Excel)
- **Coefficient d'actualisation** : facultatif, à activer manuellement par projet
- **Connecteurs OneDrive/SharePoint** natifs (au-delà du simple chemin réseau)
- **Refactoring TypeScript** + tests automatisés
- **Crash reporter** (Sentry ou équivalent)

---

## 🛠️ Build & déploiement

### Lancement en développement
```bash
cd BasePrix-v2-5
npm install
npm start
```

### Build de l'installeur Windows
```bash
npm run build
# Génère :
# - dist\Base de Prix Setup 2.5.0.exe (NSIS classique, ~100 Mo)
# - dist\Base de Prix Web Setup 2.5.0.exe (NSIS-Web, ~2 Mo + DL automatique)
```

### Publication GitHub Release (auto-update)
```bash
# Sur le repo DustProgram/base-de-prix
git tag v2.5.0
git push origin v2.5.0
npm run publish
# Le latest.yml est généré automatiquement dans la release
# Les utilisateurs en v2.2+ recevront la notification de mise à jour
```

---

## 📄 Auteur

**Nathan RAMEDACE**
Avril 2026
