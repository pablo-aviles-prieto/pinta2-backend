import { GameStateI, UserI } from '../interfaces';

interface Props {
  currentGameState: GameStateI;
  currentUserList: UserI[];
}

export const handleNextTurn = ({ currentGameState, currentUserList }: Props) => {
  const nextTurn = currentGameState.turn === undefined
    ? 0
    : currentGameState.turn >= currentUserList.length - 1
    ? 0
    : currentGameState.turn + 1;
  const nextRound = currentGameState.turn === undefined
    ? 1
    : currentGameState.turn >= currentUserList.length - 1 && currentGameState.round !== undefined
    ? currentGameState.round + 1
    : currentGameState.round ?? 1;
  const previousWords = currentGameState.previousWords ? currentGameState.previousWords + 3 : 3;
  const nextDrawer = currentUserList[nextTurn];
  return { nextTurn, nextRound, previousWords, nextDrawer };
};
