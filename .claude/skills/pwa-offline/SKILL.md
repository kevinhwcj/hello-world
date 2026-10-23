---
name: pwa-offline
description: Crée une application web installable depuis Chrome (PWA) qui fonctionne hors ligne et garde ses données sur l'appareil (localStorage / IndexedDB), puis vérifie automatiquement l'installabilité, le hors-ligne et la persistance. À utiliser dès que l'utilisateur veut une "app" ou un petit outil sur son téléphone ou son PC (compteur, liste, tracker, chronomètre, carnet, jeu…) qui soit installable, "marche sans internet / hors ligne", "garde en mémoire" ou "ne perde rien si je rafraîchis", même s'il ne dit ni "PWA" ni "service worker". Aussi pour rendre un site existant installable ou hors ligne, ou pour diagnostiquer pourquoi Chrome ne propose pas "Installer l'application". English - installable PWA, offline-first, service worker, web app manifest, localStorage/IndexedDB persistence, add to home screen.
---

# PWA hors ligne avec mémoire locale

Une PWA est un site statique que Chrome sait installer comme une app : icône sur l'écran d'accueil, plein écran, fonctionne sans réseau, retrouve ses données. Il n'y a ni serveur, ni compte, ni étape de build : uniquement des fichiers statiques servis en HTTPS. Cette méthode a été rodée sur un compteur à objectif utilisé au pouce en marchant ; elle vaut pour n'importe quel petit outil.

## Les quatre pièces

| Pièce | Fichier | Pourquoi elle compte |
|---|---|---|
| Page autonome | `index.html` | Tout est local : CSS et JS inline, aucune CDN, police ou image distante, sons synthétisés avec WebAudio. Une ressource distante échoue hors ligne et casse l'app au pire moment. |
| Manifeste | `manifest.webmanifest` | Chrome ne propose « Installer » que s'il trouve un nom, un `start_url`, `display: standalone` et des icônes PNG 192 et 512, le tout en HTTPS. Sans lui, on n'a qu'un raccourci qui s'ouvre dans un onglet. |
| Service worker | `sw.js` | Copie les fichiers à la première visite et les sert si le réseau échoue. Le modèle fournit « réseau d'abord, mais cache après 3 s » : une connexion mourante n'a pas le temps de figer l'app, et les mises à jour arrivent seules quand le réseau est bon. |
| Mémoire | `localStorage` ou IndexedDB | Les données vivent dans le navigateur de l'appareil, donc le réseau n'y change rien. |

## Démarche

1. **Cadrer sans interroger.** Quelle donnée doit survivre ? Quel appareil (Android + Chrome par défaut) ? Faut-il l'héberger ? Prends des défauts raisonnables, annonce-les, et ne pose une question que si la réponse change vraiment le résultat.
2. **Partir du modèle.** Copie `assets/starter/` dans le dossier publié du projet (`public/`), puis adapte : titre et `name`/`short_name`, clé `STORE` dans `index.html`, constante `CACHE` dans `sw.js`, couleurs (`theme_color`, `background_color`, `<meta name="theme-color">`), `icon.svg`. La clé de stockage et le nom du cache doivent être propres à l'app, sinon deux apps sur la même origine se marchent dessus.
3. **Icônes.** Dessine `icon.svg` en carré, fond plein, motif dans les 64 % centraux (Android rogne les bords avec un masque circulaire). Puis `node <skill>/scripts/make_icons.mjs public/icon.svg public/` produit `icon-192.png`, `icon-512.png` et `apple-touch-icon.png`.
4. **Écrire l'app** dans `index.html`. Réflexes mobile qui ont servi : `touch-action: manipulation` (pas de zoom au double appui), `overscroll-behavior: none` (pas de rafraîchissement par glissement accidentel), `height: 100dvh`, `viewport-fit=cover` avec `env(safe-area-inset-*)`, zones tactiles d'au moins 48 px. Pour une réponse immédiate, réagis à `pointerdown` et garde un `click` avec `e.detail === 0` pour le clavier et les lecteurs d'écran. Teste aussi un écran court (390×664, 320×568) et le paysage : c'est là que les éléments se chevauchent.
5. **Persistance** (règles plus bas).
6. **Vérifier** avec `scripts/check_pwa.mjs`. Ne dis jamais « ça marche hors ligne » sans l'avoir vu passer.
7. **Déployer** si l'utilisateur le veut (plus bas), puis relancer la vérification sur l'adresse publique.
8. **Expliquer** à l'utilisateur comment installer, où sont ses données et comment il peut les perdre (plus bas).

## Règles de persistance

- **Enregistre à chaque changement**, de façon synchrone avec `localStorage`. Ne compte jamais sur `beforeunload` ou `pagehide` : sur mobile ils ne sont pas fiables, et un rafraîchissement accidentel ne doit rien coûter.
- **Clé versionnée** (`mon-app:v1`) et **validation champ par champ à la lecture** : une valeur absente ou corrompue retombe sur le défaut sans faire planter l'app. Entoure tout accès de `try/catch`, car le stockage peut lever une exception (mode privé, stockage bloqué).
- **Petit état → `localStorage`** (~5 Mo, synchrone, texte). **Listes longues, historique, images → IndexedDB** : voir `references/indexeddb.md`, avec un utilitaire déjà testé.
- **`navigator.storage.persist()`** après la première interaction demande à Chrome de ne pas purger les données. Chrome décide seul et l'accorde plus facilement aux apps installées : n'en fais jamais une garantie.
- **Aucun secret, aucune donnée sensible** : quiconque tient l'appareil déverrouillé peut lire le stockage.
- **Les données sont liées à l'adresse exacte** (domaine, sous-domaine, `http` vs `https`). Changer d'adresse remet tout à zéro. Fixe l'adresse définitive avant de la donner, et ne renomme pas le projet Netlify d'une app déjà utilisée.
- Aucune synchronisation entre appareils : si l'utilisateur la veut, il faut un serveur ou une base en ligne, ce qui sort de ce skill.

