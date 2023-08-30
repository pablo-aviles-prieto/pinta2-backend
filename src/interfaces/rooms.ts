export interface UserI {
  id: string;
  name: string;
  color: string;
}

interface NextTurnInfoI {
  nextTurn: number;
  nextRound: number;
  nextDrawer: UserI;
  previousWords: number;
}

export interface GameStateI {
  started: boolean;
  category?: string;
  currentWord?: string;
  cryptedWord?: string;
  words?: string[];
  previousWords?: number;
  drawer?: UserI;
  round?: number;
  maxRounds?: number;
  turn?: number;
  preTurn?: boolean;
  turnDuration?: number;
  usersGuessing?: number;
  endGame?: boolean;
  totalScores?: {
    [key: string]: { name: string; value: number };
  };
  turnScores?: {
    [key: string]: { name: string; value: number };
  };
}

export interface RoomsI {
  owner: string;
  password: string;
  users: UserI[];
  gameState: GameStateI;
  nextTurnInfo: NextTurnInfoI | undefined;
  usersNotPlaying: string[];
}
