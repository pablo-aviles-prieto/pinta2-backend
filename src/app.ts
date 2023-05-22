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
    // TODO: Remove the user from the room, and delete the room if there are no more users connected to it
  });

  socket.on('chat msg', ({ msg, roomNumber }: { msg: string; roomNumber: number }) => {
    // This will send the event to all clients connected to the concrete room, including the one that initiated the event.
    io.to(roomNumber.toString()).emit('chat msg', { user: users[socket.id].name, msg });
  });

  socket.on(
    'new segment',
    ({ lineLength, lineSegment, roomNumber }: { lineLength: number; lineSegment: LinesI; roomNumber: number }) => {
      // This will send the event to all clients in the specified room, except for the one that initiated the event.
      socket.broadcast.to(roomNumber.toString()).emit('new segment', lineLength, lineSegment);
    }
  );

  socket.on('clear board', ({ roomNumber }: { roomNumber: number }) => {
    socket.broadcast.to(roomNumber.toString()).emit('clear board');
  });

  socket.on('create room', ({ roomNumber, roomPassword }: { roomNumber: number; roomPassword: string }) => {
    if (rooms[roomNumber]) {
      socket.emit('create room response', { success: false, message: 'Room already exists', room: roomNumber });
      console.log('Room already exists');
    } else {
      socket.join(roomNumber.toString());
      rooms[roomNumber] = {
        owner: socket.id,
        password: roomPassword,
        users: [{ id: socket.id, name: users[socket.id].name, score: 0, isDrawing: false }]
      };
      users[socket.id].room = roomNumber;
      socket.emit('create room response', { success: true, message: 'Room successfully created', room: roomNumber });
      console.dir(rooms, { depth: null });
    }
  });

  socket.on('join room', ({ roomNumber, roomPassword }) => {
    if (!rooms[roomNumber]) {
      socket.emit('join room response', { success: false, message: 'Room does not exist', room: roomNumber });
    } else {
      const passwordMatches = rooms[roomNumber].password === roomPassword;

      if (!passwordMatches) {
        socket.emit('join room response', {
          success: false,
          message: `Check the provided credentials`,
          room: roomNumber
        });
        return;
      }

      // join the socket to the room
      socket.join(roomNumber.toString());

      const username = users[socket.id].name;
      // add the user to the room's users array
      rooms[roomNumber].users.push({ id: socket.id, name: username, score: 0, isDrawing: false });
      // add the roomNumber to the room prop in users obj
      users[socket.id].room = roomNumber;

      // notify all sockets in the room that a new user has joined
      io.to(roomNumber.toString()).emit('user joined', { username });

      // respond to the joining socket with success
      socket.emit('join room response', { success: true, message: 'Successfully joined room', room: roomNumber });

      console.dir(rooms, { depth: null });
    }
  });
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
