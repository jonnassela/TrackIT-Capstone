#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <WiFiClientSecure.h>


const char* ssid     = "Qershi";
const char* password = "Stella1177";

// Your Node.js server
// const char* serverUrl = "https://preoccupied-nondichogamic-linda.ngrok-free.dev/api/gps";
// const char* serverUrl = "https://f482-79-125-233-76.ngrok-free.app/api/gps";
const char* serverUrl = "https://trackit-9ipy.onrender.com/api/gps";
const char* deviceId  = "esp32-bus-1";
//const char* deviceId = "esp32-bus-2";

WebServer server(80);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

#define RXD2 14
#define TXD2 13
#define GPS_BAUD 9600

double latitude  = 0.0;
double longitude = 0.0;
double speedKmph = 0.0;
unsigned long lastSend = 0;

String webpage = R"====(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 GPS Tracker</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; font-family: sans-serif; background: #1a1a2e; color: white; }
    #map { height: 80vh; width: 100%; }
    #info { padding: 10px; text-align: center; background: #16213e; }
    #info span { margin: 0 20px; font-size: 18px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="info">
    <span>📍 Lat: <b id="lat">--</b></span>
    <span>📍 Lng: <b id="lng">--</b></span>
    <span>🚀 Speed: <b id="speed">--</b> km/h</span>
  </div>
  <script>
    var map = L.map('map').setView([42.0026, 20.9735], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    var marker = L.marker([42.0026, 20.9735]).addTo(map);
    function updateData() {
      fetch('/gps')
        .then(r => r.json())
        .then(d => {
          if (d.lat !== 0) {
            document.getElementById('lat').innerText = d.lat.toFixed(6);
            document.getElementById('lng').innerText = d.lng.toFixed(6);
            document.getElementById('speed').innerText = d.speed.toFixed(1);
            var pos = [d.lat, d.lng];
            marker.setLatLng(pos);
            map.setView(pos, 15);
          }
        });
    }
    setInterval(updateData, 1000);
  </script>
</body>
</html>
)====";

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, RXD2, TXD2);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected! IP: " + WiFi.localIP().toString());

  server.on("/", []() { server.send(200, "text/html", webpage); });
  server.on("/gps", []() {
    String json = "{\"lat\":" + String(latitude, 6) +
                  ",\"lng\":" + String(longitude, 6) +
                  ",\"speed\":" + String(speedKmph, 2) + "}";
    server.send(200, "application/json", json);
  });
  server.begin();
}

void sendToServer(); // forward declaration

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isUpdated()) {
    latitude  = gps.location.lat();
    longitude = gps.location.lng();
    speedKmph = gps.speed.kmph();
    Serial.printf("📍 Lat: %.6f  Lng: %.6f  Speed: %.1f\n", latitude, longitude, speedKmph);
  }

  // Post to Node.js every 2 seconds
  if (millis() - lastSend >= 2000 && latitude != 0.0) {
    sendToServer();
    lastSend = millis();
  }

  server.handleClient();
}


void sendToServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected");
    return;
  }

  Serial.println("Attempting connection to: " + String(serverUrl));

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure(); // skip SSL cert verification
  
  http.begin(client, serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("ngrok-skip-browser-warning", "true"); // skip ngrok warning page
  http.setTimeout(10000);

  String body = "{\"deviceId\":\"esp32-bus-1\","
                "\"lat\":"  + String(latitude, 6)  + ","
                "\"lng\":"  + String(longitude, 6) + ","
                "\"speed\":" + String(speedKmph, 2) + "}";

  Serial.println("Sending: " + body);
  int code = http.POST(body);
  Serial.println("Response code: " + String(code));
  
  if (code < 0) {
    Serial.println("Error: " + http.errorToString(code));
  }
  
  http.end();
}