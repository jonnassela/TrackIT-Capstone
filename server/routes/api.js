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
// ESP32 posts GPS here
router.post('/gps', async (req, res) => {
  const { deviceId, lat, lng, speed } = req.body;

  if (!deviceId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  const busSpeed = Number(speed) || 0;

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  updateBus(deviceId, {
    lat: latitude,
    lng: longitude,
    speed: busSpeed,
    lineId: 'line-1',
    lineName: 'Line 1 - SEEU ↔ Palma Mall',
    shortName: '1',
    color: '#00FF88',
    name: 'Real Bus (ESP32)',
    passengers: 0,
    isReal: true,
  });

  req.io.emit('busUpdate', { buses: getBusPositions() });

  const thisBus = getBusPositions().find(b => b.busId === deviceId);

  if (thisBus) {
    geofence.checkBus(thisBus, (arrival) => {
      console.log(`📍 ${arrival.busName} arrived at ${arrival.stop.name}`);
      req.io.emit('busArrival', arrival);
    }).catch(e => console.error('geofence:', e.message));
  }

  try {
    await db.query(
      `INSERT INTO buses (id, name, route_id, is_real)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [deviceId, 'Real Bus (ESP32)', 'line-1']
    );

    await db.query(
      `INSERT INTO gps_logs (bus_id, lat, lng, speed)
       VALUES ($1, $2, $3, $4)`,
      [deviceId, latitude, longitude, busSpeed]
    );
  } catch (err) {
    console.error('DB write error:', err.message);
  }

  console.log(`📡 GPS: ${deviceId} → ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

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

router.post('/chatbot', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const q = question.toLowerCase();

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  try {
    let requestedBusId = null;

    if (
      q.includes('esp') ||
      q.includes('esp32') ||
      q.includes('real') ||
      q.includes('gps')
    ) {
      requestedBusId = 'esp32-bus-1';
    }

    if (
      q.includes('201') ||
      q.includes('bus 201') ||
      q.includes('simulator') ||
      q.includes('simulated')
    ) {
      requestedBusId = 'bus-201';
    }

    let busId;
    let busName;
    let busLat;
    let busLng;
    let currentSpeed;
    let recordedAt;
    let source;

    const liveBuses = getBusPositions();

    let liveBus = null;

    if (requestedBusId) {
      liveBus = liveBuses.find(b =>
        b.busId === requestedBusId ||
        b.id === requestedBusId
      );
    } else {
      liveBus =
        liveBuses.find(b => b.busId === 'esp32-bus-1' || b.id === 'esp32-bus-1') ||
        liveBuses.find(b => b.isReal === true) ||
        liveBuses.find(b => b.busId === 'bus-201' || b.id === 'bus-201') ||
        liveBuses[0];
    }

    if (liveBus) {
      busId = liveBus.busId || liveBus.id;
      busName = liveBus.name || busId;
      busLat = Number(liveBus.lat);
      busLng = Number(liveBus.lng);
      currentSpeed = Number(liveBus.speed) || 0;
      recordedAt = 'live now';
      source = busId === 'esp32-bus-1' ? 'live ESP32 GPS' : 'live simulator';
    } else {
      const fallbackBusId = requestedBusId || 'esp32-bus-1';

      const latest = await db.query(`
        SELECT bus_id, lat, lng, speed, recorded_at
        FROM gps_logs
        WHERE bus_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
      `, [fallbackBusId]);

      if (!latest.rows.length) {
        return res.json({
          answer: `I do not have live or saved GPS data for ${fallbackBusId}.`
        });
      }

      const bus = latest.rows[0];

      busId = bus.bus_id;
      busName = busId === 'esp32-bus-1' ? 'Real Bus ESP32' : busId;
      busLat = Number(bus.lat);
      busLng = Number(bus.lng);
      currentSpeed = Number(bus.speed) || 0;
      recordedAt = bus.recorded_at;
      source = 'database history';
    }

    if (Number.isNaN(busLat) || Number.isNaN(busLng)) {
      return res.json({
        answer: 'GPS data exists, but the coordinates are invalid.'
      });
    }

    const avgResult = await db.query(`
      SELECT AVG(speed) AS avg_speed
      FROM gps_logs
      WHERE bus_id = $1
        AND speed > 3
    `, [busId]);

    let avgSpeed = Number(avgResult.rows[0].avg_speed);

    if (!avgSpeed || avgSpeed < 5) {
      avgSpeed = busId === 'bus-201' ? 25 : 18;
    }

    const stops = Object.values(getAllStops());

    const stopsWithDistance = stops.map(stop => ({
      ...stop,
      distance: distanceKm(busLat, busLng, stop.lat, stop.lng)
    })).sort((a, b) => a.distance - b.distance);

    const nearestStop = stopsWithDistance[0];

    let selectedStop = nearestStop;

    for (const stop of stops) {
      const name = (stop.name || '').toLowerCase();

      if (
        q.includes('seeu') ||
        q.includes('uejl') ||
        q.includes('universitet')
      ) {
        if (
          name.includes('seeu') ||
          name.includes('uejl') ||
          name.includes('universitet')
        ) {
          selectedStop = stop;
          break;
        }
      }

      if (q.includes('palma') && name.includes('palma')) {
        selectedStop = stop;
        break;
      }

      if (q.includes('qendra') && name.includes('qendra')) {
        selectedStop = stop;
        break;
      }

      if (q.includes('mall') && name.includes('mall')) {
        selectedStop = stop;
        break;
      }

      if (q.includes(name)) {
        selectedStop = stop;
        break;
      }
    }

    const distanceToSelected = distanceKm(
      busLat,
      busLng,
      selectedStop.lat,
      selectedStop.lng
    );

    const etaMinutes = Math.max(
      1,
      Math.round((distanceToSelected / avgSpeed) * 60)
    );

    if (
      q.includes('where') ||
      q.includes('location') ||
      q.includes('ku') ||
      q.includes('pozicion')
    ) {
      return res.json({
        answer: `${busName} is currently near ${nearestStop.name}. Coordinates: ${busLat.toFixed(5)}, ${busLng.toFixed(5)}. Speed: ${currentSpeed.toFixed(1)} km/h. Source: ${source}. Time: ${recordedAt}.`
      });
    }

    if (
      q.includes('when') ||
      q.includes('arrive') ||
      q.includes('eta') ||
      q.includes('kur') ||
      q.includes('mberrin') ||
      q.includes('mbërrin')
    ) {
      return res.json({
        answer: `${busName} is about ${distanceToSelected.toFixed(2)} km from ${selectedStop.name}. Based on average speed (${avgSpeed.toFixed(1)} km/h), ETA is around ${etaMinutes} minutes. Source: ${source}.`
      });
    }

    if (
      q.includes('delay') ||
      q.includes('late') ||
      q.includes('vones')
    ) {
      if (currentSpeed < 3) {
        return res.json({
          answer: `${busName} may be stopped or moving very slowly. Current speed is ${currentSpeed.toFixed(1)} km/h, while the usual average is about ${avgSpeed.toFixed(1)} km/h. Source: ${source}.`
        });
      }

      if (currentSpeed < avgSpeed * 0.5) {
        return res.json({
          answer: `Possible delay detected for ${busName}. Current speed is ${currentSpeed.toFixed(1)} km/h, much lower than the average of ${avgSpeed.toFixed(1)} km/h. Source: ${source}.`
        });
      }

      return res.json({
        answer: `No major delay detected for ${busName}. Current speed is ${currentSpeed.toFixed(1)} km/h and average is about ${avgSpeed.toFixed(1)} km/h. Source: ${source}.`
      });
    }

    if (
      q.includes('speed') ||
      q.includes('average') ||
      q.includes('shpejt')
    ) {
      return res.json({
        answer: `${busName} average speed is about ${avgSpeed.toFixed(1)} km/h. Latest/live speed is ${currentSpeed.toFixed(1)} km/h. Source: ${source}.`
      });
    }

    return res.json({
      answer: `I can answer about ETA, current location, speed, and delays. Please ask for "real bus" or "bus 201".`
    });

  } catch (err) {
    console.error('Chatbot error:', err.message);
    res.status(500).json({ error: 'Chatbot failed' });
  }
});
module.exports = router;