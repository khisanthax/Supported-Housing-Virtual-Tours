import { GRID_SIZE, gridFor, gridEdges, moveGridRoom, manualGridConnection, toggleGridConnection } from './room-grid.js';
const CELL = 164;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
export function createRoomGrid({ host, change, open, position, isBusy, report }) {
  let urls = [], chosen;
  const clear = () => { urls.forEach(URL.revokeObjectURL); urls = []; host.replaceChildren(); };
  function render(draft) {
    const oldScroll = host.querySelector('.room-grid-scroll');
    const offset = [oldScroll?.scrollLeft ?? 0, oldScroll?.scrollTop ?? 0];
    const focusRoom = document.activeElement?.classList.contains('grid-drag-handle') ? document.activeElement.closest('.room-grid-tile')?.dataset.room : null;
    clear();
    const tour = draft.tour, grid = gridFor(tour);
    if (!tour.rooms.some(r => r.id === chosen)) chosen = tour.rooms[0].id;
    const heading = el('h3', 'Room layout');
    const note = el('p', 'Drag the Move handle to an empty cell. Touch outside the handles to scroll. Shared edges connect rooms; tap a connector to remove or restore it. This is a navigation sketch, not a measured floor plan.', 'edit-help');
    const scroll = el('div', null, 'room-grid-scroll');
    scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Scrollable room layout');
    const board = el('div', null, 'room-grid-board');
    board.style.width = board.style.height = GRID_SIZE * CELL + 'px';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', GRID_SIZE * CELL); svg.setAttribute('height', GRID_SIZE * CELL); svg.setAttribute('aria-hidden', 'true');
    board.append(svg);
    const operate = operation => { if (!isBusy()) change(operation); };
    const edges = gridEdges(tour);
    for (const edge of edges) {
      const p = grid.positions[edge.a.id], q = grid.positions[edge.b.id];
      const x1 = p.x * CELL + 58, y1 = p.y * CELL + 56, x2 = q.x * CELL + 58, y2 = q.y * CELL + 56;
      const line = document.createElementNS(svg.namespaceURI, 'line');
      for (const [key, value] of Object.entries({ x1, y1, x2, y2, stroke: edge.enabled ? '#27674d' : '#8c4037', 'stroke-width': 5, 'stroke-dasharray': edge.enabled ? '0' : '8 6' })) line.setAttribute(key, value);
      line.style.pointerEvents = 'stroke'; line.style.cursor = 'pointer';
      line.onclick = () => operate(next => toggleGridConnection(next, edge.key));
      svg.append(line);
      const button = el('button', edge.enabled ? '−' : '+', 'grid-connector');
      button.type = 'button'; button.style.left = (x1 + x2) / 2 - 22 + 'px'; button.style.top = (y1 + y2) / 2 - 22 + 'px';
      button.setAttribute('aria-label', `${edge.enabled ? 'Remove' : 'Restore'} connection ${edge.a.name} to ${edge.b.name}`);
      button.onclick = () => operate(next => toggleGridConnection(next, edge.key));
      board.append(button);
    }
    for (const room of tour.rooms) {
      const p = grid.positions[room.id], tile = el('div', null, 'room-grid-tile');
      tile.dataset.room = room.id; tile.style.left = p.x * CELL + 'px'; tile.style.top = p.y * CELL + 'px';
      const view = el('button', null, 'grid-room-open'); view.type = 'button'; view.setAttribute('aria-label', 'Open panorama ' + room.name);
      const image = el('img'); image.alt = ''; image.draggable = false;
      image.src = URL.createObjectURL(draft.images.get(room.id)); urls.push(image.src);
      view.append(image, el('span', room.name)); view.onclick = () => { if (!isBusy()) open(room.id); };
      const handle = el('button', '↔ Move', 'grid-drag-handle'); handle.type = 'button';
      handle.setAttribute('aria-label', 'Move ' + room.name); handle.setAttribute('aria-describedby', 'grid-keyboard-help');
      let drag;
      handle.onpointerdown = event => {
        if (isBusy() || !event.isPrimary || event.button !== 0) return;
        chosen = room.id; drag = { x: event.clientX, y: event.clientY };
        handle.setPointerCapture(event.pointerId); tile.classList.add('dragging');
      };
      handle.onpointermove = event => {
        if (!drag) return;
        tile.style.transform = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
      };
      handle.onpointercancel = () => { drag = null; tile.style.transform = ''; tile.classList.remove('dragging'); };
      handle.onpointerup = event => {
        if (!drag) return;
        const x = p.x + Math.round((event.clientX - drag.x) / CELL), y = p.y + Math.round((event.clientY - drag.y) / CELL);
        handle.onpointercancel();
        if (x !== p.x || y !== p.y) operate(next => moveGridRoom(next, room.id, x, y));
      };
      handle.onkeydown = event => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta) return; event.preventDefault();
        operate(next => moveGridRoom(next, room.id, p.x + delta[0], p.y + delta[1]));
      };
      tile.append(view, handle); board.append(tile);
    }
    scroll.append(board);
    const tools = el('div', null, 'grid-tools');
    const help = el('p', 'Keyboard: focus a Move handle and use arrow keys. Or choose a room and its column/row below.', 'edit-help'); help.id = 'grid-keyboard-help';
    const select = (label, options) => { const wrap = el('label', label), input = el('select'); input.setAttribute('aria-label', label); options.forEach(([text, value]) => input.add(new Option(text, value))); wrap.append(input); tools.append(wrap); return input; };
    const options = tour.rooms.map(r => [r.name, r.id]);
    const roomSelect = select('Room to move', options); roomSelect.value = chosen; roomSelect.onchange = () => { chosen = roomSelect.value; col.value = grid.positions[chosen].x; row.value = grid.positions[chosen].y; };
    const numbers = Array.from({ length: GRID_SIZE }, (_, i) => [String(i + 1), i]);
    const col = select('Column', numbers), row = select('Row', numbers); col.value = grid.positions[chosen].x; row.value = grid.positions[chosen].y;
    const move = el('button', 'Move to cell', 'edit-button secondary'); move.type = 'button'; move.onclick = () => operate(next => moveGridRoom(next, roomSelect.value, Number(col.value), Number(row.value))); tools.append(move);
    const from = select('Connect room', options), to = select('To room', options); if (options[1]) to.value = options[1][1];
    const connect = el('button', 'Connect rooms', 'edit-button'); connect.type = 'button'; connect.onclick = () => operate(next => manualGridConnection(next, from.value, to.value)); tools.append(connect);
    const list = el('ul', null, 'grid-connections');
    let pending = 0;
    for (const edge of edges) {
      const item = el('li');
      const toggle = el('button', `${edge.a.name} ↔ ${edge.b.name} · ${edge.enabled ? 'Connected' : 'Removed'}${edge.adjacent ? '' : ' · Manual'}`, 'edit-button secondary'); toggle.type = 'button'; toggle.onclick = () => operate(next => toggleGridConnection(next, edge.key)); item.append(toggle);
      if (edge.enabled) for (const [source, target] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        source.links.forEach((link, index) => {
          if (link.target !== target.id) return;
          if (link.pending) pending++;
          const place = el('button', `${source.name} → ${target.name} · ${link.pending ? 'Needs position' : 'Positioned'}`, 'edit-button secondary'); place.type = 'button';
          place.onclick = () => { if (!isBusy()) position(source.id, index); }; item.append(place);
        });
      }
      list.append(item);
    }
    const warning = el('p', pending ? `${pending} arrows need a doorway position. Open each direction below and tap its doorway before publishing.` : 'Every current connection has positioned arrows.', pending ? 'grid-warning' : 'edit-help'); warning.setAttribute('role', 'status');
    if (!edges.length) warning.textContent = 'Move tiles next to each other or choose two rooms to connect. No doorway coordinates are guessed.';
    host.append(heading, note, scroll, help, tools, warning, list);
    [scroll.scrollLeft, scroll.scrollTop] = offset;
    if (focusRoom) [...host.querySelectorAll('.room-grid-tile')].find(tile => tile.dataset.room === focusRoom)?.querySelector('.grid-drag-handle').focus({ preventScroll: true });
    // A failed save rebuilds from the unchanged draft; temporary drag styles never become persisted layout.
  }
  return { render, clear };
}
