import 'dotenv/config';

import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { LinesI } from './interfaces';

const { PORT } = process.env;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173'
  }
});

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
  socket.on('chat msg', (msg: string) => {
    // This will send the event to all connected clients, including the one that initiated the event.
    io.emit('chat msg', msg);
  });
  socket.on('new segment', (lineLength: number, lineSegment: LinesI) => {
    // This will send the event to all clients except for the one that initiated the event
    socket.broadcast.emit('new segment', lineLength, lineSegment);
  });
  socket.on('clear board', () => {
    socket.broadcast.emit('clear board');
  });
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
