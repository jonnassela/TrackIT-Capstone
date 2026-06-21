const busPositions = {};
const delayReports = {};
const stopVisits = {};

// Official timetable from tetovatransport.mk - Line 1 (UEJL → Palma Mall)
// Departures from UEJL (stop A)
const timetable = {
  'line-1': [
    '07:00','08:00','09:00','09:55','11:30','12:45','14:15','15:25','16:30','17:45','19:15','20:20','21:25',
  ]
};

// Minutes from UEJL to each stop (from official timetable)
const stopOffsets = {
  'UEJL':      0,
  'MOLINO':    1,
  'ANTILOP':   3,
  'SHIPADI':   5,
  'MAKPET':    6,
  'ROTRING':   8,
  'XHAMIA':    10,
  'SPARKASSE': 11,
  'PALLATI':   13,
  'VERO':      15,
  'PALMA':     25,
};

// All stops — Line 1 (A-K) + Line 2 (L2A-L2J)
const allStops = {
  'UEJL':     { id: 'UEJL',     code: 'A', name: 'UEJL',               lat: 41.9903000,  lng: 20.9600000,  lines: ['line-1'] },
  'MOLINO':   { id: 'MOLINO',   code: 'B', name: 'Ultra - Molino',     lat: 41.9916228,  lng: 20.9597453,  lines: ['line-1'] },
  'ANTILOP':  { id: 'ANTILOP',  code: 'C', name: 'Hit Mobilje',        lat: 41.9960000,  lng: 20.9610000,  lines: ['line-1'] },
  'SHIPADI':  { id: 'SHIPADI',  code: 'D', name: 'Shipadi',            lat: 42.001021,   lng: 20.962089,   lines: ['line-1'] },
  'MAKPET':   { id: 'MAKPET',   code: 'E', name: 'Mak Petrol',         lat: 42.0040000,  lng: 20.9650000,  lines: ['line-1'] },
  'ROTRING':  { id: 'ROTRING',  code: 'F', name: 'Mostar - Rotring',   lat: 42.007566,   lng: 20.975931,   lines: ['line-1'] },
  'XHAMIA':   { id: 'XHAMIA',   code: 'G', name: 'Xhamia e Larme',    lat: 42.0057167,  lng: 20.9667568,  lines: ['line-1'] },
  'SPARKASSE':{ id: 'SPARKASSE',code: 'H', name: 'Shparkasse Bank',    lat: 42.0091295,  lng: 20.9702380,  lines: ['line-1'] },
  'PALLATI':  { id: 'PALLATI',  code: 'I', name: 'Pallati i Kulturës', lat: 42.0093694,  lng: 20.9725333,  lines: ['line-1'] },
  'VERO':     { id: 'VERO',     code: 'J', name: 'Vero Jumbo',         lat: 42.0047000,  lng: 20.9820000,  lines: ['line-1'] },
  'PALMA':    { id: 'PALMA',    code: 'K', name: 'Pallma Mall',        lat: 42.0043537,  lng: 20.9894132,  lines: ['line-1'] },
  // Line 2 stops
  'L2A': { id: 'L2A', name: 'С. Цепчиште',                       lat: 42.0341014, lng: 21.0016635, lines: ['line-2'] },
  'L2B': { id: 'L2B', name: 'С. Пороj - Џамија Дреновец',        lat: 42.0285625, lng: 20.9981719, lines: ['line-2'] },
  'L2C': { id: 'L2C', name: 'О.С.У "7 Марси" - Детска Градинка', lat: 42.0193875, lng: 20.9818281, lines: ['line-2'] },
  'L2D': { id: 'L2D', name: 'Музичко Училиште',                   lat: 42.0140013, lng: 20.9712996, lines: ['line-2'] },
  'L2E': { id: 'L2E', name: 'Суд (Центар)',                       lat: 42.0076125, lng: 20.9689219, lines: ['line-2'] },
  'L2F': { id: 'L2F', name: 'Шарена Џамија - Мостар',            lat: 42.0052633, lng: 20.9670300, lines: ['line-2'] },
  'L2G': { id: 'L2G', name: 'ZEGIN',                             lat: 42.0088487, lng: 20.9711122, lines: ['line-2'] },
  'L2H': { id: 'L2H', name: '"Антилоп" Мобел',                   lat: 42.0112297, lng: 20.9725217, lines: ['line-2'] },
  'L2I': { id: 'L2I', name: 'Беџети Компани',                    lat: 41.9909741, lng: 20.9597659, lines: ['line-2'] },
  'L2J': { id: 'L2J', name: 'ЈИЕУ (Штул)',                       lat: 41.9886863, lng: 20.9622693, lines: ['line-2'] },
};

