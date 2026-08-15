// Top HUD: throughput, delivered, clock, frustration meter, speed controls.

export interface HudElements {
  root: HTMLElement;
  throughput: HTMLElement;
  delivered: HTMLElement;
  clock: HTMLElement;
  frustrationFill: HTMLElement;
  speedButtons: HTMLButtonElement[];
}

export function buildHud(
  parent: HTMLElement,
  onSpeed: (multiplier: number) => void,
): HudElements {
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div class="stat"><span class="value" data-th>0</span><span class="label">cars/min</span></div>
    <div class="stat"><span class="value" data-del>0</span><span class="label">delivered</span></div>
    <div id="frustration"><div></div></div>
    <div class="stat"><span class="value" data-clock>0:00</span><span class="label">time</span></div>
    <div id="speeds">
      <button data-speed="0" aria-label="Pause">⏸</button>
      <button data-speed="1" class="active">1×</button>
      <button data-speed="2">2×</button>
      <button data-speed="4">4×</button>
    </div>`;
  parent.appendChild(root);

  const speedButtons = [...root.querySelectorAll<HTMLButtonElement>('#speeds button')];
  for (const btn of speedButtons) {
    btn.addEventListener('click', () => {
      const m = Number(btn.dataset.speed);
      onSpeed(m);
      for (const b of speedButtons) b.classList.toggle('active', b === btn);
    });
  }

  return {
    root,
    throughput: root.querySelector('[data-th]')!,
    delivered: root.querySelector('[data-del]')!,
    clock: root.querySelector('[data-clock]')!,
    frustrationFill: root.querySelector('#frustration > div')!,
    speedButtons,
  };
}

export function updateHud(
  hud: HudElements,
  throughput: number,
  delivered: number,
  simTime: number,
  frustration: number,
): void {
  hud.throughput.textContent = String(throughput);
  hud.delivered.textContent = String(delivered);
  const m = Math.floor(simTime / 60);
  const s = Math.floor(simTime % 60);
  hud.clock.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  hud.frustrationFill.style.width = `${Math.round(frustration * 100)}%`;
}
