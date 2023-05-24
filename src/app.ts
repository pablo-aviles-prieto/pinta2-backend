import 'dotenv/config';

import words from './assets/words.json';
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
// ROOMS:
// socket.to(room).emit sends a message to all clients in the specified room except for the client on which socket is called (except to the user that init the event).
// io.to(room).emit sends a message to all clients in the specified room.
io.on('connection', (socket) => {
  socket.on('register', (username) => {
    usersAmount++;
    users[socket.id] = { name: username };
    console.info(`${username} connected // Total users => ${usersAmount}`);
  });

  socket.on('disconnect', () => {
    usersAmount--;
    const username = users[socket.id].name;
    const roomNumber = users[socket.id]?.room;

    if (roomNumber) {
      // Find the index of the user in the room's users array
      const userIndex = rooms[roomNumber].users.findIndex((user) => user.id === socket.id);
      if (userIndex !== -1) {
        // Remove the user from the room's users array
        rooms[roomNumber].users.splice(userIndex, 1);
      }

      // Check if the user disconnecting is the owner and if there is more users in the room
      // it pass the ownership to the next user
      if (rooms[roomNumber].owner === socket.id && rooms[roomNumber].users.length > 0) {
        rooms[roomNumber].owner = rooms[roomNumber].users[0].id;
      }

      // If there are no more users in the room, delete the room
      if (rooms[roomNumber].users.length === 0) {
        delete rooms[roomNumber];
        console.info(`Last user (${username}) left the room ${roomNumber}, deleted room!`);
      }
    }

    delete users[socket.id];
    console.info(`${username} disconnected // Total users => ${usersAmount}`);
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
      const roomUsers = [{ id: socket.id, name: users[socket.id].name }];
      rooms[roomNumber] = {
        owner: socket.id,
        password: roomPassword,
        users: roomUsers,
        gameState: { started: false }
      };
      users[socket.id].room = roomNumber;
      socket.emit('create room response', {
        success: true,
        message: 'Room successfully created',
        room: roomNumber,
        roomUsers
      });
      console.dir(rooms, { depth: null });
    }
  });

  socket.on('join room', ({ roomNumber, roomPassword }: { roomNumber: number; roomPassword: string }) => {
    if (!rooms[roomNumber]) {
      socket.emit('join room response', { success: false, message: 'Room does not exist', room: roomNumber });
      return;
    }

    const selectedRoom = rooms[roomNumber];
    const passwordMatches = selectedRoom.password === roomPassword;

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
    selectedRoom.users.push({ id: socket.id, name: username });
    // add the roomNumber to the room prop in users obj
    users[socket.id].room = roomNumber;

    // notify all sockets in the room that a new user has joined
    io.to(roomNumber.toString()).emit('user joined', { username });

    if (selectedRoom.users.length >= 3 && !selectedRoom.gameState.started) {
      const roomOwner = selectedRoom.owner;
      const categories = Object.keys(words);
      socket.to(roomOwner).emit('pre game', { categories });
    }

    io.to(roomNumber.toString()).emit('update user list', { newUsers: selectedRoom.users });
    // respond to the joining socket with success
    socket.emit('join room response', {
      success: true,
      message: 'Successfully joined room',
      room: roomNumber,
      newUsers: selectedRoom.users // Sending the updated userList to the user just joined the room
    });

    console.dir(rooms, { depth: null });
  });

  socket.on('set room category', ({ category, roomNumber }: { category: string; roomNumber: number }) => {
    rooms[roomNumber].gameState.category = category;
  });
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
