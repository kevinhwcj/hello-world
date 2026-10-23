#!/usr/bin/env node
// Vérifie qu'une app web est une PWA installable avec Chrome, utilisable hors ligne,
// et qu'elle garde ses données.
//
//   node check_pwa.mjs <url> [--tap "<sélecteur>" --read "<sélecteur>"] [--fill "<sélecteur>"] [--taps 3]
//
//   --tap   élément à toucher pour faire changer l'état de l'app (ex. "#plus", ou "#ajouter")
//   --read  élément dont le texte reflète cet état (ex. "#count", ou le conteneur de la liste "#liste")
//   --fill  champ à remplir avant chaque appui (apps où l'on saisit quelque chose, ex. "#nouvel-article")
//   --taps  nombre d'appuis (défaut 3)
//
// Sans --tap/--read, la partie « mémoire » n'est PAS testée (le script le dit). Code de sortie : 1 s'il y a un FAIL.
import { openSession } from './_browser.mjs';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

const opts = parse(process.argv.slice(2));
const url = opts._[0];
if (!url || (!opts.tap) !== (!opts.read)) {
  console.error('Usage : node check_pwa.mjs <url> [--tap "<sélecteur>" --read "<sélecteur>"] [--fill "<sélecteur>"] [--taps 3]');
  process.exit(2);
}
const interactive = Boolean(opts.tap && opts.read);
const taps = Number(opts.taps ?? 3);

let failures = 0;
const say = (tag, label, detail) => console.log(`${tag} ${label}${detail ? ` — ${detail}` : ''}`);
const pass = (label, detail) => say('PASS', label, detail);
const fail = (label, detail) => { failures++; say('FAIL', label, detail); };
const warn = (label, detail) => say('WARN', label, detail);
const info = (label, detail) => say('INFO', label, detail);
const check = (ok, label, detail) => (ok ? pass(label) : fail(label, detail));

