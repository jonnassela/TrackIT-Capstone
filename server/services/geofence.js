// ─────────────────────────────────────────────────────────────────────────
// Geofence arrival detection.
//
// A geofence is just a circle around each stop. When a bus's GPS position
// falls inside the circle, we treat it as "arrived". We fire the arrival
// callback only on the transition from outside -> inside (so it fires once
// per arrival, not every second the bus sits at the stop).
//
// We use "nearest stop within radius" semantics: even if two stops are close
// together, only the single closest one is considered "arrived", which avoids
// double-firing when geofences overlap.
// ─────────────────────────────────────────────────────────────────────────

const { getNearby, distMeters } = require('./places');
const { getAllStops, routes } = require('./busState');

const GEOFENCE_RADIUS_M = 140; // tune: smaller = must be closer to count as arrived

// Which stop each bus is currently "inside" (busId -> stopId | null)
const activeStop = {};

// Build a flat list of {id, name, lat, lng} for the stops on a given line.
function stopsForLine(lineId) {
  const all = getAllStops();
  return Object.values(all).filter((s) => (s.lines || []).includes(lineId));
}

// Find the nearest stop to a position that is also within the geofence radius.
function nearestStopWithinRadius(lat, lng, stops) {
  let best = null;
  let bestDist = Infinity;
  for (const stop of stops) {
    const d = distMeters(lat, lng, stop.lat, stop.lng);
    if (d < bestDist) {
      bestDist = d;
      best = stop;
    }
  }
  if (best && bestDist <= GEOFENCE_RADIUS_M) {
    return { stop: best, distance: bestDist };
  }
  return null;
}

// Check one bus. If it just arrived at a new stop, fetch nearby
// recommendations and call onArrival({ busId, stop, ...nearby }).
async function checkBus(bus, onArrival) {
  if (!bus || bus.lat == null || bus.lng == null) return;

  // Fall back to all stops if the line isn't known (e.g. ESP32 real bus)
  let stops = stopsForLine(bus.lineId);
  if (!stops.length) stops = Object.values(getAllStops());

  const hit = nearestStopWithinRadius(bus.lat, bus.lng, stops);
  const currentlyAt = hit ? hit.stop.id : null;
  const previouslyAt = activeStop[bus.busId] || null;

  if (currentlyAt && currentlyAt !== previouslyAt) {
    // Transition into a NEW stop's geofence → arrival event
    activeStop[bus.busId] = currentlyAt;
    try {
      const nearby = await getNearby(hit.stop);
      onArrival({
        busId: bus.busId,
        busName: bus.name,
        color: bus.color,
        lineId: bus.lineId,
        stop: { id: hit.stop.id, name: hit.stop.name, lat: hit.stop.lat, lng: hit.stop.lng },
        distance: hit.distance,
        ...nearby,
      });
    } catch (err) {
      console.error('Geofence onArrival error:', err.message);
    }
  } else if (!currentlyAt && previouslyAt) {
    // Bus left the geofence → reset so a later return re-triggers
    activeStop[bus.busId] = null;
  }
}

// Check every live bus. Call this after each position update batch.
async function checkAll(buses, onArrival) {
  for (const bus of buses) {
    await checkBus(bus, onArrival);
  }
}

module.exports = { checkAll, checkBus, GEOFENCE_RADIUS_M };