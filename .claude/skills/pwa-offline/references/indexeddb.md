# Stockage volumineux avec IndexedDB

`localStorage` suffit pour un petit état (quelques valeurs, une courte liste). Passe à IndexedDB quand les données dépassent environ 1 Mo, quand elles sont nombreuses (historique, centaines d'éléments) ou binaires (images, audio). IndexedDB est asynchrone, accepte des objets JavaScript tels quels et dispose de bien plus de place.

## Utilitaire clé-valeur (testé dans Chromium)

À coller dans `index.html`. Chaque appel ouvre une transaction ; la promesse n'est résolue qu'**une fois la transaction terminée**, donc l'écriture est durable quand `await db.set(...)` rend la main.

```js
const db = (() => {
  let connection;
  const open = () => (connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('mon-app', 1);          // REMPLACER : nom propre à l'app
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const run = async (mode, work) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('kv', mode);
      const req = work(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    set: (key, value) => run('readwrite', (store) => store.put(value, key)),
    del: (key) => run('readwrite', (store) => store.delete(key)),
  };
})();
```

## Utilisation

```js
let state = (await db.get('state')) ?? { items: [] };   // lecture au démarrage, valeur par défaut
// valide ensuite chaque champ comme pour localStorage : ne fais pas confiance à ce qui a été lu

async function addItem(item) {
  state.items.push(item);
  render();                       // l'interface répond d'abord
  await db.set('state', state);   // puis l'écriture, à CHAQUE changement
}
```

## Points d'attention

- Le démarrage devient asynchrone : affiche un état vide ou un indicateur, puis `render()` une fois la lecture terminée, et n'accepte pas d'action avant.
- Enveloppe les appels dans `try/catch` : IndexedDB peut être indisponible (navigation privée de certains navigateurs, stockage bloqué). L'app doit rester utilisable, même sans mémoire.
- Pour faire évoluer la structure, incrémente la version (`indexedDB.open('mon-app', 2)`) et traite l'ancienne dans `onupgradeneeded`, sans supprimer les données existantes.
- Même règle d'origine que `localStorage` : l'adresse exacte du site délimite les données.
- `scripts/check_pwa.mjs` repère les bases IndexedDB créées (ligne `stockage`) et vérifie la valeur affichée après rechargement et hors ligne, comme pour `localStorage`.
