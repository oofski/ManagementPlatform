// Playbook v2 UI helpers: right-click (and long-press) context menus, inline rename, and small shared bits.
import { esc, tabs, errToast } from './ui.js';

let open = null;
export function closeMenu() { if (open) { open.remove(); open = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyClose, true); } }
const outside = (e) => { if (open && !open.contains(e.target)) closeMenu(); };
const keyClose = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };

// items: [{ label, onClick, danger, disabled } | '-' ] or a node to show inside (custom content).
export function contextMenu(x, y, items, { label = 'Actions' } = {}) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'pb-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', label);
  if (items instanceof Node) m.appendChild(items);
  else {
    m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`)).join('');
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[Number(b.dataset.i)]; closeMenu(); it.onClick?.(); });
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  m.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  open = m;
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keyClose, true); }, 0);
  m.querySelector('button, input, select')?.focus();
  return m;
}

// Right-click, long-press (touch) and a visible "more" button ([data-more]) all open the same menu.
export function bindMenu(root, selector, getItems) {
  root.addEventListener('contextmenu', (e) => {
    const t = e.target.closest(selector); if (!t || !root.contains(t)) return;
    e.preventDefault(); const items = getItems(t); if (items) contextMenu(e.clientX, e.clientY, items);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]'); if (!b || !root.contains(b)) return;
    const t = b.closest(selector); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const r = b.getBoundingClientRect(); const items = getItems(t); if (items) contextMenu(r.left, r.bottom + 4, items);
  });
  let timer = null; let start = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const t = e.target.closest(selector); if (!t) return;
    start = [e.clientX, e.clientY];
    timer = setTimeout(() => { timer = null; t.dataset.longpress = '1'; const items = getItems(t); if (items) contextMenu(start[0], start[1], items); }, 550);
  });
  const cancel = (e) => { if (timer && (!start || e.type !== 'pointermove' || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 8)) { clearTimeout(timer); timer = null; } };
  root.addEventListener('pointermove', cancel); root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
  // a long press must not also count as a click
  root.addEventListener('click', (e) => { const t = e.target.closest(selector); if (t && t.dataset.longpress) { delete t.dataset.longpress; e.preventDefault(); e.stopPropagation(); } }, true);
}

// Inline rename: swap a text node for an input; Enter or blur saves, Escape cancels.
export function inlineRename(node, current, onSave) {
  const inp = document.createElement('input');
  inp.className = 'pb-inline'; inp.value = current; inp.setAttribute('aria-label', 'New name');
  const old = node.innerHTML;
  node.innerHTML = ''; node.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (save && v && v !== current) { try { await onSave(v); node.textContent = v; return; } catch (e) { node.innerHTML = old; errToast(e); return; } }
    node.innerHTML = old;
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('pointerdown', (e) => e.stopPropagation());
}

export const sideLabel = { offense: 'Offense', defense: 'Defense', special: 'Special teams' };

// Tabs shared by the staff playbook pages.
export const pbTabs = (active) => tabs([['books', 'Playbooks', '/playbook'], ['formations', 'Formations', '/playbook/formations'], ['routes', 'Routes', '/playbook/routes'],
  ['positions', 'Positions', '/playbook/positions'], ['installs', 'Install sheets', '/playbook/installs'], ['shares', 'Delivery', '/playbook/shares'], ['game', 'Game mode', '/playbook/game']], active);
