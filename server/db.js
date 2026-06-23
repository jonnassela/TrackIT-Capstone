require('dotenv').config({ path: __dirname + '/.env' });
const { Pool } = require('pg');


const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for Railway PostgreSQL
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'tetovo_transit',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || 'admin',
    });

pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(err => console.error('❌ PostgreSQL connection failed:', err.message));


  async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS routes (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stops (
        id VARCHAR(20) PRIMARY KEY,
        route_id VARCHAR(20) REFERENCES routes(id),
        name VARCHAR(100) NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        stop_order INT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS buses (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        route_id VARCHAR(20) REFERENCES routes(id),
        is_real BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gps_logs (
        id SERIAL PRIMARY KEY,
        bus_id VARCHAR(50) REFERENCES buses(id),
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        speed DOUBLE PRECISION DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS delay_reports (
        id SERIAL PRIMARY KEY,
        stop_id VARCHAR(20) REFERENCES stops(id),
        route_id VARCHAR(20) REFERENCES routes(id),
        reported_at TIMESTAMP DEFAULT NOW()
      );

      INSERT INTO routes (id, name, color) VALUES
        ('line-1', 'Line 1 - SEEU ↔ Palma Mall', '#00D4FF'),
        ('line-2', 'Line 2 - Çepçishtë ↔ UEJL', '#8B5CF6')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO buses (id, name, route_id, is_real) VALUES
        ('bus-201', 'Bus 201', 'line-2', FALSE),
        ('esp32-bus-1', 'Real Bus ESP32', 'line-1', TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  }
}

initDatabase();
module.exports = pool;
