require('dotenv').config();
const { updateBus, routes } = require('./busState');
const { buildRouteCoords } = require('./routeLoader');
const geofence = require('./geofence');

// Emit a 'busArrival' event whenever a bus enters a stop's geofence.
function emitArrival(io) {
  return (arrival) => {
    console.log(`📍 ${arrival.busName} arrived at ${arrival.stop.name} — ${arrival.places.length} places, ${arrival.events.length} events nearby`);
    io.emit('busArrival', arrival);
  };
}

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// ─── Line 1 simple simulator (progress-based) ──────────────────────────────
const line1Buses = [];

function interpolate(coords, progress) {
  const total = coords.length - 1;
  const scaled = progress * total;
  const idx = Math.min(Math.floor(scaled), total - 1);
  const t = scaled - idx;
  const from = coords[idx];
  const to = coords[Math.min(idx + 1, total)];
  return {
    lat: from[0] + (to[0] - from[0]) * t,
    lng: from[1] + (to[1] - from[1]) * t,
  };
}

// ─── Line 2 smart bus (Google Routes API) ─────────────────────────────────
// State for bus-201: moves stop to stop with real durations
const bus201 = {
  id: 'bus-201',
  lineId: 'line-2',
  name: 'Bus 201',
  currentStopIdx: 0,   // which stop it just left
  direction: 1,        // 1 = forward, -1 = reverse
  segmentDurations: [], // seconds between each consecutive stop pair
  segmentElapsed: 0,   // seconds elapsed in current segment
  lat: 0, lng: 0,
  speed: 0,
  loaded: false,
};

// Call Google Routes API to get duration between two points
async function getRouteDuration(fromLat, fromLng, toLat, toLng) {
  if (!GOOGLE_KEY) return 120; // fallback 2 min if no key
  try {
    const body = {
      origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
      destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    };
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'routes.duration',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const dur = data?.routes?.[0]?.duration;
    if (dur) {
      // duration is like "123s"
      return parseInt(dur.replace('s', ''), 10);
    }
    return 120;
  } catch (e) {
    console.error('Google Routes error:', e.message);
    return 120;
  }
}

// Load real durations for all segments of line-2
async function loadLine2Durations() {
  const route = routes['line-2'];
  if (!route) return;
  const stops = route.stops;
  console.log('Loading real traffic durations for Line 2 from Google Routes API...');
  const durations = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const dur = await getRouteDuration(stops[i].lat, stops[i].lng, stops[i+1].lat, stops[i+1].lng);
    durations.push(dur);
    console.log(`  ${stops[i].name} → ${stops[i+1].name}: ${dur}s (${(dur/60).toFixed(1)} min)`);
  }
  bus201.segmentDurations = durations;
  bus201.lat = stops[0].lat;
  bus201.lng = stops[0].lng;
  bus201.loaded = true;
  console.log('Line 2 durations loaded.');
}

// Tick the smart bus every second
function tickBus201() {
  if (!bus201.loaded) return;
  const route = routes['line-2'];
  if (!route) return;
  const stops = route.stops;

  const nextIdx = bus201.currentStopIdx + bus201.direction;
  if (nextIdx < 0 || nextIdx >= stops.length) {
    // Flip direction at terminals
    bus201.direction *= -1;
    bus201.segmentElapsed = 0;
    return;
  }

  const segIdx = bus201.direction === 1 ? bus201.currentStopIdx : nextIdx;
  const totalSec = bus201.segmentDurations[segIdx] || 120;
  bus201.segmentElapsed += 1;

  const t = Math.min(bus201.segmentElapsed / totalSec, 1);

  // Interpolate position between current and next stop
  const from = stops[bus201.currentStopIdx];
  const to   = stops[nextIdx];
  bus201.lat = from.lat + (to.lat - from.lat) * t;
  bus201.lng = from.lng + (to.lng - from.lng) * t;

  // Estimate speed from distance / time
  const R = 6371000;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const dist = Math.sqrt(dLat*dLat + dLng*dLng) * R;
  bus201.speed = totalSec > 0 ? (dist / totalSec) * 3.6 : 20;

  // Arrived at next stop
  if (t >= 1) {
    bus201.currentStopIdx = nextIdx;
    bus201.segmentElapsed = 0;
    // Dwell at stop for 10 seconds
    setTimeout(() => {}, 10000);
  }

  updateBus(bus201.id, {
    lat: bus201.lat,
    lng: bus201.lng,
    speed: Math.round(bus201.speed),
    lineId: 'line-2',
    lineName: route.name,
    shortName: route.shortName,
    color: route.color,
    name: bus201.name,
    passengers: Math.floor(Math.random() * 30) + 5,
    isReal: false,
    currentStop: stops[bus201.currentStopIdx]?.name,
    nextStop: stops[nextIdx]?.name,
    etaToNext: Math.max(0, Math.round((totalSec - bus201.segmentElapsed) / 60)),
  });
}

// ─── Main start ────────────────────────────────────────────────────────────
async function start(io) {
  // Load real road polyline for line-2
  const line2Route = routes['line-2'];
  if (line2Route && GOOGLE_KEY) {
    console.log('Loading real road path for Line 2 from Google Routes API...');
    const realCoords = await buildRouteCoords(line2Route.stops);
    if (realCoords.length > 2) {
      line2Route.coords = realCoords;
      console.log(`Line 2 road path loaded — ${realCoords.length} points`);
    }
  }

  // Start Line 2 Google-powered bus
  await loadLine2Durations();

  setInterval(() => {
    // Line 1 simple buses
    line1Buses.forEach(bus => {
      const route = routes[bus.lineId];
      if (!route) return;
      bus.progress += bus.direction * 0.003;
      if (bus.progress >= 1) { bus.progress = 1; bus.direction = -1; }
      if (bus.progress <= 0) { bus.progress = 0; bus.direction  = 1; }
      const pos = interpolate(route.coords, bus.progress);
      updateBus(bus.id, {
        lat: pos.lat, lng: pos.lng,
        speed: bus.speed + (Math.random() - 0.5) * 4,
        lineId: bus.lineId, lineName: route.name,
        shortName: route.shortName,
        color: route.color, name: bus.name,
        passengers: Math.floor(Math.random() * 35) + 5,
        isReal: false,
      });
    });

    // Line 2 smart bus
    tickBus201();

    const { getBusPositions } = require('./busState');
    const buses = getBusPositions();
    io.emit('busUpdate', { buses });

    // Geofence: check every bus for stop arrivals, emit recommendations
    geofence.checkAll(buses, emitArrival(io)).catch(e => console.error('geofence:', e.message));
  }, 1000);

  console.log('Simulator running — Line 1 (simple) + Line 2 (Google traffic-aware)');
}

module.exports = { start };