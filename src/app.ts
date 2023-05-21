import 'dotenv/config';

import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { LinesI, RoomsI, UsersI } from './interfaces';

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

let usersAmount = 0;
// Save an array of users with the socket.id, username and assigned color for chat?
const users: { [key: string]: UsersI } = {};
const rooms: { [key: string]: RoomsI } = {};

// socket.emit => sends a message to the socket connection (client) that we're currently dealing with
// io.emit => sends a message to all connected sockets (clients)
// socket.broadcast.emit => sends a message to all connected sockets (clients), except for the one that we're currently dealing with
io.on('connection', (socket) => {
  socket.on('register', (username) => {
    usersAmount++;
    users[socket.id] = { name: username };
    console.info(`${username} connected // Total users => ${usersAmount}`);
  });

  socket.on('disconnect', () => {
    usersAmount--;
    const username = users[socket.id].name;
    console.info(`${username} disconnected // Total users => ${usersAmount}`);
    delete users[socket.id];
  });

  socket.on('chat msg', (msg: string) => {
    // This will send the event to all connected clients, including the one that initiated the event.
    io.emit('chat msg', { user: users[socket.id].name, msg });
  });

  socket.on('new segment', (lineLength: number, lineSegment: LinesI) => {
    // This will send the event to all clients except for the one that initiated the event
    socket.broadcast.emit('new segment', lineLength, lineSegment);
  });

  socket.on('clear board', () => {
    socket.broadcast.emit('clear board');
  });

  socket.on('create room', ({ roomNumber, roomPassword }) => {
    if (rooms[roomNumber]) {
      socket.emit('create room response', { success: false, message: 'Room already exists' });
      console.log('Room already exists');
    } else {
      rooms[roomNumber] = {
        password: roomPassword,
        users: [{ id: socket.id, name: users[socket.id].name }]
      };
      socket.emit('create room response', { success: true, message: 'Room successfully created' });
      console.dir(rooms, { depth: null });
    }
  });
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
