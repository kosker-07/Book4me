// Accessible, reusable status messaging for asynchronous UI panels.
export function renderStatus(container, state, message) {
  const allowed = new Set(['loading', 'empty', 'error', 'success']);
  if (!allowed.has(state)) throw new Error('INVALID_UI_STATE');
  const el = document.createElement('p');
  el.className = 'ui-status ui-status--' + state;
  el.setAttribute('role', state === 'error' ? 'alert' : 'status');
  el.textContent = String(message ?? '');
  container.replaceChildren(el);
  return el;
}
