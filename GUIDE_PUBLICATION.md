# 🚀 Guide de publication — Base de Prix v2.5.0

Ce guide te montre **chaque étape** depuis ton poste actuel jusqu'à la release publiée et l'auto-update fonctionnel chez les utilisateurs.

**Temps total estimé :** 30-45 minutes la première fois, 5 minutes les fois suivantes.

---

## 📋 Pré-requis

Avant de commencer, vérifie que tu as :

- [x] **Windows** avec PowerShell
- [x] Compte **GitHub** avec accès au repo `DustProgram/base-de-prix`
- [x] Le dossier **`BasePrix-v2-5`** sur ton disque (les 6 fichiers livrés)

À installer si manquant :

- [ ] **Node.js 18 ou 20** (pas 22+) → https://nodejs.org/fr/download → "LTS"
- [ ] **Git for Windows** → https://git-scm.com/download/win

Pour vérifier ce qui est déjà installé, ouvre **PowerShell** (touche Windows → tape "powershell") et lance :

```powershell
node --version
npm --version
git --version
```

Tu dois voir trois numéros de version. Si une commande dit "non reconnue", il faut installer le logiciel correspondant.

---

## ÉTAPE 1 — Créer un Personal Access Token GitHub

Cette étape ne se fait **qu'une seule fois**. Le token permet à ton PC de publier des releases sur GitHub sans entrer ton mot de passe à chaque fois.

### 1.1 Aller sur la page des tokens

1. Connecte-toi sur https://github.com
2. En haut à droite : clique sur ton avatar → **Settings**
3. Dans le menu de gauche, descends tout en bas → **Developer settings**
4. Clique sur **Personal access tokens** → **Tokens (classic)**
5. Clique sur **Generate new token** → **Generate new token (classic)**

### 1.2 Configurer le token

- **Note** (description) : `electron-builder publish base de prix`
- **Expiration** : `No expiration` (ou 1 an si tu préfères)
- **Scopes à cocher** :
  - ☑ **`repo`** (toute la section avec ses sous-cases)
  - ☑ **`write:packages`** (optionnel mais utile)

Clique en bas sur **Generate token**.

### 1.3 Copier le token IMMÉDIATEMENT

GitHub affiche le token UNE SEULE FOIS, sous la forme :

```
ghp_aBcD1234EfGh5678IjKl9012MnOp3456QrSt
```

⚠️ **Copie-le tout de suite** dans un endroit sûr (gestionnaire de mots de passe, fichier texte protégé). Si tu le perds, il faudra en regénérer un.

### 1.4 Enregistrer le token dans Windows

Ouvre **PowerShell** et exécute (en remplaçant `ghp_xxx` par ton vrai token) :

```powershell
[Environment]::SetEnvironmentVariable("GH_TOKEN", "ghp_TON_TOKEN_ICI", "User")
```

⚠️ **Ferme et rouvre PowerShell** après cette commande pour qu'elle soit prise en compte.

Pour vérifier que c'est bon, dans le nouveau PowerShell :

```powershell
echo $env:GH_TOKEN
```

Tu dois voir ton token s'afficher.

---

## ÉTAPE 2 — Préparer le dossier du projet

### 2.1 Choisir un emplacement

Crée un dossier permanent pour le projet, par exemple :

```
C:\Dev\BasePrix\
```

### 2.2 Copier les fichiers de la v2.5

Copie les 7 fichiers que je t'ai livrés dans ce dossier :

```
C:\Dev\BasePrix\
├── index.html
├── main.js
├── preload.js
├── package.json
├── CHANGELOG.md
├── README.md
└── publier.bat
```

### 2.3 Ajouter une icône

Place une icône `icon.png` (256×256 minimum, idéalement 512×512) dans ce même dossier. Sans icône, le build échouera.

Si tu n'en as pas encore, tu peux temporairement utiliser celle de la v2.2.

---

## ÉTAPE 3 — Premier setup Git (uniquement si le repo n'est pas encore cloné)

Si tu as déjà cloné `base-de-prix` depuis GitHub, **saute à l'étape 4**.

### 3.1 Cloner le repo

Dans PowerShell :

```powershell
cd C:\Dev
git clone https://github.com/DustProgram/base-de-prix.git BasePrix
cd BasePrix
```

### 3.2 Configurer ton identité Git

```powershell
git config user.name "Nathan RAMEDACE"
git config user.email "ton_email@exemple.com"
```

### 3.3 Copier les fichiers v2.5 dans ce dossier

