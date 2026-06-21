require('dotenv').config();

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Decode Google encoded polyline
function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// Get road polyline between two points
async function getRoadPath(fromLat, fromLng, toLat, toLng) {
  if (!GOOGLE_KEY) return [[fromLat, fromLng], [toLat, toLng]];
  try {
    const body = {
      origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
      destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
      travelMode: 'DRIVE',
    };
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const encoded = data?.routes?.[0]?.polyline?.encodedPolyline;
    if (encoded) return decodePolyline(encoded);
    return [[fromLat, fromLng], [toLat, toLng]];
  } catch (e) {
    console.error('Road path error:', e.message);
    return [[fromLat, fromLng], [toLat, toLng]];
  }
}

// Build full route polyline from stop list
async function buildRouteCoords(stops) {
  const allCoords = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const segment = await getRoadPath(stops[i].lat, stops[i].lng, stops[i+1].lat, stops[i+1].lng);
    if (i === 0) allCoords.push(...segment);
    else allCoords.push(...segment.slice(1)); // avoid duplicate points
  }
  return allCoords;
}

module.exports = { buildRouteCoords };