import 'dotenv/config';

import words from './assets/words.json';
import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { GameStateI, LinesI, RoomsI, UsersI } from './interfaces';
import { handleNextTurn, obscureString, shuffleArray } from './utils';
import { DEFAULT_CATEGORY_SELECTED, DEFAULT_POINTS_DRAWER, DEFAULT_TURN_DURATION } from './utils/const';
import { updateScoreAndTime } from './utils/updateScoreAndTime';

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
const users: { [key: string]: UsersI } = {}; // stored the socket.id as key
const rooms: { [key: string]: RoomsI } = {}; // stored the roomNumber as key

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

  socket.on(
    'chat msg',
    ({ msg, roomNumber, turnCount }: { msg: string; roomNumber: number; turnCount: number | undefined }) => {
      const roomGameState = rooms[roomNumber].gameState;

      if (turnCount && roomGameState.started && !roomGameState.preTurn && roomGameState.currentWord) {
        // If the msg is from the drawer while in his turn, return without sending
        if (roomGameState.drawer?.id === socket.id) {
          return;
        }

        // User guessed the word
        if (roomGameState.currentWord.toLowerCase() === msg.toLowerCase()) {
          const turnScoresObj = roomGameState.turnScores;
          const totalScoresObj = roomGameState.totalScores;
          const drawerId = roomGameState.drawer?.id;
          const isFirstGuesser = Object.keys(turnScoresObj ?? {}).length === 0;
          const updatedScoreTime = updateScoreAndTime({
            remainingTime: turnCount,
            totalTime: roomGameState.turnDuration ? roomGameState.turnDuration / 1000 : 120,
            firstGuesser: isFirstGuesser
          });

          // Checks if the user already guessed (in case front dont handle it correctly)
          if (turnScoresObj && turnScoresObj[socket.id]) {
            return;
          }

          // creating the totalScoresObj if didnt exist
          if (!totalScoresObj) {
            roomGameState.totalScores = {};
          }
          // updating totalScoresObj, in case that the guesser already scored
          if (totalScoresObj && totalScoresObj[socket.id]) {
            totalScoresObj[socket.id] = {
              ...totalScoresObj[socket.id],
              value: totalScoresObj[socket.id].value + updatedScoreTime.score
            };
          }
          // updating totalScoresObj, in case that the drawer already scored
          if (totalScoresObj && drawerId && totalScoresObj[drawerId]) {
            totalScoresObj[drawerId] = {
              ...totalScoresObj[drawerId],
              value: totalScoresObj[drawerId].value + DEFAULT_POINTS_DRAWER
            };
          }
          // updating totalScoresObj, if its the first time for the guesser
          if (totalScoresObj && !totalScoresObj[socket.id]) {
            totalScoresObj[socket.id] = {
              name: users[socket.id].name,
              value: updatedScoreTime.score
            };
          }
          // updating totalScoresObj, if its the first time for the drawer
          if (totalScoresObj && drawerId && !totalScoresObj[drawerId]) {
            totalScoresObj[drawerId] = {
              name: users[drawerId].name,
              value: DEFAULT_POINTS_DRAWER
            };
          }

          // creating the turnScoresObj if didnt exist
          if (!turnScoresObj) {
            roomGameState.turnScores = {};
          }
          // updating turnScoresObj for the guesser, cant be already created
          if (turnScoresObj && !turnScoresObj[socket.id]) {
            turnScoresObj[socket.id] = {
              name: users[socket.id].name,
              value: updatedScoreTime.score
            };
          }
          // updating turnScoresObj for the drawer, if already scored
          if (turnScoresObj && drawerId && turnScoresObj[drawerId]) {
            turnScoresObj[drawerId] = {
              ...turnScoresObj[drawerId],
              value: turnScoresObj[drawerId].value + DEFAULT_POINTS_DRAWER
            };
          }
          // updating turnScoresObj, if its the first time for the guesser
          if (turnScoresObj && drawerId && !turnScoresObj[drawerId]) {
            turnScoresObj[drawerId] = {
              name: users[drawerId].name,
              value: DEFAULT_POINTS_DRAWER
            };
          }

          // ?TODO: Send to the guesser a notify to display in the front that he guessed it correctly!
          // the rest of users will know since front already knows the score updated

          // Sending the updated scores
          io.to(roomNumber.toString()).emit('guessed word', {
            id: socket.id,
            msg: `El usuario ${users[socket.id].name} acertó la palabra`,
            totalScores: totalScoresObj,
            turnScores: turnScoresObj,
            updatedTime: updatedScoreTime.updatedTime
          });

          // Checks if is the last guesser. Fallback of 2 users as default
          // Adding 1 to usersGuessing since the drawer will get points aswell
          if (
            Object.keys(roomGameState.turnScores ?? {}).length >=
            (roomGameState.usersGuessing ? roomGameState.usersGuessing + 1 : 2)
          ) {
            const { nextDrawer, previousWords, nextRound, nextTurn } = handleNextTurn({
              currentGameState: roomGameState,
              currentUserList: rooms[roomNumber].users
            });
            const newState: GameStateI = {
              ...roomGameState,
              drawer: nextDrawer,
              previousWords,
              round: nextRound,
              turn: nextTurn,
              preTurn: true
            };
            rooms[roomNumber].gameState = newState;
            io.to(roomNumber.toString()).emit('show scoreboard');
            io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
          }
          console.dir(rooms, { depth: null });
          return;
        }
      }
      // This will send the event to all clients connected to the concrete room, including the one that initiated the event.
      io.to(roomNumber.toString()).emit('chat msg', { user: users[socket.id].name, msg });
    }
  );

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
    // TODO: send the gameState to the joined user from a no drawer
    // TODO: send what has been drawed until now
    // the joined user, in case that is not a preTurn, he shouldnt be able to draw and chat
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
    // Sending the turnDuration to all the users except the leader (since it already knows)
    socket.to(roomNumber.toString()).emit('set new turn duration', { turnDuration });
  });

  socket.on('await more players', ({ roomNumber }: { roomNumber: number }) => {
    io.to(roomNumber.toString()).emit('await more players response', {
      message: 'The leader is awaiting for more players...'
    });
  });

  socket.on('init game', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const selectedCategory = selectedRoom.gameState.category || DEFAULT_CATEGORY_SELECTED;
    const shuffledArray = shuffleArray(words[selectedCategory as keyof typeof words]);

    const scores = selectedRoom.users.reduce((acc: Record<string, { name: string; value: number }>, user) => {
      acc[user.id] = { name: user.name, value: 0 };
      return acc;
    }, {});

    // TODO: Set a better way to shuffle the users in a room to pick the drawers.
    const initialGameState: GameStateI = {
      ...selectedRoom.gameState,
      started: true,
      words: shuffledArray,
      drawer: selectedRoom.users[0],
      round: 1,
      turn: 0,
      preTurn: true,
      turnDuration: selectedRoom.gameState.turnDuration ?? DEFAULT_TURN_DURATION,
      category: selectedCategory,
      totalScores: scores,
      turnScores: {}
    };
    selectedRoom.gameState = initialGameState;

    io.to(roomNumber.toString()).emit('update game state front', { gameState: initialGameState });

    const drawerId = selectedRoom.users[0].id;
    selectedRoom.users.forEach((user) => {
      if (user.id !== drawerId) {
        io.to(user.id).emit('pre turn no drawer', { message: 'Waiting for the drawer to chose a word' });
      }
    });
    const possibleWords = [shuffledArray[0], shuffledArray[1], shuffledArray[2]];
    io.to(drawerId).emit('pre turn drawer', { possibleWords });
  });

  socket.on('set drawer word', ({ roomNumber, word }: { roomNumber: number; word: string }) => {
    const selectedRoom = rooms[roomNumber];
    const cryptedWord = obscureString(word);
    const newGameState: GameStateI = {
      ...selectedRoom.gameState,
      currentWord: word,
      cryptedWord,
      preTurn: false
    };

    selectedRoom.gameState = newGameState;

    io.to(roomNumber.toString()).emit('update game state front', {
      gameState: newGameState
    });

    // init preTurn countdown on front
    io.to(roomNumber.toString()).emit('countdown preDraw start');
  });

  socket.on('starting turn', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const usersInRoom = Object.keys(selectedRoom.users).length;
    // update the users playing this turn (drawer doesn't count)
    selectedRoom.gameState.usersGuessing = usersInRoom - 1;

    // init turn countdown on front
    io.to(roomNumber.toString()).emit('countdown turn', { usersGuessing: usersInRoom - 1 });
  });

  socket.on('turn finished', ({ roomNumber }: { roomNumber: number }) => {
    const { nextDrawer, previousWords, nextRound, nextTurn } = handleNextTurn({
      currentGameState: rooms[roomNumber].gameState,
      currentUserList: rooms[roomNumber].users
    });
    const newState = {
      ...rooms[roomNumber].gameState,
      drawer: nextDrawer,
      previousWords,
      round: nextRound,
      turn: nextTurn,
      preTurn: true
    };
    rooms[roomNumber].gameState = newState;
    io.to(roomNumber.toString()).emit('show scoreboard');
    io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
  });

  // TODO: When someone joins in the middle of a game. The crypted word should be sent
  // TODO: Recieve an event to update the word with more letters displayed (more hints)

  // TODO: send the event when scoreboard finish (drawer already changed)
  // TODO: Back will send the pre turn drawer and front will answer with set drawer word event
  // and keep the cycle

  // TODO: Watch when is the last turn in the last round to send a finish game event
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
