interface GameStateI {
  started: boolean;
  category?: string;
  currentWord?: string | undefined;
  drawer?: string | undefined;
  round?: number; // the current round number (initialize in 1)
  turn?: number; // the current drawing turn (initialize in 0)
  scores?: {
    // storing as key the socket.id of the users
    [key: string]: number;
  };
}

export interface RoomsI {
  owner: string;
  password: string;
  users: {
    id: string;
    name: string;
  }[];
  gameState: GameStateI;
}