Copie/colle les 7 fichiers livrés dans `C:\Dev\BasePrix\` (ils écraseront les anciennes versions).

---

## ÉTAPE 4 — Installer les dépendances Node

Dans PowerShell, depuis le dossier du projet :

```powershell
cd C:\Dev\BasePrix
npm install
```

Cette commande télécharge Electron, electron-builder et electron-updater. Elle prend **3 à 8 minutes** la première fois et crée un dossier `node_modules` (gros, ~500 Mo).

⚠️ **Si npm install affiche des erreurs**, le plus souvent c'est :
- Un proxy d'entreprise → demande la config à ton informaticien
- Une version de Node trop récente (Node 22 a parfois des soucis avec electron-builder) → installer Node 20 LTS

---

## ÉTAPE 5 — Tester l'app en local AVANT de publier

C'est crucial : **ne publie jamais sans avoir testé l'app sur ton poste**.

### 5.1 Lancer en mode développement

```powershell
npm start
```

Une fenêtre Electron doit s'ouvrir avec l'app.

### 5.2 Tester les nouveautés v2.5

À tester impérativement :
- ☑ Les anciennes données v2.2 sont toujours là
- ☑ Aller dans **Paramètres → Gestion des lots** : essayer de renommer un lot, le réordonner par drag-drop
- ☑ Page **Ratios** : cliquer sur une ligne pour la déplier
- ☑ Activer le **mode sombre** (bouton 🌗 en haut à droite)
- ☑ Faire **Ctrl+N** pour ajouter un prix → vérifier que la modale s'ouvre
- ☑ Lier un fichier Excel → vérifier que la modale "Excel/App/Fusion" apparaît
- ☑ Modifier un prix → vérifier que le toast "↩ Annuler" apparaît, cliquer dessus

### 5.3 Fermer l'app

Utilise la croix de la fenêtre. Si tu as des modifs non syncées, la modale de confirmation de fermeture doit apparaître.

**Si tout fonctionne**, on peut publier. Si quelque chose plante, ne publie pas et reviens vers moi avec le message d'erreur.

---

## ÉTAPE 6 — Mettre à jour le code source sur GitHub (optionnel mais recommandé)

Cette étape archive ton code v2.5 sur GitHub. Elle n'est pas obligatoire pour publier la release, mais elle est fortement recommandée pour ne pas perdre le code.

```powershell
cd C:\Dev\BasePrix
git add .
git commit -m "v2.5.0 - Cache local, conflits, lots dynamiques, dark mode"
git push origin main
```

Si Git te demande tes identifiants : utilise ton login GitHub et **ton token GH_TOKEN comme mot de passe** (pas ton mot de passe GitHub).

---

## ÉTAPE 7 — Créer un tag Git pour la version

Le tag est ce qui marque officiellement "voici le commit qui correspond à la v2.5.0".

```powershell
git tag v2.5.0
git push origin v2.5.0
```

⚠️ Le tag doit commencer par `v` minuscule suivi de la version exacte du `package.json` (ici `2.5.0`).

---

## ÉTAPE 8 — Publier la release

### 8.1 Méthode simple : double-cliquer sur publier.bat

Dans l'explorateur Windows, va dans `C:\Dev\BasePrix\` et **double-clique sur `publier.bat`**.

Le script va :
1. Vérifier que `GH_TOKEN` est défini
2. Te demander de confirmer la version
3. Lancer le build
4. Publier sur GitHub

Si le script affiche "ERREUR", lis le message et corrige le problème.

### 8.2 Méthode manuelle (si publier.bat ne marche pas)

Dans PowerShell :

```powershell
cd C:\Dev\BasePrix
npm run publish
```

### 8.3 Pendant le build (5-10 minutes)

Tu vas voir défiler beaucoup de logs :
- Téléchargement d'Electron
- Compilation
- Création des installeurs
- Upload sur GitHub

À la fin, tu dois voir :
```
• building        target=nsis
• building        target=nsis-web
• publishing      file=Base de Prix Setup 2.5.0.exe
• publishing      file=Base de Prix Web Setup 2.5.0.exe
• publishing      file=latest.yml
```

Le mot **`latest.yml`** est CRUCIAL. Sans ce fichier, l'auto-update ne fonctionnera pas.

---

## ÉTAPE 9 — Finaliser la release sur GitHub

### 9.1 Aller sur GitHub Releases

Ouvre dans ton navigateur :
https://github.com/DustProgram/base-de-prix/releases

### 9.2 Trouver la release "Draft"

Tu dois voir une release **`v2.5.0`** avec un badge **"Draft"** orange.

⚠️ Tant qu'elle reste en Draft, elle est invisible pour les utilisateurs et l'auto-update ne se déclenche pas.

### 9.3 Cliquer sur "Edit"

Sur la release draft, clique le bouton **Edit** (ou l'icône crayon).

### 9.4 Remplir les notes de version

Dans la zone "Describe this release", colle un résumé du CHANGELOG. Exemple court :

```markdown
## Nouveautés v2.5.0

### 🛡️ Sécurité
- Cache local + détection de conflit par hash SHA-256
- Modale de résolution de conflit (4 options)
- Snapshots automatiques (20 derniers)
- Confirmation de fermeture si modifs non sauvegardées
- Annulation Ctrl+Z (20 niveaux)

### 🎨 UX
- Mode sombre
- Ratios dépliables avec détail des prix
- Tri des colonnes, édition inline
- Drag & drop fichiers
- Raccourcis clavier
- Suggestions intelligentes en DPGF

