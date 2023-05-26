import 'dotenv/config';

import words from './assets/words.json';
import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { GameStateI, LinesI, RoomsI, UsersI } from './interfaces';
import { shuffleArray } from './utils';
import { DEFAULT_TURN_DURATION } from './utils/const';

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
      const selectedRoom = rooms[roomNumber];
      // Find the index of the user in the room's users array
      const userIndex = selectedRoom.users.findIndex((user) => user.id === socket.id);
      if (userIndex !== -1) {
        // Remove the user from the room's users array
        selectedRoom.users.splice(userIndex, 1);
      }

      // Check if the user disconnecting is the owner and if there is more users in the room
      // it pass the ownership to the next user
      if (selectedRoom.owner === socket.id && selectedRoom.users.length > 0) {
        selectedRoom.owner = selectedRoom.users[0].id;
      }

      // If there are no more users in the room, delete the room
      if (selectedRoom.users.length === 0) {
        delete rooms[roomNumber];
        console.info(`Last user (${username}) left the room ${roomNumber}, deleted room!`);
      } else {
        // In case there are more users, update the userList to them
        io.to(roomNumber.toString()).emit('update user list', { newUsers: selectedRoom.users });
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
      const possibleTurnDurations = { min: 60000, default: DEFAULT_TURN_DURATION, max: 180000 };
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
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

  socket.on('set turn duration', ({ turnDuration, roomNumber }: { turnDuration: number; roomNumber: number }) => {
    rooms[roomNumber].gameState.turnDuration = turnDuration;
  });

  socket.on('await more players', ({ roomNumber }: { roomNumber: number }) => {
    io.to(roomNumber.toString()).emit('await more players response', {
      message: 'The leader is awaiting for more players...'
    });
  });

  socket.on('init game', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const selectedCategory = selectedRoom.gameState.category || 'Aleatorio';
    const shuffledArray = shuffleArray(words[selectedCategory as keyof typeof words]);

    const scores = selectedRoom.users.reduce((acc: Record<string, { name: string; value: number }>, user) => {
      acc[user.id] = { name: user.name, value: 0 };
      return acc;
    }, {});

    // TODO: Set a better way to shuffle the users in a room to pick the drawers.
    // TODO: maybe shuffle the words in the array and forget about getUnusedWord recursive function.
    const initialGameState: GameStateI = {
      ...selectedRoom.gameState,
      started: true,
      // currentWord: randomWord, // TODO: Send only to the drawer id!! (maybe use specific events)
      words: shuffledArray,
      previousWords: 3,
      drawer: selectedRoom.users[0],
      round: 1,
      turn: 0,
      preTurn: true,
      turnDuration: selectedRoom.gameState.turnDuration ?? DEFAULT_TURN_DURATION,
      scores: scores
    };

    // TODO: Send, before this event emit, 3 words so the drawer can choice which one
    // send something like 'pre round start' before every round to the drawer
    io.to(roomNumber.toString()).emit('game initialized', { gameState: initialGameState });

    const drawerId = selectedRoom.users[0].id;
    selectedRoom.users.forEach((user) => {
      if (user.id !== drawerId) {
        io.to(user.id).emit('pre turn no drawer', { message: 'Waiting for the drawer to chose a word' });
      }
    });
    const possibleWords = [shuffledArray[0], shuffledArray[1], shuffledArray[2]];
    io.to(drawerId).emit('pre turn drawer', { possibleWords });
  });
  // TODO: Hay que recibir el pre turn drawer response para saber que palabra escogio y luego enviar un evento
  // del estilo countdown turn start, de 4 segundos antes de iniciar el juego
  // TODO: Es necesario enviar la palabra seleccionada al drawer y al resto la palabra encriptada con *
  // esos asteriscos habrá que cambiarlos por barrabajas "_"
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
