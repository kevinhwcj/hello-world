// Aide partagée : retrouve Playwright et un Chromium, et ouvre une session de test.
// Playwright est cherché dans le projet, puis dans PLAYWRIGHT_MODULE, puis dans les
// emplacements habituels (/opt/node-tools, npm root -g).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* on cherche ailleurs */ }
  const dirs = [process.env.PLAYWRIGHT_MODULE, '/opt/node-tools/node_modules/playwright'];
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    dirs.push(path.join(root, 'playwright'));
  } catch { /* npm absent */ }
  for (const dir of dirs.filter(Boolean)) {
    const entry = path.join(dir, 'index.mjs');
    if (fs.existsSync(entry)) return import(pathToFileURL(entry).href);
  }
  throw new Error('Playwright introuvable : `npm i -D playwright`, ou PLAYWRIGHT_MODULE=/chemin/vers/playwright');
}

function chromiumPath() {
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers']) {
    if (!root) continue;
    const exe = path.join(root, 'chromium');
    try { if (fs.statSync(exe).isFile()) return exe; } catch { /* absent */ }
  }
  return undefined; // Playwright utilisera son propre Chromium
}

// Contexte *persistant* (profil temporaire) : un contexte jetable est vu par Chrome comme
// de la navigation privée et masque la vraie réponse sur l'installabilité.
export async function openSession(contextOptions = {}) {
  const { chromium } = await loadPlaywright();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-check-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumPath(),
    headless: true,
    ...contextOptions,
  });
  return {
    ctx,
    async close() {
      await ctx.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
