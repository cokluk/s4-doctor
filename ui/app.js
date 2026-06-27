const app = document.getElementById('app');
const panels = {
  all: document.getElementById('logAll'),
  server: document.getElementById('logServer'),
  client: document.getElementById('logClient'),
};
const statsEl = document.getElementById('stats');
const seqEl = document.getElementById('seq');
const autoScrollEl = document.getElementById('autoScroll');
const btnFocus = document.getElementById('btnFocus');

let isVisible = false;
let totalCount = 0;
let latestSeq = 0;
let focusEnabled = false;
const MAX_LINES = 500;

function getResourceName() {
  if (typeof GetParentResourceName === 'function') {
    return GetParentResourceName();
  }
  return 's4-doctor';
}

function formatTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function renderLine(entry) {
  const side = entry.side || entry.source || '?';
  const level = entry.level || 'info';
  const meta = [
    formatTime(entry.timestamp),
    `#${entry.seq || entry.id || '?'}`,
    side,
    entry.resource ? `[${entry.resource}]` : '',
    entry.playerId ? `P${entry.playerId}` : '',
    entry.playerName || '',
  ].filter(Boolean).join(' ');

  const line = document.createElement('div');
  line.className = `log-line level-${level}`;
  line.dataset.side = side;
  line.innerHTML = `<span class="meta">${meta}</span>${escapeHtml(entry.message || '')}`;
  return line;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function scrollActivePanel() {
  const panel = document.querySelector('.panel.active');
  if (panel) panel.scrollTop = panel.scrollHeight;
}

function appendLog(entry) {
  totalCount += 1;
  if (entry.seq && entry.seq > latestSeq) latestSeq = entry.seq;

  const line = renderLine(entry);
  panels.all.appendChild(line);

  if (entry.side === 'server' || entry.source === 'server') {
    panels.server.appendChild(line.cloneNode(true));
  }
  if (entry.side === 'client' || entry.source === 'client') {
    panels.client.appendChild(line.cloneNode(true));
  }

  trimPanel(panels.all);
  trimPanel(panels.server);
  trimPanel(panels.client);

  statsEl.textContent = `${totalCount} logs`;
  seqEl.textContent = `seq: ${latestSeq}`;

  if (autoScrollEl.checked) scrollActivePanel();
}

function trimPanel(panel) {
  while (panel.childElementCount > MAX_LINES) {
    panel.removeChild(panel.firstChild);
  }
}

function clearPanels() {
  Object.values(panels).forEach((p) => { p.innerHTML = ''; });
  totalCount = 0;
  latestSeq = 0;
  statsEl.textContent = '0 logs';
  seqEl.textContent = 'seq: 0';
}

function updateFocusButton() {
  btnFocus.textContent = focusEnabled ? 'Focus: On' : 'Focus: Off';
  btnFocus.classList.toggle('active', focusEnabled);
}

function setVisible(visible, focus) {
  isVisible = !!visible;
  app.classList.toggle('hidden', !isVisible);
  document.body.classList.toggle('nui-open', isVisible);

  if (typeof focus === 'boolean') {
    focusEnabled = focus;
    updateFocusButton();
  }
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  Object.entries(panels).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  if (autoScrollEl.checked) scrollActivePanel();
}

function post(name, data) {
  return fetch(`https://${getResourceName()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data || {}),
  }).catch(() => {});
}

function closePanel() {
  if (!isVisible) return;
  post('close');
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {
    case 'visible':
      setVisible(!!data.visible, data.focus);
      break;
    case 'log':
      if (data.entry) appendLog(data.entry);
      break;
    case 'snapshot':
      clearPanels();
      (data.logs || []).forEach(appendLog);
      scrollActivePanel();
      break;
    case 'clear':
      clearPanels();
      break;
    default:
      break;
  }
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

document.getElementById('btnClose').addEventListener('click', closePanel);
document.getElementById('btnClear').addEventListener('click', () => {
  clearPanels();
  post('clear');
});
btnFocus.addEventListener('click', () => {
  focusEnabled = !focusEnabled;
  updateFocusButton();
  post('toggleFocus', { focus: focusEnabled });
});

document.addEventListener('keydown', (e) => {
  if (!isVisible) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  }
});

updateFocusButton();
