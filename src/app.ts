import 'dotenv/config';

import words from './assets/words.json';
import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { Server } from 'socket.io';
import { ContactForm, GameStateI, LinesI, RoomsI, UserI, UsersI } from './interfaces';
import {
  checkCurrentWordStatus,
  getCategoriesAndTurnDuration,
  getUniqueColor,
  handleNextTurn,
  handleRemoveUser,
  handleRemoveUserOnRoom,
  handleSendMail,
  obscureString,
  shuffleArray,
  unCryptRandomCharacter,
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
} from './utils/const';

const { PORT, FRONT_ADDRESS, FRONT_ADDRESS2 } = process.env;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const httpServer = http.createServer(app);

if (!FRONT_ADDRESS || !FRONT_ADDRESS2) {
  throw new Error('Environment variables FRONT_ADDRESS and FRONT_ADDRESS2 must be defined.');
}

const io = new Server(httpServer, {
  cors: {
    origin: [FRONT_ADDRESS, FRONT_ADDRESS2]
  }
});

let usersAmount = 0;
const users: { [key: string]: UsersI } = {};
const rooms: { [key: string]: RoomsI } = {};

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    usersAmount++;
    users[socket.id] = { name: username };
    console.info(`${username} connected // Total users => ${usersAmount}`);
  });

  socket.on('disconnect', () => {
    if (!users || !users[socket.id]) {
      return;
    }

    usersAmount--;
    const username = users[socket.id].name;
    const roomNumber = users[socket.id]?.room;

    if (roomNumber) {
      const selectedRoom = rooms[roomNumber];

      if (selectedRoom.users.length <= 1) {
        delete rooms[roomNumber];
        console.info(`Last user (${username}) left the room ${roomNumber}, deleted room!`);
        handleRemoveUser({ socket, username, users, usersAmount });
        return;
      }

      const userIndex = selectedRoom.users.findIndex((user) => user.id === socket.id);
      const isOwner = selectedRoom.owner === socket.id;

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

      if (selectedRoom.gameState.endGame && selectedRoom.owner === socket.id) {
        const newOwner = selectedRoom.users[1].id;
        io.to(roomNumber.toString()).emit('resend game ended', { owner: newOwner });
      }

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

      if (selectedRoom.gameState.drawer?.id === socket.id) {
        if (roomGameState.turnScores && roomGameState.totalScores) {
          for (const key in roomGameState.turnScores) {
            if (roomGameState.totalScores.hasOwnProperty(key)) {
              roomGameState.totalScores[key].value -= roomGameState.turnScores[key].value;
            }
          }
        }

        const wasLastTurn = userIndex >= Object.keys(selectedRoom.users).length - 1;
        const nextRound = !wasLastTurn ? roomGameState.round : roomGameState.round ? roomGameState.round + 1 : 1;
        const nextTurn = !wasLastTurn ? roomGameState.turn : 0;
        const nextDrawer = wasLastTurn ? selectedRoom.users[0] : selectedRoom.users[userIndex + 1];
        const previousWords = roomGameState.previousWords ? roomGameState.previousWords + 3 : 3;

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

        if ((nextRound ?? 0) > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
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

      if (selectedRoom.usersNotPlaying.includes(socket.id)) {
        if (selectedRoom.gameState.totalScores && selectedRoom.gameState.totalScores[socket.id]) {
          delete selectedRoom.gameState.totalScores[socket.id];
          io.to(roomNumber.toString()).emit('update game state front', { gameState: selectedRoom.gameState });
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

      if (
        roomGameState.turnScores &&
        roomGameState.totalScores &&
        roomGameState.turnScores[socket.id] &&
        roomGameState.totalScores[socket.id] &&
        selectedRoom.gameState.drawer?.id !== socket.id
      ) {
        delete roomGameState.totalScores[socket.id];
        delete roomGameState.turnScores[socket.id];
        if (
          roomGameState.drawer?.id &&
          roomGameState.turnScores[roomGameState.drawer.id] &&
          roomGameState.totalScores[roomGameState.drawer.id]
        ) {
          roomGameState.turnScores[roomGameState.drawer.id].value -= DEFAULT_POINTS_DRAWER;
          roomGameState.totalScores[roomGameState.drawer.id].value -= DEFAULT_POINTS_DRAWER;
        }

        const newState: GameStateI = { ...roomGameState, usersGuessing: newGuessers };
        selectedRoom.gameState = newState;
        io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
      }

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

      if (selectedRoom.gameState.preTurn) {
        if (roomGameState.totalScores && roomGameState.totalScores[socket.id]) {
          delete roomGameState.totalScores[socket.id];
        }

        let newState: GameStateI = { ...roomGameState, usersGuessing: newGuessers };
        if (selectedRoom.gameState.drawer?.id === socket.id) {
          if (drawerIndex >= Object.keys(selectedRoom.users).length - 1) {
            const nextRound = (roomGameState.round ?? 1) + 1;
            newState = {
              ...roomGameState,
              usersGuessing: newGuessers,
              drawer: selectedRoom.users[0],
              turn: 0,
              round: nextRound
            };
            if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
              io.to(roomNumber.toString()).emit('update game state front', { gameState: newState });
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

      if (userIndex < drawerIndex) {
        if (roomGameState.turn === undefined || roomGameState.round === undefined) return;
        const wasLastTurn = drawerIndex >= Object.keys(selectedRoom.users).length - 1;
        nextTurn = wasLastTurn ? 0 : roomGameState.turn;
        nextRound = !wasLastTurn ? roomGameState.round : roomGameState.round + 1;
        nextDrawer = selectedRoom.users[drawerIndex + 1];
        if (wasLastTurn) {
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
          nextDrawer = selectedRoom.users[drawerIndex + 2];
        }
        if (userWasLast && userIsNextToDrawer) {
          nextTurn = 0;
          nextRound = roomGameState.round + 1;
          nextDrawer = selectedRoom.users[0];
        }
      }

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
        if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
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
      return;
    }

    handleRemoveUser({ socket, username, users, usersAmount });
  });

  socket.on(
    'chat msg',
    ({ msg, roomNumber, turnCount }: { msg: string; roomNumber: number; turnCount: number | undefined }) => {
      const roomGameState = rooms[roomNumber].gameState;

      if (turnCount && roomGameState.started && !roomGameState.preTurn && roomGameState.currentWord) {
        if (roomGameState.drawer?.id === socket.id) {
          return;
        }

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

          if (turnScoresObj && turnScoresObj[socket.id]) {
            return;
          }

          if (!totalScoresObj) {
            roomGameState.totalScores = {};
          }
          if (totalScoresObj && totalScoresObj[socket.id]) {
            totalScoresObj[socket.id] = {
              ...totalScoresObj[socket.id],
              value: totalScoresObj[socket.id].value + updatedScoreTime.score
            };
          }
          if (totalScoresObj && drawerId && totalScoresObj[drawerId]) {
            totalScoresObj[drawerId] = {
              ...totalScoresObj[drawerId],
              value: totalScoresObj[drawerId].value + DEFAULT_POINTS_DRAWER
            };
          }
          if (totalScoresObj && !totalScoresObj[socket.id]) {
            totalScoresObj[socket.id] = {
              name: users[socket.id].name,
              value: updatedScoreTime.score
            };
          }
          if (totalScoresObj && drawerId && !totalScoresObj[drawerId]) {
            totalScoresObj[drawerId] = {
              name: users[drawerId].name,
              value: DEFAULT_POINTS_DRAWER
            };
          }

          if (!turnScoresObj) {
            roomGameState.turnScores = {};
          }
          if (turnScoresObj && !turnScoresObj[socket.id]) {
            turnScoresObj[socket.id] = {
              name: users[socket.id].name,
              value: updatedScoreTime.score
            };
          }
          if (turnScoresObj && drawerId && turnScoresObj[drawerId]) {
            turnScoresObj[drawerId] = {
              ...turnScoresObj[drawerId],
              value: turnScoresObj[drawerId].value + DEFAULT_POINTS_DRAWER
            };
          }
          if (turnScoresObj && drawerId && !turnScoresObj[drawerId]) {
            turnScoresObj[drawerId] = {
              name: users[drawerId].name,
              value: DEFAULT_POINTS_DRAWER
            };
          }

          socket.emit('user guessed', {
            msg: `Felicidades ${users[socket.id].name}, acertaste`
          });

          io.to(roomNumber.toString()).emit('guessed word', {
            id: socket.id,
            msg: `${users[socket.id].name} acertó la palabra`,
            totalScores: totalScoresObj,
            turnScores: turnScoresObj,
            updatedTime: updatedScoreTime.updatedTime
          });

          if (
            Object.keys(roomGameState.turnScores ?? {}).length >=
            (roomGameState.usersGuessing ? roomGameState.usersGuessing + 1 : 2)
          ) {
            let nextRound: number;
            let nextTurn: number;
            let nextDrawer: UserI;
            let previousWords: number;

            if (rooms[roomNumber].nextTurnInfo) {
              nextRound = rooms[roomNumber].nextTurnInfo?.nextRound ?? 0;
              nextTurn = rooms[roomNumber].nextTurnInfo?.nextTurn ?? 1;
              nextDrawer = rooms[roomNumber].nextTurnInfo?.nextDrawer ?? rooms[roomNumber].users[0];
              previousWords = rooms[roomNumber].nextTurnInfo?.previousWords ?? 3;
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
            if (nextRound > (roomGameState.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
              rooms[roomNumber].gameState.endGame = true;
              io.to(roomNumber.toString()).emit('game ended', { owner: rooms[roomNumber].owner });
              return;
            }
            io.to(roomNumber.toString()).emit('show scoreboard');
          }
          return;
        }
      }
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
      socket.broadcast.to(roomNumber.toString()).emit('new segment', lineLength, lineSegment);
    }
  );

  socket.on('clear board', ({ roomNumber }: { roomNumber: number }) => {
    socket.broadcast.to(roomNumber.toString()).emit('clear board');
  });

  socket.on('create room', ({ roomNumber, roomPassword }: { roomNumber: number; roomPassword: string }) => {
    if (roomNumber === 0) {
      socket.emit('create room response', {
        success: false,
        message: `Número de sala invalido. Prueba con otra!`,
        room: roomNumber
      });
      return;
    }
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
        nextTurnInfo: undefined,
        usersNotPlaying: []
      };
      users[socket.id].room = roomNumber;
      socket.emit('create room response', {
        success: true,
        message: `Sala ${roomNumber} creada con éxito!`,
        room: roomNumber,
        roomUsers
      });
    }
  });

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

    socket.join(roomNumber.toString());

    const username = users[socket.id].name;
    const getRandomColor = getUniqueColor({ colorArray: USER_LIGHT_COLORS, usersArray: selectedRoom.users });
    const newUser: UserI = { id: socket.id, name: username, color: getRandomColor };
    selectedRoom.users.push(newUser);
    users[socket.id].room = roomNumber;

    if (selectedRoom.users.length >= 3 && !selectedRoom.gameState.started) {
      const roomOwner = selectedRoom.owner;
      const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
      selectedRoom.users.forEach((user) => {
        if (user.id !== roomOwner) {
          io.to(user.id).emit('pre game no owner', { message: 'El anfitrión/a está configurando la partida...' });
        }
      });
    }

    if (selectedRoom.gameState.totalScores) {
      selectedRoom.gameState.totalScores[socket.id] = {
        name: username,
        value: 0
      };
    }

    socket.emit('join room response', {
      success: true,
      message: `Bienvenido ${username} a la sala ${roomNumber}`,
      room: roomNumber,
      newUsers: selectedRoom.users,
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
      categorySelected,
      customWords
    }: {
      roomNumber: number;
      turnDuration?: number | null;
      categorySelected?: string;
      customWords?: string[];
    }) => {
      const selectedRoom = rooms[roomNumber];
      let selectedCategory: string;
      let shuffledArray: string[];
      if (customWords && customWords.length < selectedRoom.users.length * 3 * 2) return;
      if (customWords) {
        selectedCategory = 'Personalizada';
        shuffledArray = [...shuffleArray(customWords), ...words.Aleatorio];
      } else {
        selectedCategory = categorySelected || selectedRoom.gameState.category || DEFAULT_CATEGORY_SELECTED;
        shuffledArray = shuffleArray(words[selectedCategory as keyof typeof words]);
      }
      const selectedTurnDuration = turnDuration || selectedRoom.gameState.turnDuration || DEFAULT_TURN_DURATION;

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

    io.to(roomNumber.toString()).emit('countdown preDraw start');
    selectedRoom.usersNotPlaying = [];
  });

  socket.on('starting turn', ({ roomNumber }: { roomNumber: number }) => {
    const selectedRoom = rooms[roomNumber];
    const usersInRoom = Object.keys(selectedRoom.users).length;
    selectedRoom.gameState.usersGuessing = usersInRoom - 1;

    io.to(roomNumber.toString()).emit('countdown turn', { usersGuessing: usersInRoom - 1 });
  });

  socket.on('turn finished', ({ roomNumber }: { roomNumber: number }) => {
    let nextRound: number;
    let nextTurn: number;
    let nextDrawer: UserI;
    let previousWords: number;

    if (rooms[roomNumber].nextTurnInfo) {
      nextRound = rooms[roomNumber].nextTurnInfo?.nextRound ?? 0;
      nextTurn = rooms[roomNumber].nextTurnInfo?.nextTurn ?? 1;
      nextDrawer = rooms[roomNumber].nextTurnInfo?.nextDrawer ?? rooms[roomNumber].users[0];
      previousWords = rooms[roomNumber].nextTurnInfo?.previousWords ?? 3;
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
    selectedRoom.users.forEach((user) => {
      if (user.id !== selectedRoom.owner) {
        io.to(user.id).emit('pre game no owner', { message: 'El anfitrión/a está configurando la partida...' });
      }
    });
  });

  socket.on(
    'hydrate new player',
    ({
      newUser,
      turnCount,
      draw,
      roomNumber
    }: {
      newUser: UserI;
      turnCount: number | undefined;
      draw: LinesI[];
      roomNumber: number | undefined;
    }) => {
      const selectedRoom = rooms[roomNumber ?? 0];
      setTimeout(() => {
        io.to(newUser.id).emit('current game data', { turnCount, draw, usersNotPlaying: selectedRoom.usersNotPlaying });
      }, 300);
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
    usersAmount++;
    users[socket.id] = { name: username, room: Number(roomNumber) };
    console.info(`${username} connected // Total users => ${usersAmount}`);

    socket.join(roomNumber);

    const selectedRoom = rooms[roomNumber];
    const getRandomColor = getUniqueColor({ colorArray: USER_LIGHT_COLORS, usersArray: selectedRoom.users });
    const newUser: UserI = { id: socket.id, name: username, color: getRandomColor };
    selectedRoom.users.push(newUser);

    if (selectedRoom.users.length >= 3 && !selectedRoom.gameState.started) {
      const roomOwner = selectedRoom.owner;
      const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
      socket.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
      selectedRoom.users.forEach((user) => {
        if (user.id !== roomOwner) {
          io.to(user.id).emit('pre game no owner', { message: 'El anfitrión/a está configurando la partida...' });
        }
      });
    }

    if (selectedRoom.gameState.totalScores) {
      selectedRoom.gameState.totalScores[socket.id] = {
        name: username,
        value: 0
      };
    }

    socket.emit('join room directly response', {
      success: true,
      newUsers: selectedRoom.users,
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
  });

  socket.on('update users not playing', ({ roomNumber }: { roomNumber: number | undefined }) => {
    if (!roomNumber) return;
    const selectedRoom = rooms[roomNumber];
    selectedRoom.usersNotPlaying.push(socket.id);
  });

  socket.on('update drawing lines', ({ roomNumber, draw }: { roomNumber: number | undefined; draw: LinesI[] }) => {
    if (!roomNumber) return;
    socket.to(roomNumber.toString()).emit('update lines state', { lines: draw });
  });

  socket.on('send pre game', ({ roomNumber }: { roomNumber: number | undefined }) => {
    if (!roomNumber) return;
    const selectedRoom = rooms[roomNumber];
    const roomOwner = selectedRoom.owner;
    const { categories, possibleTurnDurations } = getCategoriesAndTurnDuration();
    io.to(roomOwner).emit('pre game owner', { categories, possibleTurnDurations });
    selectedRoom.users.forEach((user) => {
      if (user.id !== roomOwner) {
        io.to(user.id).emit('pre game no owner', { message: 'El anfitrión/a está configurando la partida...' });
      }
    });
  });

  socket.on(
    'submit contact form',
    async (formData: ContactForm, callback: (response: { success: boolean; message: string }) => void) => {
      if (Object.values(formData).some((data) => !data)) {
        callback({ success: false, message: 'Es necesario rellenar todos los datos' });
        return;
      }
      try {
        const response = await handleSendMail(formData);
        if (response[0].statusCode >= 200 && response[0].statusCode < 300) {
          callback({ success: true, message: 'Su mensaje ha sido enviado. Le contactaremos lo antes posible! 🥰' });
        } else {
          console.log('Contact form ERROR =>', `Status code: ${response[0].statusCode} - Body: ${response[0].body}`);
          callback({ success: false, message: 'Hubo un error enviando el mensaje. Inténtelo más tarde.' });
        }
      } catch (error) {
        console.log('Contact form ERROR =>', error);
        callback({ success: false, message: 'Hubo un error enviando el mensaje. Inténtelo más tarde.' });
      }
    }
  );

  socket.on(
    'check for clues',
    ({ roomNumber, percentageRemaining }: { roomNumber: number | undefined; percentageRemaining: number }) => {
      if (!roomNumber) return;
      const selectedRoom = rooms[roomNumber];

      const { wordLength, revealedLettersCount } = checkCurrentWordStatus(selectedRoom.gameState.cryptedWord ?? '');
      const sendNewCryptedWord = (gameState: GameStateI) => {
        io.to(roomNumber.toString()).emit('update game state front', { gameState });
      };

      const condition75Percent = percentageRemaining === 75 && wordLength >= 14 && revealedLettersCount < 1;
      const condition50Percent =
        percentageRemaining === 50 &&
        ((wordLength >= 14 && revealedLettersCount < 2) || (wordLength >= 10 && revealedLettersCount < 1));
      const condition25Percent =
        percentageRemaining === 25 &&
        ((wordLength >= 14 && revealedLettersCount < 3) || (wordLength >= 8 && revealedLettersCount < 2));

      if (condition75Percent || condition50Percent || condition25Percent) {
        const newCryptedWord = unCryptRandomCharacter({
          cryptedWord: selectedRoom.gameState.cryptedWord ?? '',
          unCryptedWord: selectedRoom.gameState.currentWord ?? ''
        });
        const newGameState: GameStateI = {
          ...selectedRoom.gameState,
          cryptedWord: newCryptedWord
        };
        selectedRoom.gameState = newGameState;
        sendNewCryptedWord(newGameState);
      }
    }
  );
});

httpServer.listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
