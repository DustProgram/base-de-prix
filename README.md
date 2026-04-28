# Base de Prix & DPGF

Application Electron de gestion de base de prix BTP et de DPGF (Décomposition du Prix Global et Forfaitaire), avec liaison Excel bidirectionnelle, détection de conflits et auto-update.

**Version actuelle :** 2.5.0
**Auteur :** Nathan RAMEDACE

---

## 📥 Installation

Téléchargez le dernier installeur Windows depuis la page [Releases](https://github.com/DustProgram/base-de-prix/releases) :

- **`Base de Prix Setup X.Y.Z.exe`** : installeur classique (~100 Mo, hors ligne)
- **`Base de Prix Web Setup X.Y.Z.exe`** : installeur web (~2 Mo, télécharge le reste)

Une fois installée, l'application se met à jour automatiquement à chaque nouvelle release.

---

## ✨ Fonctionnalités principales

### Base de prix
- 14 lots BTP personnalisables (renommer, réordonner, ajouter, supprimer)
- Saisie manuelle, en masse, ou par import Excel
- Détection automatique d'anomalies (prix hors plage)
- Détection de doublons à l'ajout

### DPGF
- Import multi-feuilles Excel
- Suggestions intelligentes par similarité textuelle (Jaccard)
- Association rapide des repères existants
- Export Excel avec mise en forme

### Synchronisation Excel
- Liaison bidirectionnelle avec un fichier Excel maître
- Cache local pour travail hors-ligne
- Détection de conflits avec hash SHA-256
- Modale de résolution de conflit (4 stratégies)
- Préservation des macros (.xlsm)

### Sécurité & robustesse
- Snapshots automatiques (20 derniers)
- Sauvegardes JSON quotidiennes (7 derniers)
- Annulation Ctrl+Z (20 niveaux)
- Confirmation de fermeture si modifs non sauvegardées

### UX
- Mode sombre
- Tri des colonnes
- Édition inline
- Drag & drop fichiers
- Raccourcis clavier (Ctrl+N/F/S/Z, F2, Échap)
- Ratios dépliables avec détail des prix

---

## 🛠️ Développement

### Pré-requis
- Node.js 18+ ([télécharger](https://nodejs.org))
- npm (livré avec Node)

### Lancement local
```bash
git clone https://github.com/DustProgram/base-de-prix.git
cd base-de-prix
npm install
npm start
```

### Build de l'installeur
```bash
npm run build
# Génère dist/Base de Prix Setup X.Y.Z.exe
```

### Publication d'une release
```bash
# Définir le token GitHub (une fois)
$env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxx"
npm run publish
```

Ou simplement double-cliquer sur `publier.bat`.

---

## 📋 Changelog

Voir [CHANGELOG.md](./CHANGELOG.md).

---

## 📄 Licence

MIT — Nathan RAMEDACE
