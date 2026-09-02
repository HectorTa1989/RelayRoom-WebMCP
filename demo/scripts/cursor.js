// Injected into the RelayRoom top frame before any page script runs.
// Draws a synthetic pointer that the capture script animates, so the recorded
// video shows where the "operator" is clicking. Real mouse events are still
// dispatched by Playwright, so hover states are genuine.
(() => {
  if (window.top !== window) return;

  const state = { x: 768, y: 500, ready: false };
  let dot, ring, veil;

  function build() {
    if (state.ready) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo_cursor{position:fixed;top:0;left:0;width:30px;height:30px;z-index:2147483646;
        pointer-events:none;will-change:transform;transition:opacity .28s ease;
        filter:drop-shadow(0 3px 7px rgba(15,23,42,.45));}
      #__demo_cursor.down{transform-origin:4px 3px}
      #__demo_ring{position:fixed;top:0;left:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
        z-index:2147483645;pointer-events:none;opacity:0;border:2.5px solid #635bff;background:rgba(99,91,255,.16)}
      #__demo_ring.fire{animation:__demo_ping .58s cubic-bezier(.16,.84,.44,1) forwards}
      @keyframes __demo_ping{0%{opacity:.95;transform:scale(.35)}70%{opacity:.5}100%{opacity:0;transform:scale(3.6)}}
      #__demo_veil{position:fixed;inset:0;background:#f6f6f8;z-index:2147483647;pointer-events:none;transition:opacity .35s ease}
    `;
    document.documentElement.appendChild(style);

    dot = document.createElement('div');
    dot.id = '__demo_cursor';
    dot.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2.2 L4 19.4 L8.5 15.2 L11.4 21.6 L14.6 20.1 L11.8 13.9 L17.9 13.6 Z" ' +
      'fill="#ffffff" stroke="#11131a" stroke-width="1.35" stroke-linejoin="round"/></svg>';
    dot.style.opacity = '0';

    ring = document.createElement('div');
    ring.id = '__demo_ring';

    veil = document.createElement('div');
    veil.id = '__demo_veil';

    document.body.append(ring, dot, veil);
    state.ready = true;
    apply();
  }

  function apply() {
    if (!dot) return;
    dot.style.transform = `translate3d(${state.x - 4}px, ${state.y - 3}px, 0)`;
    ring.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
  }

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  window.__demoCursor = {
    pos: () => ({ x: state.x, y: state.y }),
    show() { build(); dot.style.opacity = '1'; },
    hide() { build(); dot.style.opacity = '0'; },
    lift() { build(); veil.style.opacity = '0'; setTimeout(() => veil.remove(), 400); },
    place(x, y) { build(); state.x = x; state.y = y; apply(); },
    glide(x, y, ms) {
      build();
      return new Promise((resolve) => {
        const sx = state.x, sy = state.y, t0 = performance.now();
        // A slight perpendicular arc reads as a hand, not a linear tween.
        const dx = x - sx, dy = y - sy;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(len * 0.09, 46) * (dx >= 0 ? -1 : 1);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = easeInOut(p);
          const arc = Math.sin(p * Math.PI) * bow;
          state.x = sx + dx * e + (-dy / len) * arc;
          state.y = sy + dy * e + (dx / len) * arc;
          apply();
          if (p < 1) requestAnimationFrame(step); else { state.x = x; state.y = y; apply(); resolve(); }
        };
        requestAnimationFrame(step);
      });
    },
    click() {
      build();
      ring.classList.remove('fire');
      void ring.offsetWidth;
      ring.classList.add('fire');
      dot.animate(
        [{ transform: dot.style.transform + ' scale(1)' },
         { transform: dot.style.transform + ' scale(.78)', offset: 0.35 },
         { transform: dot.style.transform + ' scale(1)' }],
        { duration: 240, easing: 'ease-out' },
      );
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
