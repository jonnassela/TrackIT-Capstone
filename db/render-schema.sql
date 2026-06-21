-- Tetovo Transit Database Schema
-- Run this once: psql -U postgres -d postgres -f schema.sql

-- Create database


-- Bus lines / routes
CREATE TABLE IF NOT EXISTS routes (
  id          VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(10) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Stops along each route
CREATE TABLE IF NOT EXISTS stops (
  id          VARCHAR(20) PRIMARY KEY,
  route_id    VARCHAR(20) REFERENCES routes(id),
  name        VARCHAR(100) NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  stop_order  INT NOT NULL
);

-- Registered buses
CREATE TABLE IF NOT EXISTS buses (
  id          VARCHAR(50) PRIMARY KEY,  -- e.g. 'esp32-bus-1'
  name        VARCHAR(100) NOT NULL,
  route_id    VARCHAR(20) REFERENCES routes(id),
  is_real     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- GPS location log — every position received
CREATE TABLE IF NOT EXISTS gps_logs (
  id          SERIAL PRIMARY KEY,
  bus_id      VARCHAR(50) REFERENCES buses(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed       DOUBLE PRECISION DEFAULT 0,
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_gps_logs_bus_time ON gps_logs(bus_id, recorded_at DESC);

-- Delay reports from passengers
CREATE TABLE IF NOT EXISTS delay_reports (
  id          SERIAL PRIMARY KEY,
  stop_id     VARCHAR(20) REFERENCES stops(id),
  route_id    VARCHAR(20) REFERENCES routes(id),
  reported_at TIMESTAMP DEFAULT NOW()
);

-- =====================
-- SEED DATA
-- =====================

-- Routes
INSERT INTO routes (id, name, color) VALUES
  ('line-1', 'Line 1 - SEEU ↔ Palma Mall', '#00D4FF'),
  ('line-2', 'Line 2 - SEEU ↔ Palma Mall (Express)', '#FF6B6B')
ON CONFLICT (id) DO NOTHING;

-- Stops for Line 1
INSERT INTO stops (id, route_id, name, lat, lng, stop_order) VALUES
  ('s1', 'line-1', 'SEEU - Universiteti',  41.98942945816049, 20.959567236840996, 1),
  ('s2', 'line-1', 'Çarshia e Vjetër',     41.99568035488875, 20.96098397356397,  2),
  ('s3', 'line-1', 'Qendra - Tetovë',      42.001138398719064,20.96203136445419,  3),
  ('s4', 'line-1', 'Bulevardi',            42.00725734460502, 20.96872594854915,  4),
  ('s5', 'line-1', 'Palma Mall',           42.00440219807939, 20.98779310344983,  5)
ON CONFLICT (id) DO NOTHING;

-- Stops for Line 2 (express subset)
INSERT INTO stops (id, route_id, name, lat, lng, stop_order) VALUES
  ('s6', 'line-2', 'SEEU - Universiteti',  41.98942945816049, 20.959567236840996, 1),
  ('s7', 'line-2', 'Qendra - Tetovë',      42.001138398719064,20.96203136445419,  2),
  ('s8', 'line-2', 'Bulevardi',            42.00569865575784, 20.967255844140425, 3),
  ('s9', 'line-2', 'Palma Mall',           42.00440219807939, 20.98779310344983,  4)
ON CONFLICT (id) DO NOTHING;

-- Buses (simulated + real ESP32)
INSERT INTO buses (id, name, route_id, is_real) VALUES
  ('bus-101',      'Bus 101',         'line-1', FALSE),
  ('bus-102',      'Bus 102',         'line-1', FALSE),
  ('bus-201',      'Bus 201',         'line-2', FALSE),
  ('bus-202',      'Bus 202',         'line-2', FALSE),
  ('esp32-bus-1',  'Real Bus (ESP32)','line-1', TRUE)
ON CONFLICT (id) DO NOTHING;