const session = await openSession({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
const { ctx } = session;

try {
  const page = await ctx.newPage();
  const problems = [];
  let collecting = true;
  page.on('pageerror', (e) => collecting && problems.push(e.message));
  page.on('console', (m) => collecting && m.type() === 'error' && problems.push(m.text()));

  await page.goto(url, { waitUntil: 'networkidle' });
  info('page', `${await page.title()} (${url})`);

  /* ---------- Manifeste et icônes ---------- */
  const cdp = await ctx.newCDPSession(page);
  const { url: manifestUrl, data, errors: manifestErrors } = await cdp.send('Page.getAppManifest');
  let manifest = null;
  try { manifest = JSON.parse(data); } catch { /* vide ou invalide */ }

  const fetchInPage = (u) => page.evaluate(async (target) => {
    try {
      const r = await fetch(target, { cache: 'no-store' });
      return { status: r.status, type: r.headers.get('content-type') || '' };
    } catch (e) { return { status: 0, type: String(e) }; }
  }, u);

  const requiredFiles = [];
  if (!manifest) {
    fail('manifeste lisible par Chrome', manifestErrors.map((e) => e.message).join('; ') || 'aucun <link rel="manifest"> trouvé');
  } else {
    check(manifestErrors.length === 0, 'Chrome lit le manifeste sans erreur', manifestErrors.map((e) => e.message).join('; '));
    check(Boolean(manifest.name || manifest.short_name), 'manifeste : name ou short_name');
    check(Boolean(manifest.start_url), 'manifeste : start_url');
    check(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display),
      'manifeste : display standalone', `display = ${manifest.display}`);

    const icons = manifest.icons ?? [];
    const hasPng = (size) => icons.some((i) => (i.sizes ?? '').split(' ').includes(size)
      && (i.type === 'image/png' || /\.png($|\?)/.test(i.src ?? '')));
    check(hasPng('192x192') && hasPng('512x512'), 'manifeste : icônes PNG 192x192 et 512x512',
      'Chrome exige ces deux tailles en PNG pour proposer « Installer »');

    const manifestType = (await fetchInPage(manifestUrl)).type;
    if (/json/.test(manifestType)) pass('manifeste servi en JSON', manifestType);
    else warn('manifeste servi avec un mauvais Content-Type', `${manifestType} — recommandé : application/manifest+json (voir netlify.toml)`);

    requiredFiles.push(new URL(manifestUrl).pathname);
    // Une même image peut servir à plusieurs entrées (any + maskable) : on ne la teste qu'une fois.
    for (const iconUrl of new Set(icons.map((icon) => new URL(icon.src, manifestUrl).href))) {
      const r = await fetchInPage(iconUrl);
      const name = new URL(iconUrl).pathname;
      check(r.status === 200 && /^image\//.test(r.type), `icône ${name} accessible`, `HTTP ${r.status} ${r.type}`);
      requiredFiles.push(name);
    }
  }

  /* ---------- Installabilité selon Chrome ---------- */
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check(installabilityErrors.length === 0, 'Chrome juge l\'app installable',
    installabilityErrors.map((e) => e.errorId).join(', '));

  /* ---------- Service worker et cache ---------- */
  const sw = await page.evaluate(() => Promise.race([
    navigator.serviceWorker?.ready.then((r) => (r.active ? r.active.state : 'inactif')) ?? 'non supporté',
    new Promise((resolve) => setTimeout(() => resolve('aucun service worker enregistré'), 8000)),
  ]));
  check(sw === 'activated', 'service worker actif', `${sw} — il doit être enregistré depuis la page, en HTTPS ou sur localhost`);

  const cached = await page.evaluate(async () => {
    const paths = [];
    for (const key of await caches.keys()) {
      for (const req of await (await caches.open(key)).keys()) paths.push(new URL(req.url).pathname);
    }
    return paths;
  });
  const pagePath = new URL(url).pathname;
  const pageCached = cached.includes(pagePath) || (pagePath.endsWith('/') && cached.includes(`${pagePath}index.html`));
  const missing = requiredFiles.filter((p) => !cached.includes(p));
  check(pageCached && missing.length === 0, 'la page, le manifeste et les icônes sont dans le cache',
    `${pageCached ? '' : 'page absente ; '}${missing.length ? `manquants : ${missing.join(', ')} ` : ''}— cache.addAll échoue en bloc si un fichier de ASSETS est introuvable`);

  /* ---------- Mémoire (en ligne) ---------- */
  // Espaces et retours à la ligne normalisés : une liste s'affiche « Article 1 Article 2 » sur une ligne.
  const read = (p) => p.locator(opts.read).first().innerText().then((t) => t.replace(/\s+/g, ' ').trim());
  const tap = (p) => p.locator(opts.tap).first().tap();
  // Une « action » = remplir le champ s'il y en a un, puis toucher le bouton.
  const act = async (p, text) => {
    if (opts.fill) await p.locator(opts.fill).first().fill(text);
    await tap(p);
  };
  let afterTaps;

  if (interactive) {
    const before = await read(page);
    for (let i = 0; i < taps; i++) await act(page, `Article ${i + 1}`);
    afterTaps = await read(page);
    check(afterTaps !== before, `l'app réagit aux appuis (${before} → ${afterTaps})`, `${opts.read} n'a pas changé`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = await read(page);
    check(reloaded === afterTaps, 'mémoire : valeur conservée après rechargement', `${afterTaps} → ${reloaded}`);
  }

  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
    persisted: navigator.storage?.persisted ? await navigator.storage.persisted() : null,
  }));
  info('stockage', `localStorage [${storage.local.join(', ')}] · IndexedDB [${storage.idb.join(', ')}] · persistant : ${storage.persisted}`);
  if (interactive) check(storage.local.length + storage.idb.length > 0, 'des données sont enregistrées sur l\'appareil');
  if (storage.persisted === false) info('persistance', 'non accordée ici : Chrome l\'accorde surtout aux apps installées, ne pas en dépendre');

  /* ---------- Mise en page : jamais de défilement horizontal sur petit écran ---------- */
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    }));
    check(scroll <= client + 1, `mise en page : pas de défilement horizontal à ${width}px`,
      `contenu de ${scroll}px dans ${client}px — grille sans minmax(0, 1fr), champ ou image trop large ?`);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  collecting = false;
  check(problems.length === 0, 'aucune erreur JavaScript ou console', problems.slice(0, 3).join(' | '));

  /* ---------- Hors ligne ---------- */
  await ctx.setOffline(true);
  info('réseau', 'coupé');
  let offlineOk = false;
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const title = await page.title();
    offlineOk = !page.url().startsWith('chrome-error') && title !== '';
    check(offlineOk, 'hors ligne : la page se recharge', `titre « ${title} »`);
  } catch (e) {
    fail('hors ligne : la page se recharge', e.message.split('\n')[0]);
  }

  if (offlineOk && interactive) {
    const kept = await read(page);
    check(kept === afterTaps, 'hors ligne : valeur conservée', `${afterTaps} → ${kept}`);
    await act(page, 'Article hors ligne');
    const moved = await read(page);
    check(moved !== kept, 'hors ligne : l\'app réagit encore', `${kept} → ${moved}`);

    const cold = await ctx.newPage();
    try {
      await cold.goto(url, { waitUntil: 'domcontentloaded' });
      const coldValue = await read(cold);
      check(coldValue === moved, 'hors ligne : un nouvel onglet s\'ouvre et retrouve la valeur', `${moved} → ${coldValue}`);
    } catch (e) {
      fail('hors ligne : un nouvel onglet s\'ouvre', e.message.split('\n')[0]);
    }
  } else if (offlineOk) {
    const cold = await ctx.newPage();
    try {
      await cold.goto(url, { waitUntil: 'domcontentloaded' });
      check((await cold.title()) !== '', 'hors ligne : un nouvel onglet s\'ouvre');
    } catch (e) {
      fail('hors ligne : un nouvel onglet s\'ouvre', e.message.split('\n')[0]);
    }
  }
} finally {
  await session.close();
}

const covered = interactive
  ? 'installable, hors ligne, mémoire conservée'
  : 'installable et hors ligne. MÉMOIRE NON TESTÉE : ajoute --tap et --read (et --fill si l\'app demande une saisie)';
console.log(failures ? `\n${failures} problème(s) à corriger` : `\nTout est bon : ${covered}`);
process.exitCode = failures ? 1 : 0;
