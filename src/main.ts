import './style.css';
import { Game } from './game';

// Seed from the URL if present (shareable towns), otherwise time-based.
// Date.now is fine here: main.ts is outside src/sim/**, and the seed is the
// one intentional source of run-to-run variety.
const params = new URLSearchParams(location.search);
const urlSeed = Number(params.get('seed'));
const seed = Number.isInteger(urlSeed) && urlSeed > 0 ? urlSeed : Date.now() % 1000000;

const root = document.getElementById('app')!;
const game = new Game(root, seed);
// Debug handle for headless smoke tests and console poking.
(window as unknown as { __tj: Game }).__tj = game;

// PWA: register the service worker (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is progressive enhancement */
    });
  });
}
