require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.use((req, res, next) => { req.io = io; next(); });
app.use('/api', require('./routes/api'));

const simulator = require('./services/simulator');
simulator.start(io);

io.on('connection', (socket) => {
  console.log('🌐 Client connected:', socket.id);
  const { getBusPositions } = require('./services/busState');
  socket.emit('initialState', { buses: getBusPositions() });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚌 Server running on http://localhost:${PORT}`));
