// ==========================================================================
// 15-routes.js
// "Rotas" tab: two named, colored (red/green) car routes with multiple
// stops. Routes follow real roads via the free OSRM routing engine and are
// editable by dragging the line on the map. Exportable as KML.
//
// Loaded as a classic script (not a module) so all files share one global
// scope, exactly like the original single-file build. Load order matters --
// see the <script> tags at the bottom of index.html.
// ==========================================================================

// Free, keyless OSRM public demo server. Rate-limited / not for heavy
// production use -- fine for occasional route planning. If this app ever
// needs guaranteed uptime, swap serviceUrl for a self-hosted OSRM instance
// or a paid provider (GraphHopper / ORS); nothing else here needs to change.
const OSRM_SERVICE_URL = 'https://router.project-osrm.org/route/v1';

const ROUTES = {
  a: { name: 'Rota 1', color: '#ff4d4d', waypoints: [], control: null, roadCoords: null },
  b: { name: 'Rota 2', color: '#4dff88', waypoints: [], control: null, roadCoords: null }
};

function _routeSuffix(key) { return key === 'a' ? 'A' : 'B'; }

// ─── BUILD / REBUILD THE ROUTING LINE ──────────────────────────────────────────
function _rebuildRouteControl(key) {
  const r = ROUTES[key];

  if (r.control) {
    map.removeControl(r.control);
    r.control = null;
  }
  if (r.waypoints.length < 2) {
    r.roadCoords = null;
    return;
  }

  r.control = L.Routing.control({
    waypoints: r.waypoints.map(w => L.latLng(w.lat, w.lng)),
    router: L.Routing.osrmv1({ serviceUrl: OSRM_SERVICE_URL, profile: 'driving' }),
    lineOptions: {
      styles: [{ color: r.color, weight: 5, opacity: 0.85 }],
      addWaypoints: true // dragging the line inserts a new stop, like My Maps
    },
    routeWhileDragging: true,
    draggableWaypoints: true,
    fitSelectedRoutes: false,
    show: false, // we render our own stop list in the sidebar
    createMarker: (i, wp) => L.marker(wp.latLng, {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${r.color};
          border:2px solid #0a0a0a;box-shadow:0 2px 6px rgba(0,0,0,0.5);
          display:flex;align-items:center;justify-content:center;
          font-family:var(--mono);font-size:10px;font-weight:700;color:#0a0a0a;">${i + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    })
  }).addTo(map);

  r.control.on('waypointschanged', e => {
    r.waypoints = e.waypoints
      .filter(w => w.latLng)
      .map(w => ({ lat: w.latLng.lat, lng: w.latLng.lng }));
    _renderRouteStops(key);
  });

  // Capture the actual road-snapped geometry for accurate KML export
  // (not just straight lines between stops).
  r.control.on('routesfound', e => {
    const best = e.routes && e.routes[0];
    if (best && best.coordinates) {
      r.roadCoords = best.coordinates.map(c => ({ lat: c.lat, lng: c.lng }));
    }
  });

  r.control.on('routingerror', () => {
    showToast(`⚠ Não foi possível calcular <span class="accent">${r.name}</span> — verifique a conexão`);
  });
}

// ─── SIDEBAR STOP LIST ──────────────────────────────────────────────────────────
function _renderRouteStops(key) {
  const r = ROUTES[key];
  const sfx = _routeSuffix(key);
  const list  = document.getElementById('routeStopsList' + sfx);
  const empty = document.getElementById('routeStopsEmpty' + sfx);
  if (!list || !empty) return;

  empty.style.display = r.waypoints.length ? 'none' : '';
  list.innerHTML = r.waypoints.map((w, i) => `
    <div class="route-stop-item" data-idx="${i}">
      <span class="route-stop-num" style="background:${r.color}">${i + 1}</span>
      <div class="route-stop-coords">${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}</div>
      <button class="route-stop-move" data-dir="up"   title="Mover para cima"   ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="route-stop-move" data-dir="down" title="Mover para baixo" ${i === r.waypoints.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="route-stop-delete" title="Remover parada">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.route-stop-item').forEach(item => {
    const idx = Number(item.dataset.idx);
    item.querySelector('.route-stop-delete').addEventListener('click', () => {
      r.waypoints.splice(idx, 1);
      _rebuildRouteControl(key);
      _renderRouteStops(key);
    });
    item.querySelectorAll('.route-stop-move').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir === 'up' ? -1 : 1;
        const j = idx + dir;
        if (j < 0 || j >= r.waypoints.length) return;
        [r.waypoints[idx], r.waypoints[j]] = [r.waypoints[j], r.waypoints[idx]];
        _rebuildRouteControl(key);
        _renderRouteStops(key);
      });
    });
    item.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const w = r.waypoints[idx];
      map.setView([w.lat, w.lng], Math.max(map.getZoom(), 15), { animate: true });
    });
  });
}

// ─── RENAME ─────────────────────────────────────────────────────────────────────
window.renameRoute = function(key, value) {
  ROUTES[key].name = value.trim() || (key === 'a' ? 'Rota 1' : 'Rota 2');
};

// ─── CLEAR ──────────────────────────────────────────────────────────────────────
window.clearRoute = function(key) {
  if (_routePickingKey === key) window.toggleRoutePicking(key);
  const r = ROUTES[key];
  if (r.control) { map.removeControl(r.control); r.control = null; }
  r.waypoints  = [];
  r.roadCoords = null;
  _renderRouteStops(key);
  showToast(`${r.name} <span class="accent">limpa</span>`);
};

// ─── CLICK-MAP-TO-ADD-STOP ────────────────────────────────────────────────────
let _routePickingKey  = null;
let _routePickingClick = null;
let _routePickingKeydown = null;

window.toggleRoutePicking = function(key) {
  const sfx = _routeSuffix(key);
  const btn    = document.getElementById('btnRouteAdd' + sfx);
  const banner = document.getElementById('pickingBanner');

  // Turning off (either this route's picking, or switching to a different one)
  if (_routePickingKey) {
    map.off('click', _routePickingClick);
    document.removeEventListener('keydown', _routePickingKeydown);
    const prevBtn = document.getElementById('btnRouteAdd' + _routeSuffix(_routePickingKey));
    if (prevBtn) { prevBtn.classList.remove('active'); prevBtn.textContent = '📍 Clicar no mapa'; }
    map.getContainer().style.cursor = '';
    if (banner) banner.classList.remove('show');
    const wasSameRoute = _routePickingKey === key;
    _routePickingKey = null;
    _routePickingClick = null;
    _routePickingKeydown = null;
    if (wasSameRoute) return; // just cancelling — done
  }

  // Don't collide with other picking modes already in the app
  if (typeof _pontoPickingHandler !== 'undefined' && _pontoPickingHandler) window.togglePontoPicking();
  if (typeof _pickingForId !== 'undefined' && _pickingForId) cancelRelocateMode();

  // Start picking for this route
  _routePickingKey = key;
  const r = ROUTES[key];
  if (btn) { btn.classList.add('active'); btn.textContent = '✕ Cancelar'; }
  if (banner) {
    banner.textContent = `📍 Clique no mapa para adicionar parada em ${r.name} · ESC para cancelar`;
    banner.classList.add('show');
  }
  map.getContainer().style.cursor = 'crosshair';

  _routePickingClick = e => {
    r.waypoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    _rebuildRouteControl(key);
    _renderRouteStops(key);
  };
  _routePickingKeydown = e => { if (e.key === 'Escape') window.toggleRoutePicking(key); };

  map.on('click', _routePickingClick);
  document.addEventListener('keydown', _routePickingKeydown);
};

// ─── KML EXPORT ───────────────────────────────────────────────────────────────
function _escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// KML colors are aabbggrr (alpha first, byte order reversed from #rrggbb).
function _hexToKmlColor(hex, opacity) {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return (a + b + g + r).toLowerCase();
}

window.exportRoutesKML = function() {
  const ready = Object.values(ROUTES).filter(r => r.waypoints.length >= 2);
  if (!ready.length) {
    showToast('Adicione ao menos 2 paradas em uma rota antes de exportar');
    return;
  }

  const placemarks = ready.map(r => {
    // Prefer the actual road-snapped geometry; fall back to straight lines
    // between stops if OSRM hasn't resolved yet (still exports something).
    const coords = (r.roadCoords && r.roadCoords.length >= 2) ? r.roadCoords : r.waypoints;
    const coordStr = coords.map(c => `${c.lng},${c.lat},0`).join(' ');
    const kmlColor = _hexToKmlColor(r.color, 1);
    return `  <Placemark>
    <name>${_escapeXml(r.name)}</name>
    <Style><LineStyle><color>${kmlColor}</color><width>4</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
  </Placemark>`;
  }).join('\n');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
${placemarks}
</Document>
</kml>
`;

  triggerDownload(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'rotas.kml');
  showToast(`⬇ <span class="accent">${ready.length} rota${ready.length > 1 ? 's' : ''}</span> exportada${ready.length > 1 ? 's' : ''}`);
};