// Get next departures from a stop
function getNextDepartures(stopId, lineId, count = 3) {
  const departures = timetable[lineId];
  if (!departures) return [];
  const offset = stopOffsets[stopId] || 0;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  return departures
    .map(dep => {
      const [h, m] = dep.split(':').map(Number);
      const arrivalMins = h * 60 + m + offset;
      const diffMins = arrivalMins - nowMins;
      return { time: `${String(h).padStart(2,'0')}:${String((m+offset)%60).padStart(2,'0')}`, diffMins };
    })
    .filter(d => d.diffMins > -1)
    .slice(0, count);
}

const routes = {
  'line-1': {
    name: 'Linja 1 - UEJL ↔ Pallma Mall',
    shortName: '1',
    color: '#00D4FF',
    coords: [
      [41.98942945816049, 20.959567236840996],
      [41.99006964181558, 20.959716531154385],
      [41.99022541886467, 20.95992611740266],
      [41.99036199021003, 20.96006966962696],
      [41.99051136478411, 20.95994334366955],
      [41.99166793960708, 20.960158672795558],
      [41.99350873303976, 20.960528003768957],
      [41.99568035488875, 20.96098397356397],
      [41.99655352721388, 20.961182140052358],
      [41.996690280581845, 20.961302454308395],
      [41.99684281283709, 20.96123168121659],
      [41.99878888194141, 20.961592623985723],
      [41.99928328183381, 20.961698787538353],
      [41.99947262444974, 20.961889874886197],
      [41.999635669029345, 20.96174125139342],
      [42.001138398719064, 20.96203136445419],
      [42.00315151062267, 20.96367270010154],
      [42.00319887719456, 20.96399140605294],
      [42.00335281831039, 20.96411888843312],
      [42.004280004845526, 20.965691638680852],
      [42.00569865575784, 20.967255844140425],
      [42.00725734460502, 20.96872594854915],
      [42.008778495276914, 20.970328475134494],
      [42.00952949540172, 20.971154692915178],
      [42.009526227003875, 20.971370614538955],
      [42.0087829985944, 20.97292546852671],
      [42.00858829001285, 20.973053814457558],
      [42.00862140443601, 20.973187512093205],
      [42.00806949513199, 20.97454429551081],
      [42.00747710730556, 20.97631207457468],
      [42.007284528211756, 20.976460007054015],
      [42.00733604058493, 20.976767016439652],
      [42.00676940218463, 20.97839614689292],
      [42.0061291683414, 20.980134216642483],
      [42.00588999886074, 20.98032733571128],
      [42.00594151236308, 20.980698718033835],
      [42.00554412226725, 20.982005979669168],
      [42.005098894266155, 20.983422184256938],
      [42.004940671994575, 20.984001540679486],
      [42.00399500962607, 20.98780944792881],
      [42.003868650445725, 20.987946608143943],
      [42.00391648593333, 20.988114968129537],
      [42.00403791431768, 20.988139726951005],
      [42.00413726464126, 20.988035739900994],
      [42.004232935177015, 20.98801098107964],
      [42.004317566684506, 20.98808030577956],
      [42.00440219807939, 20.98779310344983],
    ],
    stops: Object.values(allStops),
  },
  'line-2': {
    name: 'Linja 2 - Çepçishte ↔ JIEU',
    shortName: '2',
    color: '#8B5CF6',
    coords: [
      // Çepçishte down to Shparkasse (unique path)
      [42.0341014,  21.0016635],
      [42.0285625,  20.9981719],
      [42.0193875,  20.9818281],
      [42.0140013,  20.9712996],
      [42.0112297,  20.9725217],
      [42.0091295,  20.9702380],
      // Shparkasse → UEJL: shared with line-1 reversed
      [42.008778495276914, 20.970328475134494],
      [42.00725734460502,  20.96872594854915],
      [42.00569865575784,  20.967255844140425],
      [42.004280004845526, 20.965691638680852],
      [42.00335281831039,  20.96411888843312],
      [42.001138398719064, 20.96203136445419],
      [41.999635669029345, 20.96174125139342],
      [41.99878888194141,  20.961592623985723],
      [41.99568035488875,  20.96098397356397],
      [41.99350873303976,  20.960528003768957],
      [41.99166793960708,  20.960158672795558],
      [41.99036199021003,  20.96006966962696],
      [41.99006964181558,  20.959716531154385],
      [41.98942945816049,  20.959567236840996],
    ],
    stops: [
      { id: 'L2A', name: 'С. Цепчиште',                        lat: 42.0341014, lng: 21.0016635 },
      { id: 'L2B', name: 'С. Пороj - Џамија Дреновец',         lat: 42.0285625, lng: 20.9981719 },
      { id: 'L2C', name: 'О.С.У "7 Марси" - Детска Градинка',  lat: 42.0193875, lng: 20.9818281 },
      { id: 'L2D', name: 'Музичко Училиште',                    lat: 42.0140013, lng: 20.9712996 },
      { id: 'L2E', name: 'Суд (Центар)',                        lat: 42.0076125, lng: 20.9689219 },
      { id: 'L2F', name: 'Шарена Џамија - Мостар',             lat: 42.0052633, lng: 20.9670300 },
      { id: 'L2G', name: 'Шипад - Мак Петрол',                 lat: 42.0088487, lng: 20.9711122 },
      { id: 'L2H', name: '"Антилоп" Мобел',                    lat: 42.0112297, lng: 20.9725217 },
      { id: 'L2I', name: 'Беџети Компани',                     lat: 41.9909741, lng: 20.9597659 },
      { id: 'L2J', name: 'ЈИЕУ (Штул)',                        lat: 41.9886863, lng: 20.9622693 },
    ],
  },
};

