// Data credits (ODbL: the baked city is a derivative of OpenStreetMap). Shown small and legible while
// the opening plays, then gone: never a permanent HUD. The tuner lists them too.

export function showCredits(text: string, opts: { delay?: number; hold?: number } = {}): void {
  if (!text || typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'note');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:calc(14px + env(safe-area-inset-bottom, 0px))', 'transform:translateX(-50%)',
    'max-width:calc(100% - 32px)', 'box-sizing:border-box', 'padding:3px 9px', 'border-radius:9px',
    'font:500 11px/1.35 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif',
    'letter-spacing:0.02em', 'color:#e2e4e5', 'background:rgba(46,56,67,0.55)', 'text-align:center',
    'pointer-events:none', 'opacity:0', 'transition:opacity 900ms ease', 'z-index:5',
  ].join(';');
  document.body.appendChild(el);
  const delay = opts.delay ?? 700;
  const hold = opts.hold ?? 6500;
  setTimeout(() => (el.style.opacity = '1'), delay);
  setTimeout(() => (el.style.opacity = '0'), delay + hold);
  setTimeout(() => el.remove(), delay + hold + 1200);
}