## Vérifier

```bash
cd public && python3 -m http.server 8765 >/dev/null 2>&1 & SERVER=$!
node <skill>/scripts/check_pwa.mjs http://localhost:8765/ --tap "#action" --read "#value"
kill $SERVER
```

`--tap` est l'élément qui fait changer l'état, `--read` celui dont le texte le reflète. Le script contrôle, dans un vrai Chromium : le manifeste, les icônes, l'installabilité selon Chrome lui-même, le service worker, le contenu du cache, puis **coupe le réseau** et vérifie que la page se recharge, que la valeur est conservée, que l'app réagit encore et qu'un nouvel onglet s'ouvre à froid. Code de sortie 1 s'il y a un `FAIL`. Un `WARN` est à lire mais non bloquant.

Arrête le serveur par son PID, jamais avec `pkill -f "http.server"` : le motif correspond à la ligne de commande de ton propre shell, qui est tué avec.

Après un déploiement, relance le même script sur l'adresse publique (sans serveur local).

## Déployer sur Netlify (si demandé)

1. Liste les projets existants (`get-projects`) pour voir si l'app en a déjà un. Ne suppose jamais qu'il faut un nouveau site et ne touche pas aux autres projets.
2. Sinon `create-new-project` avec un nom en minuscules et tirets : l'adresse sera `<nom>.netlify.app`, et c'est l'identité des données de l'app.
3. `deploy-site` renvoie une commande `npx -y @netlify/mcp@latest --site-id … --proxy-path …` à lancer depuis la racine du dépôt ; elle publie le dossier `publish` de `netlify.toml`. Demande une nouvelle commande à chaque redéploiement.
4. Le `netlify.toml` du modèle fixe le dossier publié **et le type du manifeste** : Netlify sert `.webmanifest` en `application/octet-stream` sinon. Ajoute `.netlify` au `.gitignore`.
5. Tout hébergeur statique en HTTPS convient aussi (GitHub Pages, Cloudflare Pages) ; vérifie alors le `Content-Type` du manifeste. `http://localhost` est traité comme sécurisé, donc suffit pour tester.

## Ce qu'il faut dire à l'utilisateur

- **Ouvrir l'adresse une première fois avec du réseau**, et laisser la page se charger : c'est là que le service worker copie l'app.
- **Installer.** Android Chrome : menu ⋮ puis « Installer l'application ». S'il n'y a que « Ajouter à l'écran d'accueil », c'est un simple raccourci : recharger la page et réessayer. PC : icône d'installation à droite de la barre d'adresse. iPhone : la voie fiable est Safari, Partager puis « Sur l'écran d'accueil » ; le stockage de Safari et celui de l'icône installée sont séparés.
- **Où sont les données** : dans Chrome, sur l'appareil, rien sur un serveur. Elles se perdent si on efface les données du site ou de navigation, en navigation privée (effacées à la fermeture), ou en changeant de navigateur ou d'appareil. L'app installée et l'onglet Chrome partagent le même stockage.
- **Mises à jour** : l'app récupère la nouvelle version à l'ouverture suivante qui a du réseau.

## Pièges connus

- **`cache.addAll` est tout ou rien** : si un seul fichier de la liste `ASSETS` est introuvable, le service worker ne s'installe pas et il n'y a plus de hors-ligne, sans message visible. Garde la liste synchrone avec les fichiers réels ; `check_pwa.mjs` le détecte.
- Le service worker ne s'enregistre qu'en HTTPS ou sur `localhost`.
- Nouveau fichier ajouté à l'app : ajoute-le à `ASSETS` et change le nom `CACHE` (`app-v2`) pour que les anciens fichiers soient purgés.
- Le fond du `maskable` doit remplir tout le carré, sinon Android affiche un cadre blanc autour de l'icône.
- iOS n'autorise le son qu'après un geste de l'utilisateur, et seulement au relâchement du doigt : réessaie `audioContext.resume()` sur `pointerup`/`touchend`.
- Pas de notifications push, de synchronisation en arrière-plan ni de multi-appareils ici ; propose-les comme extension si on te les demande.

## Fichiers

```
pwa-offline/
├── SKILL.md
├── assets/starter/        index.html, sw.js, manifest.webmanifest, icon.svg, netlify.toml
├── references/indexeddb.md   stockage volumineux, utilitaire testé
└── scripts/
    ├── make_icons.mjs     icon.svg → icon-192.png, icon-512.png, apple-touch-icon.png
    ├── check_pwa.mjs      installabilité + hors-ligne + persistance (Chromium via Playwright)
    └── _browser.mjs       localise Playwright et Chromium
```
