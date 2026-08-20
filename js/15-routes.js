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

// Each route's exported/displayed name is built as:
//   PREFIX + "_" + <editable middle, optional> + "_" + <distance>KM
// The prefix is fixed per route; the distance suffix is recalculated live
// as the route is drawn/edited.
const ROUTE_NAME_PREFIX = { a: 'ROTA_ALTERNATIVA', b: 'ROTA_ORIGINAL' };

const ROUTES = {
  a: { nameMiddle: '', distanceKm: 0, color: '#ff0000', waypoints: [], control: null, roadCoords: null },
  b: { nameMiddle: '', distanceKm: 0, color: '#00ff00', waypoints: [], control: null, roadCoords: null }
};

function _routeSuffix(key) { return key === 'a' ? 'A' : 'B'; }

// ─── LD_INICIO_OAE REFERENCE POINT (found in a dropped KML) ────────────────────
// Any point whose name contains "LD_INICIO" (same case-insensitive match used
// elsewhere in the app for DNIT lookups / SNV alignment) gets a dedicated
// yellow marker named "LD_INICIO_OAE", tracked here so it travels along with
// the two routes when exported.
const LD_INICIO_COLOR = '#ffff00';
const LD_INICIO_POINTS = []; // { lat, lng } -- not shown on the map, export-only

function _extractLdInicioPointsFromKml(parsedLayer) {
  const found = [];
  parsedLayer.eachLayer(sl => {
    const props = (sl.feature && sl.feature.properties) || {};
    const name = String(props.name || '').toUpperCase();
    if (!name.includes('LD_INICIO')) return;
    const latlng = sl.getLatLng ? sl.getLatLng() : (sl.getBounds ? sl.getBounds().getCenter() : null);
    if (!latlng) return;
    found.push({ lat: latlng.lat, lng: latlng.lng });
  });
  return found;
}

// Called from loadKmlFile() once a dropped KML finishes loading:
//  1. Scans it for any LD_INICIO / LD_INICIO_OAE point and remembers it
//     (not drawn on the map -- only included later in the KML export).
//  2. Uses the KML's filename to auto-fill the editable middle segment of
//     BOTH route names.
function registerRouteKmlDrop(parsedLayer, fileName) {
  const points = _extractLdInicioPointsFromKml(parsedLayer);
  points.forEach(p => LD_INICIO_POINTS.push({ lat: p.lat, lng: p.lng }));
  if (points.length) {
    showToast(`📍 <span class="accent">${points.length}</span> ponto${points.length > 1 ? 's' : ''} LD_INICIO_OAE identificado${points.length > 1 ? 's' : ''}`);
  }

  const base = fileName.replace(/\.(kml|kmz)$/i, '');
  ['a', 'b'].forEach(key => {
    ROUTES[key].nameMiddle = base;
    const input = document.getElementById('routeName' + _routeSuffix(key));
    if (input) input.value = base;
  });
}

// Builds the full composed name, e.g. "ROTA_ALTERNATIVA_Desvio_Centro_12.4KM"
// (or "ROTA_ALTERNATIVA_12.4KM" if the editable middle is left blank).
function _composeRouteName(key) {
  const r = ROUTES[key];
  const middle = r.nameMiddle.trim();
  return `${ROUTE_NAME_PREFIX[key]}${middle ? '_' + middle : ''}_${r.distanceKm.toFixed(1)}KM`;
}

// Updates just the "_12.4KM" suffix label next to the editable name field.
function _updateRouteSuffixDisplay(key) {
  const el = document.getElementById('routeNameSuffix' + _routeSuffix(key));
  if (el) el.textContent = `_${ROUTES[key].distanceKm.toFixed(1)}KM`;
}

// ─── BUILD / REBUILD THE ROUTING LINE ──────────────────────────────────────────
function _rebuildRouteControl(key) {
  const r = ROUTES[key];

  if (r.control) {
    map.removeControl(r.control);
    r.control = null;
  }
  if (r.waypoints.length < 2) {
    r.roadCoords = null;
    r.distanceKm = 0;
    _updateRouteSuffixDisplay(key);
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

  // Capture the actual road-snapped geometry (for KML export) and the
  // driving distance (for the name suffix) from the resolved route.
  r.control.on('routesfound', e => {
    const best = e.routes && e.routes[0];
    if (best && best.coordinates) {
      r.roadCoords = best.coordinates.map(c => ({ lat: c.lat, lng: c.lng }));
    }
    if (best && best.summary && typeof best.summary.totalDistance === 'number') {
      r.distanceKm = best.summary.totalDistance / 1000;
      _updateRouteSuffixDisplay(key);
    }
  });

  r.control.on('routingerror', () => {
    showToast(`⚠ Não foi possível calcular <span class="accent">${_composeRouteName(key)}</span> — verifique a conexão`);
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

// ─── RENAME (editable middle segment only — prefix/suffix are fixed/computed) ──
window.renameRoute = function(key, value) {
  ROUTES[key].nameMiddle = value;
};

// ─── CLEAR ──────────────────────────────────────────────────────────────────────
window.clearRoute = function(key) {
  if (_routePickingKey === key) window.toggleRoutePicking(key);
  const r = ROUTES[key];
  const label = _composeRouteName(key);
  if (r.control) { map.removeControl(r.control); r.control = null; }
  r.waypoints  = [];
  r.roadCoords = null;
  r.distanceKm = 0;
  _updateRouteSuffixDisplay(key);
  _renderRouteStops(key);
  showToast(`${label} <span class="accent">limpa</span>`);
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
    banner.textContent = `📍 Clique no mapa para adicionar parada em ${_composeRouteName(key)} · ESC para cancelar`;
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
  const ready = Object.entries(ROUTES).filter(([, r]) => r.waypoints.length >= 2);
  if (!ready.length && !LD_INICIO_POINTS.length) {
    showToast('Adicione ao menos 2 paradas em uma rota antes de exportar');
    return;
  }

  const routePlacemarks = ready.map(([key, r]) => {
    // Prefer the actual road-snapped geometry; fall back to straight lines
    // between stops if OSRM hasn't resolved yet (still exports something).
    const coords = (r.roadCoords && r.roadCoords.length >= 2) ? r.roadCoords : r.waypoints;
    const coordStr = coords.map(c => `${c.lng},${c.lat},0`).join(' ');
    const kmlColor = _hexToKmlColor(r.color, 1);
    return `  <Placemark>
    <name>${_escapeXml(_composeRouteName(key))}</name>
    <Style><LineStyle><color>${kmlColor}</color><width>4</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
  </Placemark>`;
  }).join('\n');

  const ldPlacemarks = LD_INICIO_POINTS.map(p => `  <Placemark>
    <name>LD_INICIO_OAE</name>
    <Style><IconStyle><color>${_hexToKmlColor(LD_INICIO_COLOR, 1)}</color><scale>1.1</scale></IconStyle></Style>
    <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
  </Placemark>`).join('\n');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
${routePlacemarks}${routePlacemarks && ldPlacemarks ? '\n' : ''}${ldPlacemarks}
</Document>
</kml>
`;

  triggerDownload(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'rotas.kml');
  const parts = [];
  if (ready.length) parts.push(`${ready.length} rota${ready.length > 1 ? 's' : ''}`);
  if (LD_INICIO_POINTS.length) parts.push(`${LD_INICIO_POINTS.length} ponto${LD_INICIO_POINTS.length > 1 ? 's' : ''} LD_INICIO_OAE`);
  showToast(`⬇ <span class="accent">${parts.join(' + ')}</span> exportado(s)`);
};
