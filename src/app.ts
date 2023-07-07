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
  DEFAULT_TURN_DURATION
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

  socket.on('disconnect', () => {
    usersAmount--;
    const username = users[socket.id].name;
    const roomNumber = users[socket.id]?.room;

    // Checks if the user joined a room
    if (roomNumber) {
      // TODO: Check if the user who disconnected, just joined and wasnt playing this turn
      // there shouldnt be nothing to handle in this case, but CHECK IT OUT!
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
        // TODO: Send a 'resend game ended' so the front will update the setEndGameContent
        const newOwner = selectedRoom.users[1].id;
        io.to(roomNumber.toString()).emit('resend game ended', { owner: newOwner });
        // for the new owner in case the owner leaves, and other user want to restart the game
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

      // Checking if the user who left is the drawer
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

      // TODO: Test that a user (no drawer) leaves the game (with more players) and it keeps the game to the end
      // also check when a user leaves when already draw, and when has to draw, and the edge case that the drawer
      // is 1 before the last, and the user who leaves is the last. CHECK THAT IT KEEPS WORKING
      // TODO: Test the block when a user disconnect and is not the drawer

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

      // Checking if the user was the last one remaining to guess the word.
      // Adding 1 to newGuessers because the drawer counts
      if (Object.keys(roomGameState.turnScores ?? {}).length >= newGuessers + 1) {
        const drawerIndex = selectedRoom.users.findIndex((user) => user.id === roomGameState.drawer?.id ?? '');

        let nextRound: number;
        let nextTurn: number;
        let nextDrawer: UserI;
        // checking if the user who left, already drew in the current round
        if (userIndex < drawerIndex) {
          if (!roomGameState.turn || !roomGameState.round) return;
          const wasLastTurn = drawerIndex >= Object.keys(selectedRoom.users).length - 1;
          nextTurn = wasLastTurn ? 0 : roomGameState.turn;
          nextRound = !wasLastTurn ? roomGameState.round : roomGameState.round + 1;
          nextDrawer = selectedRoom.users[drawerIndex + 1];
          if (wasLastTurn) {
            // checking if the user leaving is the 1st, so we assign the drawer to the 2nd user
            nextDrawer = userIndex === 0 ? selectedRoom.users[1] : selectedRoom.users[0];
          }
        } else {
          // user who left didnt draw yet
          if (!roomGameState.turn || !roomGameState.round) return;
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

        const previousWords = roomGameState.previousWords ? roomGameState.previousWords + 3 : 3;
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

      // TODO: In case that are more users to guess this turn, have to store a property in the room called
      // handleDisconnectedTurn with the nextTurn, nextRound, previousWords and nextDrawer, so when the front
      // call the 'chat msg' event (cuz last user guessed the word) or the 'turn finished' event (cuz the timer finished)
      // it checks if that prop exist, take those values to handle the next turn, and set it as undefined for next time
      // -Check if the user drew or not, and in case it didnt, if its the next to draw, or doesnt.!!

      // TODO: update the 'chat msg' and 'turn finished' to check the handleDisconnectedTurn prop in the selectedRoom

      // update usersGuessing in case there are more than 1 disconnect in the same turn

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
      const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
    }

    io.to(roomNumber.toString()).emit('update user list', {
      newUsers: selectedRoom.users,
      action: 'join',
      msg: updateListMessage({ username, action: 'join' })
    });
    // TODO: send the gameState to the joined user from a no drawer
    // TODO: send what has been drew until now
    // the joined user, in case that is not a preTurn, he shouldnt be able to draw and chat

    // TODO: send a prop in thge join room response to let know the front if the game is in a turn being
    // played, so he cant draw and chat. In the front, in the pre turn no drawer (maybe drawer aswell),
    // has to delete the state that blocks the user to draw and chat

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
    socket.to(roomNumber.toString()).emit('update category front', { category });
  });

  socket.on('set turn duration', ({ turnDuration, roomNumber }: { turnDuration: number; roomNumber: number }) => {
    rooms[roomNumber].gameState.turnDuration = turnDuration;
    // Sending the turnDuration to all the users except the leader (since it already knows)
    socket.to(roomNumber.toString()).emit('set new turn duration', { turnDuration });
  });

  socket.on('await more players', ({ roomNumber }: { roomNumber: number }) => {
    io.to(roomNumber.toString()).emit('await more players response', {
      message: 'El anfitrión/a está esperando por más jugadores...'
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

    const initialGameState: GameStateI = {
      ...selectedRoom.gameState,
      started: true,
      words: shuffledArray,
      drawer: selectedRoom.users[0],
      round: 1,
      maxRounds: selectedRoom.gameState.maxRounds ?? DEFAULT_MAX_ROUNDS,
      turn: 0,
      preTurn: true,
      turnDuration: selectedRoom.gameState.turnDuration ?? DEFAULT_TURN_DURATION,
      category: selectedCategory,
      endGame: false,
      totalScores: scores,
      turnScores: {}
    };
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

  // TODO: When someone joins in the middle of a game. The crypted word should be sent
  // TODO: If someone leaves or joins, has to modify the totalScores and probably turnScores
  // TODO: Recieve an event to update the word with more letters to show (more hints)

  // TODO: Create logic to modify in the config game, the max rounds to play
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
