const express = require('express');
const router = express.Router();
const db = require('../db');
const geofence = require('../services/geofence');
const { getNearby } = require('../services/places');
const {
  updateBus, getBusPositions, getRoutes, getAllStops, getStats,
  addDelayReport, getDelayReports, getStopVisits,
  calculateETA, routes, getNextDepartures
} = require('../services/busState');


// Serve non-sensitive config to frontend (keeps API keys out of client code)
router.get('/config', (req, res) => {
  res.json({
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
});

// ESP32 posts GPS here
router.post('/gps', async (req, res) => {
  const { deviceId, lat, lng, speed } = req.body;
  if (!deviceId || lat === undefined || lng === undefined)
    return res.status(400).json({ error: 'Missing fields' });

  updateBus(deviceId, {
    lat, lng, speed,
    lineId: 'line-1',
    lineName: 'Line 1 - SEEU ↔ Palma Mall',
    shortName: '1',
    color: '#00FF88',
    name: 'Real Bus (ESP32)',
    passengers: 0,
    isReal: true,
  });
  req.io.emit('busUpdate', { buses: getBusPositions() });

  // Geofence check for the real bus — fire arrival recommendations
  const thisBus = getBusPositions().find(b => b.busId === deviceId);
  if (thisBus) {
    geofence.checkBus(thisBus, (arrival) => {
      console.log(`📍 ${arrival.busName} arrived at ${arrival.stop.name}`);
      req.io.emit('busArrival', arrival);
    }).catch(e => console.error('geofence:', e.message));
  }

  try {
    await db.query(
      'INSERT INTO gps_logs (bus_id, lat, lng, speed) VALUES ($1, $2, $3, $4)',
      [deviceId, lat, lng, speed || 0]
    );
  } catch (err) { console.error('DB write error:', err.message); }

  console.log(`📡 GPS: ${deviceId} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  res.json({ ok: true });
});

// Get all live buses
router.get('/buses', (req, res) => res.json(getBusPositions()));

// Get routes
router.get('/routes', (req, res) => res.json(getRoutes()));

// Get all stops with line info + live ETAs
router.get('/stops', (req, res) => {
  const stops = getAllStops();
  const buses = getBusPositions();
  const allRoutes = getRoutes();

  const stopsWithETA = Object.values(stops).map(stop => {
    // For each line that passes through this stop, find the nearest bus and its ETA
    const lineETAs = stop.lines.map(lineId => {
      const route = allRoutes[lineId];
      if (!route) return null;
      // Find all buses on this line
      const lineBuses = buses.filter(b => b.lineId === lineId);
      if (!lineBuses.length) return { lineId, color: route.color, shortName: route.shortName, eta: null };
      // Get the minimum ETA among all buses on this line
      const etas = lineBuses.map(b => calculateETA(b.lat, b.lng, stop.lat, stop.lng, b.speed));
      const minEta = Math.min(...etas);
      return { lineId, color: route.color, shortName: route.shortName, name: route.name, eta: minEta };
    }).filter(Boolean);

    return { ...stop, lineETAs };
  });

  res.json(stopsWithETA);
});

// ETA for a specific bus
router.get('/eta/:busId', (req, res) => {
  const buses = getBusPositions();
  const bus = buses.find(b => b.busId === req.params.busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });
  const route = routes[bus.lineId];
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const stops = route.stops;
  const speed = Math.max(bus.speed || 25, 5);

  // Find which stop the bus is closest to (its current position)
  let closestIdx = 0;
  let minDist = Infinity;
  stops.forEach((stop, i) => {
    const d = Math.sqrt(
      Math.pow(bus.lat - stop.lat, 2) + Math.pow(bus.lng - stop.lng, 2)
    );
    if (d < minDist) { minDist = d; closestIdx = i; }
  });

  // ETA to the closest stop (direct distance)
  const etaToClosest = calculateETA(bus.lat, bus.lng, stops[closestIdx].lat, stops[closestIdx].lng, speed);

  // Build sequential ETAs: stops before closest = passed, stops after = cumulative
  let cumulativeEta = etaToClosest;
  const etas = stops.map((stop, i) => {
    if (i < closestIdx) {
      return { ...stop, eta: -1 }; // already passed
    } else if (i === closestIdx) {
      return { ...stop, eta: etaToClosest };
    } else {
      // Add travel time from previous stop to this stop
      const legEta = calculateETA(stops[i-1].lat, stops[i-1].lng, stop.lat, stop.lng, speed);
      cumulativeEta += legEta;
      return { ...stop, eta: cumulativeEta };
    }
  });

  res.json(etas);
});

// GPS history
router.get('/history/:busId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT lat, lng, speed, recorded_at FROM gps_logs
       WHERE bus_id = $1 ORDER BY recorded_at DESC LIMIT 200`,
      [req.params.busId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Report delay
router.post('/report', async (req, res) => {
  const { stopId, lineId } = req.body;
  if (!stopId || !lineId) return res.status(400).json({ error: 'Missing fields' });
  addDelayReport(stopId, lineId);
  try {
    await db.query('INSERT INTO delay_reports (stop_id, route_id) VALUES ($1, $2)', [stopId, lineId]);
  } catch (err) { /* non-fatal */ }
  req.io.emit('delayReport', { stopId, lineId });
  res.json({ ok: true });
});

// Heatmap
router.get('/heatmap', async (req, res) => {
  const allStops = getAllStops();
  try {
    const results = await Promise.all(Object.values(allStops).map(async stop => {
      const { rows } = await db.query(
        `SELECT COUNT(*) as cnt FROM gps_logs
         WHERE ABS(lat - $1) < 0.002 AND ABS(lng - $2) < 0.002`,
        [stop.lat, stop.lng]
      ).catch(() => ({ rows: [{ cnt: Math.floor(Math.random() * 80) + 10 }] }));
      return { ...stop, intensity: parseInt(rows[0].cnt) || 10 };
    }));
    res.json(results);
  } catch (err) {
    res.json(Object.values(allStops).map(s => ({ ...s, intensity: Math.floor(Math.random() * 80) + 10 })));
  }
});

router.get('/stats', (req, res) => res.json(getStats()));

// Nearby cafes + events for a stop (used on tap, and cached server-side)
router.get('/nearby/:stopId', async (req, res) => {
  const stops = getAllStops();
  const stop = stops[req.params.stopId];
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  try {
    const data = await getNearby(stop);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;