### 🏗️ Personnalisation
- Lots renommables, réorganisables par drag-drop
- Ajout/suppression de lots avec migration auto

Voir CHANGELOG.md pour le détail complet.
```

### 9.5 Vérifier les fichiers attachés (assets)

Tout en bas du formulaire, dans la section **Assets**, tu dois voir au minimum :

- `Base de Prix Setup 2.5.0.exe`
- `Base de Prix Web Setup 2.5.0.exe`
- **`latest.yml`** ← OBLIGATOIRE pour auto-update
- `Base de Prix Setup 2.5.0.exe.blockmap` (généré automatiquement)
- `Base de Prix Web Setup 2.5.0.exe.blockmap`

⚠️ Si **`latest.yml` est manquant**, l'auto-update ne marchera pas. Dans ce cas, refais le `npm run publish` ou ajoute le fichier manuellement (il a été généré dans `C:\Dev\BasePrix\dist\latest.yml`).

### 9.6 Publier la release

Clique le gros bouton vert **"Publish release"** en bas.

🎉 **C'est fait !** La release est maintenant publique.

---

## ÉTAPE 10 — Tester l'auto-update

### 10.1 Sur ton poste

L'app que tu as lancée pour tester l'étape 5 est en mode développement → elle ne déclenche pas l'auto-update. Pour tester réellement, il faut installer la version compilée.

Dans `C:\Dev\BasePrix\dist\` tu trouveras :
- `Base de Prix Setup 2.5.0.exe`

Mais comme c'est la même version que ce que GitHub propose, tu ne verras pas de notification de mise à jour.

### 10.2 Le vrai test : sur un poste utilisateur

Sur un PC qui a déjà une **ancienne version** installée (v2.2, v2.3 ou v2.4) :

1. Lancer l'app
2. Attendre 5-10 secondes
3. Une modale doit apparaître : **"Mise à jour disponible (v2.5.0)"**
4. Cliquer sur **"Télécharger maintenant"**
5. Attendre la fin du téléchargement (barre de progression dans la modale ou silencieux)
6. Une seconde modale apparaît : **"Mise à jour prête"**
7. Cliquer sur **"Redémarrer maintenant"**
8. L'app se ferme, s'installe, redémarre en v2.5.0

### 10.3 Si l'auto-update ne se déclenche pas

Causes possibles :

| Symptôme | Cause | Solution |
|---|---|---|
| Aucune modale après 30 secondes | `latest.yml` absent | Vérifie sur GitHub Releases que le fichier est bien attaché |
| Erreur "404 Not Found" dans les logs | URL mal configurée | Vérifie `package.json` → `publish.repo` = `base-de-prix` |
| "Update not available" | Version pas plus récente | Vérifie que `package.json` → `version` = `2.5.0` (pas `2.4.x`) |
| Modale apparaît mais téléchargement plante | Fichier `.exe` corrompu | Republier la release |

Pour voir les logs en clair sur le poste utilisateur :
- `Win+R` → `%APPDATA%\Base de Prix\logs\`
- Ou faire `Ctrl+Shift+I` dans l'app pour ouvrir la console développeur

---

## 🎯 Récap visuel

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│   1. Token GitHub      ──┐                              │
│   2. Préparer dossier  ──┤                              │
│   3. (Cloner repo)     ──┤   Premier setup              │
│   4. npm install       ──┘                              │
│                                                          │
│   5. npm start (test)  ──┐                              │
│   6. git push          ──┤                              │
│   7. git tag v2.5.0    ──┤   À chaque nouvelle release  │
│   8. publier.bat       ──┤                              │
│   9. Publish release   ──┘                              │
│                                                          │
│   10. Test auto-update                                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## ❓ Questions fréquentes

**Q : Faut-il refaire toutes ces étapes pour la v2.6 ?**
R : Non. Seulement les étapes 5 à 9 (test, push, tag, publier.bat, finaliser). Les 4 premières sont uniquement pour le premier setup.

**Q : Le token GH_TOKEN expire ?**
R : Si tu as choisi "No expiration" → jamais. Sinon il expirera à la date choisie et il faudra en regénérer un.

**Q : Que se passe-t-il si je publie deux fois la même version ?**
R : GitHub refuse. Il faut soit incrémenter la version dans `package.json`, soit supprimer la release existante avant.

**Q : Mes utilisateurs vont-ils être obligés de mettre à jour ?**
R : Non, ils peuvent cliquer "Plus tard". À chaque démarrage, la notification réapparaîtra tant qu'ils n'ont pas mis à jour.

**Q : Comment annuler une release publiée ?**
R : Sur GitHub, va sur la release → Edit → coche "Mark as pre-release" pour la cacher. Mais l'auto-update aura déjà notifié les utilisateurs en ligne.

---

**Auteur du guide :** Claude pour Nathan RAMEDACE — Avril 2026
