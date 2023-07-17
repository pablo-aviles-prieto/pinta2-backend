import 'dotenv/config';

import words from './assets/words.json';
import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { GameStateI, LinesI, RoomsI, UserI, UsersI } from './interfaces';
import {
  getCategoriesAndTurnDuration,
  getUniqueColor,
  handleNextTurn,
  handleRemoveUser,
  handleRemoveUserOnRoom,
  obscureString,
  shuffleArray,
  updateListMessage,
  updateScoreAndTime
} from './utils';
import {
  DEFAULT_CATEGORY_SELECTED,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_POINTS_DRAWER,
  DEFAULT_TURN_DURATION,
  FALLBACK_USER_COLOR,
  USER_LIGHT_COLORS
  // USER_DARK_COLORS
} from './utils/const';

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

  // TODO: There is a bug when a user joined the room, cant draw and chat, is not counting on usersGuessing
  // but when it leaves, it reduces the usersGuessing, and it shouldnt substract 1 to usersGuessing
  socket.on('disconnect', () => {
    console.log('disconnect event');
    console.log('socket', socket.id);
    console.log('users', users);
    usersAmount--;
    const username = users[socket.id].name;
    const roomNumber = users[socket.id]?.room;

    // Checks if the user joined a room
    if (roomNumber) {
      const selectedRoom = rooms[roomNumber];

      // If there are no more users in the room, delete the room, the user and return
      if (selectedRoom.users.length <= 1) {
        delete rooms[roomNumber];
        console.info(`Last user (${username}) left the room ${roomNumber}, deleted room!`);
        handleRemoveUser({ socket, username, users, usersAmount });
        return;
      }

      const userIndex = selectedRoom.users.findIndex((user) => user.id === socket.id);
      const isOwner = selectedRoom.owner === socket.id;

      // if the game didnt start yet, just update the user list
      if (!selectedRoom.gameState.started) {
        handleRemoveUserOnRoom({
          socket,
          username,
          users,
          usersAmount,
          userIndex,
          selectedRoom,
          roomNumber,
          io,
          isOwner
        });
        return;
      }

      // checks if its in the endGame and who left was the owner
      if (selectedRoom.gameState.endGame && selectedRoom.owner === socket.id) {
        const newOwner = selectedRoom.users[1].id;
        io.to(roomNumber.toString()).emit('resend game ended', { owner: newOwner });
      }

      // Not enough players on room, game cancelled
      // checking if its lesser or equal than 3 since the user is not deleted yet from the obj
      if (selectedRoom.users.length <= 3) {
        const newState = { started: false };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
        io.to(roomNumber.toString()).emit('game cancelled', {
          msg: `Partida cancelada, esperando a que haya el mínimo de jugadores(3) para volver a empezar`
        });

        handleRemoveUserOnRoom({
          socket,
          username,
          users,
          usersAmount,
          userIndex,
          selectedRoom,
          roomNumber,
          io,
          isOwner
        });
        return;
      }

      const roomGameState = selectedRoom.gameState;

      // Checking if the user who left is the drawer and passing to next turn if proceeds
      if (selectedRoom.gameState.drawer?.id === socket.id) {
        // If there are scores in turnScores, substract it on totalScores
        if (roomGameState.turnScores && roomGameState.totalScores) {
          for (const key in roomGameState.turnScores) {
            if (roomGameState.totalScores.hasOwnProperty(key)) {
              roomGameState.totalScores[key].value -= roomGameState.turnScores[key].value;
            }
          }
        }

        const wasLastTurn = userIndex >= Object.keys(selectedRoom.users).length - 1;
        // updating the next round if necessary
        const nextRound = !wasLastTurn ? roomGameState.round : roomGameState.round ? roomGameState.round + 1 : 1;
        // updating the next turn. If its not the last index the drawer, we just assign the same turn,
        // since the drawer will be removed from the users array
        const nextTurn = !wasLastTurn ? roomGameState.turn : 0;
        // If its not the last turn, we get the next user and assign it
        const nextDrawer = wasLastTurn ? selectedRoom.users[0] : selectedRoom.users[userIndex + 1];
        const previousWords = roomGameState.previousWords ? roomGameState.previousWords + 3 : 3;

        // Remove the user from the totalScores object if exists (being drawer)
        if (roomGameState.totalScores?.hasOwnProperty(socket.id)) {
          delete roomGameState.totalScores[socket.id];
        }
        const newState: GameStateI = {
          ...roomGameState,
          drawer: nextDrawer,
          previousWords,
          round: nextRound,
          turn: nextTurn,
          turnScores: {},
          preTurn: true
        };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });

        // Checks if this was the last turn of last round (being drawer)
        if ((nextRound ?? 0) > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
          // If the drawer is the owner, we pass the owner to the next user
          // since the owner is the index 0 in the selectedRoom users array
          const newOwner = isOwner ? selectedRoom.users[1].id : selectedRoom.owner;
          selectedRoom.gameState.endGame = true;
          io.to(roomNumber.toString()).emit('game ended', { owner: newOwner });
        } else {
          io.to(roomNumber.toString()).emit('show scoreboard');
        }
        handleRemoveUserOnRoom({
          socket,
          username,
          users,
          usersAmount,
          userIndex,
          selectedRoom,
          roomNumber,
          io,
          isOwner
        });
        return;
      }

      const newGuessers = (roomGameState.usersGuessing ?? 2) - 1;

      // Removing from turnScores and totalScores in case that the user scored this turn
      if (
        roomGameState.turnScores &&
        roomGameState.totalScores &&
        roomGameState.turnScores[socket.id] &&
        roomGameState.totalScores[socket.id] &&
        selectedRoom.gameState.drawer?.id !== socket.id
      ) {
        delete roomGameState.totalScores[socket.id];
        delete roomGameState.turnScores[socket.id];
        // substract to the drawer the points from this user
        if (
          roomGameState.drawer?.id &&
          roomGameState.turnScores[roomGameState.drawer.id] &&
          roomGameState.totalScores[roomGameState.drawer.id]
        ) {
          roomGameState.turnScores[roomGameState.drawer.id].value -= DEFAULT_POINTS_DRAWER;
          roomGameState.totalScores[roomGameState.drawer.id].value -= DEFAULT_POINTS_DRAWER;
        }

        // updating the score states and the usersGuessing
        const newState: GameStateI = { ...roomGameState, usersGuessing: newGuessers };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
      }

      // Removing from totalScores if the user didnt score in this turn (being no drawer)
      if (
        roomGameState.totalScores &&
        roomGameState.totalScores[socket.id] &&
        selectedRoom.gameState.drawer?.id !== socket.id &&
        !roomGameState.turnScores?.hasOwnProperty(socket.id)
      ) {
        delete roomGameState.totalScores[socket.id];
        const newState: GameStateI = { ...roomGameState, usersGuessing: newGuessers };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
      }

      const drawerIndex = selectedRoom.users.findIndex((user) => user.id === roomGameState.drawer?.id ?? '');

      // If its in preTurn, it just remove the user, and handle edge cases on drawer
      if (selectedRoom.gameState.preTurn) {
        // Remove the user from the totalScores object (doesnt match the if condition in previous blocks)
        if (roomGameState.totalScores && roomGameState.totalScores[socket.id]) {
          delete roomGameState.totalScores[socket.id];
        }

        // In preTurn, the drawer, round, turn and previousWords has been updated for next turn
        let newState: GameStateI = { ...roomGameState, usersGuessing: newGuessers };
        if (selectedRoom.gameState.drawer?.id === socket.id) {
          // Checking if the drawer is the next last turn and if it resets to a new round
          if (drawerIndex >= Object.keys(selectedRoom.users).length - 1) {
            const nextRound = (roomGameState.round ?? 1) + 1;
            newState = {
              ...roomGameState,
              usersGuessing: newGuessers,
              drawer: selectedRoom.users[0],
              turn: 0,
              round: nextRound
            };
            // Checks if this was the last turn of the last round
            if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
              io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
              // If the user who left is the owner, we pass the owner to the next user
              const newOwner = isOwner ? selectedRoom.users[1].id : selectedRoom.owner;
              selectedRoom.gameState.endGame = true;
              io.to(roomNumber.toString()).emit('game ended', { owner: newOwner });
              handleRemoveUserOnRoom({
                socket,
                username,
                users,
                usersAmount,
                userIndex,
                selectedRoom,
                roomNumber,
                io,
                isOwner
              });
              return;
            }
          } else {
            newState = {
              ...roomGameState,
              usersGuessing: newGuessers,
              drawer: selectedRoom.users[drawerIndex + 1]
            };
          }
        }

        // checking if the user who left, already drew in the current round
        if (userIndex < drawerIndex) {
          newState = {
            ...roomGameState,
            usersGuessing: newGuessers,
            turn: (roomGameState.turn ?? 1) - 1
          };
        }

        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
        handleRemoveUserOnRoom({
          socket,
          username,
          users,
          usersAmount,
          userIndex,
          selectedRoom,
          roomNumber,
          io,
          isOwner
        });
        return;
      }

      let nextRound: number;
      let nextTurn: number;
      let nextDrawer: UserI;
      const previousWords = roomGameState.previousWords ? roomGameState.previousWords + 3 : 3;

      // checking if the user who left, already drew in the current round
      if (userIndex < drawerIndex) {
        if (roomGameState.turn === undefined || roomGameState.round === undefined) return;
        const wasLastTurn = drawerIndex >= Object.keys(selectedRoom.users).length - 1;
        nextTurn = wasLastTurn ? 0 : roomGameState.turn;
        nextRound = !wasLastTurn ? roomGameState.round : roomGameState.round + 1;
        nextDrawer = selectedRoom.users[drawerIndex + 1];
        if (wasLastTurn) {
          // checking if the user leaving is the 1st, so we assign the drawer to the 2nd user
          nextDrawer = userIndex === 0 ? selectedRoom.users[1] : selectedRoom.users[0];
        }
      } else {
        if (roomGameState.turn === undefined || roomGameState.round === undefined) return;
        const userWasLast = userIndex >= Object.keys(selectedRoom.users).length - 1;
        const userIsNextToDrawer = userIndex - drawerIndex === 1;
        nextTurn = roomGameState.turn + 1;
        nextRound = roomGameState.round;
        nextDrawer = selectedRoom.users[drawerIndex + 1];
        if (userIsNextToDrawer && !userWasLast) {
          // bypassing the user since is leaving, and we know there is more users after the user leaving
          nextDrawer = selectedRoom.users[drawerIndex + 2];
        }
        if (userWasLast && userIsNextToDrawer) {
          // isLastTurn => reset the round/turn cycle
          nextTurn = 0;
          nextRound = roomGameState.round + 1;
          nextDrawer = selectedRoom.users[0];
        }
      }

      // Checking if the user was the last one remaining to guess the word.
      // Adding 1 to newGuessers because the drawer counts
      // Also checking for !preTurn, since the score is not updated in preTurn
      if (Object.keys(roomGameState.turnScores ?? {}).length >= newGuessers + 1) {
        const newState: GameStateI = {
          ...roomGameState,
          drawer: nextDrawer,
          previousWords,
          round: nextRound,
          turn: nextTurn,
          preTurn: true,
          usersGuessing: newGuessers
        };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
        // Checks if this was the last turn of last round
        if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
          // If the user who left is the owner, we pass the owner to the next user
          // since the owner is the index 0 in the selectedRoom users array
          const newOwner = isOwner ? selectedRoom.users[1].id : selectedRoom.owner;
          selectedRoom.gameState.endGame = true;
          io.to(roomNumber.toString()).emit('game ended', { owner: newOwner });
        } else {
          io.to(roomNumber.toString()).emit('show scoreboard');
        }
        handleRemoveUserOnRoom({
          socket,
          username,
          users,
          usersAmount,
          userIndex,
          selectedRoom,
          roomNumber,
          io,
          isOwner
        });
        return;
      }

      selectedRoom.nextTurnInfo = { nextTurn, nextRound, nextDrawer, previousWords };

      // Just remove the user from the game/room
      const newState: GameStateI = {
        ...roomGameState,
        usersGuessing: newGuessers
      };
      selectedRoom.gameState = newState;
      io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });

      handleRemoveUserOnRoom({
        socket,
        username,
        users,
        usersAmount,
        userIndex,
        selectedRoom,
        roomNumber,
        io,
        isOwner
      });
      console.dir(rooms, { depth: null });
      return;
    }

    handleRemoveUser({ socket, username, users, usersAmount });
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
          // updating turnScoresObj, if its the first time for the drawer
          if (turnScoresObj && drawerId && !turnScoresObj[drawerId]) {
            turnScoresObj[drawerId] = {
              name: users[drawerId].name,
              value: DEFAULT_POINTS_DRAWER
            };
          }

          socket.emit('user guessed', {
            msg: `Felicidades ${users[socket.id].name}, acertaste`
          });

          // Sending the updated scores
          io.to(roomNumber.toString()).emit('guessed word', {
            id: socket.id,
            msg: `${users[socket.id].name} acertó la palabra`,
            totalScores: totalScoresObj,
            turnScores: turnScoresObj,
            updatedTime: updatedScoreTime.updatedTime
          });

          // Checks if its the last guesser. Fallback of 2 users as default
          // Adding 1 to usersGuessing since the drawer will get points aswell
          if (
            Object.keys(roomGameState.turnScores ?? {}).length >=
            (roomGameState.usersGuessing ? roomGameState.usersGuessing + 1 : 2)
          ) {
            let nextRound: number;
            let nextTurn: number;
            let nextDrawer: UserI;
            let previousWords: number;

            // checking if nextTurnInfo has data to set the next turn
            if (rooms[roomNumber].nextTurnInfo) {
              // TypeScript doesnt infere that nextTurnInfo is an instance of NextTurnInfoI so have to
              // set some fallback values
              nextRound = rooms[roomNumber].nextTurnInfo?.nextRound ?? 0;
              nextTurn = rooms[roomNumber].nextTurnInfo?.nextTurn ?? 1;
              nextDrawer = rooms[roomNumber].nextTurnInfo?.nextDrawer ?? rooms[roomNumber].users[0];
              previousWords = rooms[roomNumber].nextTurnInfo?.previousWords ?? 3;
              // reset the property nextTurnInfo to undefined
              rooms[roomNumber].nextTurnInfo = undefined;
            } else {
              const {
                nextDrawer: drawer,
                previousWords: prevWords,
                nextRound: round,
                nextTurn: turn
              } = handleNextTurn({
                currentGameState: roomGameState,
                currentUserList: rooms[roomNumber].users
              });
              nextDrawer = drawer;
              nextRound = round;
              nextTurn = turn;
              previousWords = prevWords;
            }

            const newState: GameStateI = {
              ...roomGameState,
              drawer: nextDrawer,
              previousWords,
              round: nextRound,
              turn: nextTurn,
              preTurn: true
            };
            rooms[roomNumber].gameState = newState;
            io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
            // Checks if this was the last turn
            if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
              rooms[roomNumber].gameState.endGame = true;
              io.to(roomNumber.toString()).emit('game ended', { owner: rooms[roomNumber].owner });
              return;
            }
            io.to(roomNumber.toString()).emit('show scoreboard');
          }
          console.dir(rooms, { depth: null });
          return;
        }
      }
      // This will send the event to all clients connected to the concrete room, including the one that initiated the event.
      const usersRoom = rooms[roomNumber].users;
      io.to(roomNumber.toString()).emit('chat msg', {
        user: users[socket.id].name,
        msg,
        id: socket.id,
        color: usersRoom.find((user) => user.id === socket.id)?.color ?? FALLBACK_USER_COLOR
      });
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
      socket.emit('create room response', {
        success: false,
        message: `La sala ${roomNumber} ya existe. Prueba con otra!`,
        room: roomNumber
      });
    } else {
      socket.join(roomNumber.toString());
      const randomColor = getUniqueColor({ colorArray: USER_LIGHT_COLORS, usersArray: [] });
      const roomUsers: UserI[] = [{ id: socket.id, name: users[socket.id].name, color: randomColor }];
      rooms[roomNumber] = {
        owner: socket.id,
        password: roomPassword,
        users: roomUsers,
        gameState: { started: false },
        nextTurnInfo: undefined
      };
      users[socket.id].room = roomNumber;
      socket.emit('create room response', {
        success: true,
        message: `Sala ${roomNumber} creada con éxito!`,
        room: roomNumber,
        roomUsers
      });
      console.dir(rooms, { depth: null });
    }
  });

  // TODO: check that the user is not already in the room (just in case)
  socket.on('join room', ({ roomNumber, roomPassword }: { roomNumber: number; roomPassword: string }) => {
    if (!rooms[roomNumber]) {
      socket.emit('join room response', {
        success: false,
        message: `La sala ${roomNumber} no existe!`,
        room: roomNumber
      });
      return;
    }

    const selectedRoom = rooms[roomNumber];
    const passwordMatches = selectedRoom.password === roomPassword;

    if (!passwordMatches) {
      socket.emit('join room response', {
        success: false,
        message: `Comprueba las credenciales e inténtalo nuevamente`,
        room: roomNumber
      });
      return;
    }

    // join the socket to the room
    socket.join(roomNumber.toString());

    const username = users[socket.id].name;
    // add the user to the room's users array
    const getRandomColor = getUniqueColor({ colorArray: USER_LIGHT_COLORS, usersArray: selectedRoom.users });
    const newUser: UserI = { id: socket.id, name: username, color: getRandomColor };
    selectedRoom.users.push(newUser);
    // add the roomNumber to the room prop in users obj
    users[socket.id].room = roomNumber;

    if (selectedRoom.users.length >= 3 && !selectedRoom.gameState.started) {
      const roomOwner = selectedRoom.owner;
      const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
    }

    // Update the gameState.totalScores with the joined user assigning 0 points if proceeds
    if (selectedRoom.gameState.totalScores) {
      selectedRoom.gameState.totalScores[socket.id] = {
        name: username,
        value: 0
      };
    }

    // respond to the joining socket with success
    socket.emit('join room response', {
      success: true,
      message: `Bienvenido ${username} a la sala ${roomNumber}`,
      room: roomNumber,
      // Sending the updated userList to the user just joined the room
      newUsers: selectedRoom.users,
      // If preTurn true, it means that the game is not being played
      isPlaying: selectedRoom.gameState.preTurn !== undefined ? !selectedRoom.gameState.preTurn : false,
      gameState: selectedRoom.gameState
    });

    io.to(roomNumber.toString()).emit('update user list', {
      newUsers: selectedRoom.users,
      action: 'join',
      msg: updateListMessage({ username, action: 'join' }),
      newUser,
      gameState: selectedRoom.gameState
    });

    console.dir(rooms, { depth: null });
  });

  socket.on('await more players', ({ roomNumber }: { roomNumber: number }) => {
    io.to(roomNumber.toString()).emit('await more players response', {
      message: 'El anfitrión/a está esperando por más jugadores...'
    });
  });

  socket.on(
    'init game',
    ({
      roomNumber,
      turnDuration,
      categorySelected
    }: {
      roomNumber: number;
      turnDuration?: number | null;
      categorySelected?: string;
    }) => {
      const selectedRoom = rooms[roomNumber];
      const selectedCategory = categorySelected || selectedRoom.gameState.category || DEFAULT_CATEGORY_SELECTED;
      const selectedTurnDuration = turnDuration || selectedRoom.gameState.turnDuration || DEFAULT_TURN_DURATION;
      const shuffledArray = shuffleArray(words[selectedCategory as keyof typeof words]);

      const scores = selectedRoom.users.reduce((acc: Record<string, { name: string; value: number }>, user) => {
        acc[user.id] = { name: user.name, value: 0 };
        return acc;
      }, {});

      const initialGameState: GameStateI = {
        ...selectedRoom.gameState,
        started: true,
        words: shuffledArray,
        drawer: selectedRoom.users[0],
        round: 1,
        maxRounds: selectedRoom.gameState.maxRounds ?? DEFAULT_MAX_ROUNDS,
        turn: 0,
        preTurn: true,
        turnDuration: selectedTurnDuration,
        category: selectedCategory,
        endGame: false,
        totalScores: scores,
        turnScores: {}
      };
      socket.to(roomNumber.toString()).emit('update category front', { category: selectedCategory });
      socket.to(roomNumber.toString()).emit('set new turn duration', { turnDuration: selectedTurnDuration });
      selectedRoom.gameState = initialGameState;
      io.to(roomNumber.toString()).emit('update game state front', { gameState: initialGameState });

      const drawerId = selectedRoom.users[0].id;
      selectedRoom.users.forEach((user) => {
        if (user.id !== drawerId) {
          io.to(user.id).emit('pre turn no drawer', { message: 'Esperando que seleccione palabra...' });
        }
      });
      const possibleWords = [shuffledArray[0], shuffledArray[1], shuffledArray[2]];
      io.to(drawerId).emit('pre turn drawer', { possibleWords });
    }
  );

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
    let nextRound: number;
    let nextTurn: number;
    let nextDrawer: UserI;
    let previousWords: number;

    // checking if nextTurnInfo has data to set the next turn
    if (rooms[roomNumber].nextTurnInfo) {
      // TypeScript doesnt infere that nextTurnInfo is an instance of NextTurnInfoI so have to
      // set some fallback values
      nextRound = rooms[roomNumber].nextTurnInfo?.nextRound ?? 0;
      nextTurn = rooms[roomNumber].nextTurnInfo?.nextTurn ?? 1;
      nextDrawer = rooms[roomNumber].nextTurnInfo?.nextDrawer ?? rooms[roomNumber].users[0];
      previousWords = rooms[roomNumber].nextTurnInfo?.previousWords ?? 3;
      // reset the property nextTurnInfo to undefined
      rooms[roomNumber].nextTurnInfo = undefined;
    } else {
      const {
        nextDrawer: drawer,
        previousWords: prevWords,
        nextRound: round,
        nextTurn: turn
      } = handleNextTurn({
        currentGameState: rooms[roomNumber].gameState,
        currentUserList: rooms[roomNumber].users
      });
      nextDrawer = drawer;
      nextRound = round;
      nextTurn = turn;
      previousWords = prevWords;
    }

    const newState = {
      ...rooms[roomNumber].gameState,
      drawer: nextDrawer,
      previousWords,
      round: nextRound,
      turn: nextTurn,
      preTurn: true
    };
    rooms[roomNumber].gameState = newState;
    io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
    // Checks if this was the last turn
    if (nextRound > (rooms[roomNumber].gameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
      const owner = rooms[roomNumber].owner;
      rooms[roomNumber].gameState.endGame = true;
      io.to(roomNumber.toString()).emit('game ended', { owner });
      return;
    }
    io.to(roomNumber.toString()).emit('show scoreboard');
  });

  socket.on('scoreboard finished', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const gameState = rooms[roomNumber].gameState;
    const prevWords = gameState.previousWords ?? 0;
    const possibleWords = gameState.words
      ? [gameState.words[prevWords], gameState.words[prevWords + 1], gameState.words[prevWords + 2]]
      : ['Fallback1', 'Fallback2', 'Fallback3'];
    const newState: GameStateI = {
      ...rooms[roomNumber].gameState,
      preTurn: true,
      turnScores: {}
    };
    rooms[roomNumber].gameState = newState;

    const drawerId = gameState.drawer?.id ?? selectedRoom.users[0].id;
    selectedRoom.users.forEach((user) => {
      if (user.id !== drawerId) {
        io.to(user.id).emit('pre turn no drawer', { message: 'Esperando que seleccione palabra...' });
      }
    });
    io.to(drawerId).emit('pre turn drawer', { possibleWords });
    io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
  });

  socket.on('restart game', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
    const newState = { started: false };
    selectedRoom.gameState = newState;
    io.to(roomNumber.toString()).emit('close endgame modal');
    io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
    io.to(selectedRoom.owner).emit('pre game owner', { categories, possibleTurnDurations });
  });

  socket.on(
    'hydrate new player',
    ({ newUser, turnCount, draw }: { newUser: UserI; turnCount: number | undefined; draw: LinesI[] }) => {
      setTimeout(() => {
        io.to(newUser.id).emit('current game data', { turnCount, draw });
      }, 300);
      // io.to(newUser.id).emit('current game data', { turnCount, draw });
    }
  );

  socket.on('check room credentials', ({ roomNumber, roomPassword }: { roomNumber: string; roomPassword: string }) => {
    if (!rooms[roomNumber]) {
      socket.emit('check room credentials response', {
        success: false,
        message: `La sala ${roomNumber} no existe. Introduzca un usuario e intente acceder a la sala nuevamente`
      });
      return;
    }

    const selectedRoom = rooms[roomNumber];
    const passwordMatches = selectedRoom.password === roomPassword;

    if (!passwordMatches) {
      socket.emit('check room credentials response', {
        success: false,
        message: `La contraseña de la sala ${roomNumber} no es correcta. Introduzca un usuario e intente acceder a la sala nuevamente`
      });
      return;
    }

    socket.emit('check room credentials response', {
      success: true,
      message: `Introduce un nombre para acceder a la sala ${roomNumber}`
    });
  });

  socket.on('join room directly', ({ roomNumber, username }: { roomNumber: string; username: string }) => {
    // add the user to the users array
    usersAmount++;
    users[socket.id] = { name: username, room: Number(roomNumber) };
    console.info(`${username} connected // Total users => ${usersAmount}`);

    // join the socket to the room
    socket.join(roomNumber);

    const selectedRoom = rooms[roomNumber];
    const getRandomColor = getUniqueColor({ colorArray: USER_LIGHT_COLORS, usersArray: selectedRoom.users });
    const newUser: UserI = { id: socket.id, name: username, color: getRandomColor };
    // add the user to the room's users array
    selectedRoom.users.push(newUser);

    if (selectedRoom.users.length >= 3 && !selectedRoom.gameState.started) {
      const roomOwner = selectedRoom.owner;
      const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
    }

    // Update the gameState.totalScores with the joined user assigning 0 points if proceeds
    if (selectedRoom.gameState.totalScores) {
      selectedRoom.gameState.totalScores[socket.id] = {
        name: username,
        value: 0
      };
    }

    // respond to the joining socket with success
    socket.emit('join room directly response', {
      success: true,
      // Sending the updated userList to the user just joined the room
      newUsers: selectedRoom.users,
      // If preTurn true, it means that the game is not being played
      isPlaying: selectedRoom.gameState.preTurn !== undefined ? !selectedRoom.gameState.preTurn : false,
      gameState: selectedRoom.gameState
    });

    io.to(roomNumber.toString()).emit('update user list', {
      newUsers: selectedRoom.users,
      action: 'join',
      msg: updateListMessage({ username, action: 'join' }),
      newUser,
      gameState: selectedRoom.gameState
    });

    console.dir(rooms, { depth: null });
  });

  // TODO: Recieve an event to update the word with more letters to show (more hints)
  // TODO: Create the possiblity to set a custom category with words from the front
  // TODO: Create logic to modify in the config game, the max rounds to play
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