function updateBus(busId, data) {
  const prev = busPositions[busId];
  busPositions[busId] = {
    ...data, busId, timestamp: Date.now(),
    history: prev ? [...(prev.history || []).slice(-20), { lat: prev.lat, lng: prev.lng }] : []
  };
}

function getBusPositions() { return Object.values(busPositions); }
function getRoutes() { return routes; }
function getAllStops() { return allStops; }
function getStats() { return {}; }

function addDelayReport(stopId, lineId) {
  const key = `${stopId}-${lineId}`;
  delayReports[key] = (delayReports[key] || 0) + 1;
  return delayReports[key];
}
function getDelayReports() { return delayReports; }
function recordStopVisit(stopId) { stopVisits[stopId] = (stopVisits[stopId] || 0) + 1; }
function getStopVisits() { return stopVisits; }

function calculateETA(busLat, busLng, stopLat, stopLng, speedKmph) {
  const R = 6371;
  const dLat = (stopLat - busLat) * Math.PI / 180;
  const dLng = (stopLng - busLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(busLat*Math.PI/180)*Math.cos(stopLat*Math.PI/180)*Math.sin(dLng/2)**2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const speed = Math.max(speedKmph || 25, 5);
  return Math.round((dist / speed) * 60);
}

module.exports = { updateBus, getBusPositions, getRoutes, getAllStops, getStats, addDelayReport, getDelayReports, recordStopVisit, getStopVisits, calculateETA, routes, getNextDepartures };