require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────
// Nearby places + events for a bus stop.
//
// Cafes / restaurants / things-to-do come from the Google Places API (New).
// Events do NOT exist in Google Places, so they come from a small curated
// list below (edit it freely — see CURATED_EVENTS).
//
// Everything is cached per stop, because the cafes around a bus stop do not
// change second-to-second. That keeps us to ~1 API call per stop instead of
// one per arrival, so you stay well inside the free Places quota.
// ─────────────────────────────────────────────────────────────────────────

// Prefer the key from .env. If your .env isn't loading (you saw "injected
// env (0)" in the log), paste the key here as a fallback so the demo works.
const GOOGLE_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_PLACES_API_KEY ||
  'AIzaSyDMr3fhlx-bWwHQSELxZpzvDaZZGfwqEVE'; // <-- you can hardcode your key here for the hackathon if .env won't load

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SEARCH_RADIUS_M = 250;             // how far around the stop to look
const cache = new Map();                 // stopId -> { ts, data }

// Haversine distance in meters
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ── Curated local events ───────────────────────────────────────────────────
// Google Places has no "events" data, so list real local events here.
// Each event is matched to the nearest stop automatically by its lat/lng.
// Replace these with real Tetovo events before your demo.
const CURATED_EVENTS = [
  {
    title: 'Live Jazz Night',
    venue: 'City Center',
    category: 'Music',
    when: 'Fri 21:00',
    lat: 42.0076, lng: 20.9689,
  },
  {
    title: 'Farmers Market',
    venue: 'Old Bazaar',
    category: 'Market',
    when: 'Sat 08:00',
    lat: 41.9957, lng: 20.9610,
  },
  {
    title: 'Student Tech Meetup',
    venue: 'SEEU Campus',
    category: 'Tech',
    when: 'Thu 18:00',
    lat: 41.9894, lng: 20.9596,
  },
  {
    title: 'Weekend Sales',
    venue: 'Palma Mall',
    category: 'Shopping',
    when: 'Sat–Sun',
    lat: 42.0044, lng: 20.9879,
  },
];

const EVENT_MATCH_RADIUS_M = 500; // an event "belongs" to stops within this range

function eventsNearStop(stop) {
  return CURATED_EVENTS
    .map((e) => ({ ...e, distance: distMeters(stop.lat, stop.lng, e.lat, e.lng) }))
    .filter((e) => e.distance <= EVENT_MATCH_RADIUS_M)
    .sort((a, b) => a.distance - b.distance);
}

// ── Google Places (New) Nearby Search ───────────────────────────────────────
async function fetchGooglePlaces(lat, lng) {
  if (!GOOGLE_KEY) return null; // signal: no key, caller will use fallback

  const body = {
    includedTypes: ['cafe', 'restaurant', 'bakery', 'bar', 'tourist_attraction'],
    maxResultCount: 10,
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: SEARCH_RADIUS_M,
      },
    },
  };

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': [
        'places.displayName',
        'places.rating',
        'places.userRatingCount',
        'places.types',
        'places.location',
        'places.currentOpeningHours.openNow',
        'places.primaryTypeDisplayName',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) {
    // e.g. REQUEST_DENIED (referer-restricted key), API not enabled, etc.
    console.error('Places API error:', data.error.status, '-', data.error.message);
    return null;
  }

  const places = (data.places || []).map((p) => ({
    name: p.displayName?.text || 'Unknown',
    rating: p.rating || null,
    reviews: p.userRatingCount || 0,
    openNow: p.currentOpeningHours?.openNow ?? null,
    kind: p.primaryTypeDisplayName?.text || (p.types && p.types[0]) || 'place',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    distance: p.location
      ? distMeters(lat, lng, p.location.latitude, p.location.longitude)
      : null,
  }));

  places.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
  return places;
}

// ── Fallback sample data (so the demo always shows something) ───────────────
// Clearly labelled as samples — these are placeholders, not real businesses.
function fallbackPlaces() {
  return [
    { name: 'Sample Café (add API key for live data)', rating: 4.6, reviews: 120, openNow: true,  kind: 'Cafe',       lat: null, lng: null, distance: 80,  sample: true },
    { name: 'Sample Bakery',                            rating: 4.4, reviews: 64,  openNow: true,  kind: 'Bakery',     lat: null, lng: null, distance: 130, sample: true },
    { name: 'Sample Restaurant',                        rating: 4.2, reviews: 210, openNow: false, kind: 'Restaurant', lat: null, lng: null, distance: 190, sample: true },
  ];
}

// ── Public API: get nearby places + events for a stop (cached) ──────────────
async function getNearby(stop) {
  const cached = cache.get(stop.id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let places;
  try {
    places = await fetchGooglePlaces(stop.lat, stop.lng);
  } catch (err) {
    console.error('Places fetch failed:', err.message);
    places = null;
  }

  const usedFallback = !places || places.length === 0;
  if (usedFallback) places = fallbackPlaces();

  const data = {
    stopId: stop.id,
    stopName: stop.name,
    places: places.slice(0, 6),
    events: eventsNearStop(stop),
    source: usedFallback ? 'sample' : 'google',
  };

  cache.set(stop.id, { ts: Date.now(), data });
  return data;
}

module.exports = { getNearby, distMeters };