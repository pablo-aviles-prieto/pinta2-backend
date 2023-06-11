import { getRemaniningPercentageTime } from './getRemaniningPercentageTime';

interface UpdateScoreAndTimeI {
  remainingTime: number;
  totalTime: number;
  firstGuesser: boolean;
}

// Always returning a whole number. Using Match.ceil in case of decimals
export const updateScoreAndTime = ({
  remainingTime,
  totalTime,
  firstGuesser
}: UpdateScoreAndTimeI): { score: number; updatedTime: number } => {
  const timeRemainingPercentage = getRemaniningPercentageTime({ remainingTime, totalTime });

  if (timeRemainingPercentage > 50) {
    const updatedTime = Math.ceil(totalTime / 2);
    // Check we dont have 2 concurrent guessed words, so if there is already a guess registered in the
    // turnScore prop in gameState, we assign the half
    if (!firstGuesser) {
      return { score: updatedTime, updatedTime };
    }
    return { score: remainingTime, updatedTime };
  }

  if (timeRemainingPercentage <= 50 && timeRemainingPercentage > 17) {
    const subtractAmount = totalTime === 180 ? 15 : totalTime === 120 ? 10 : 5;
    return { score: remainingTime, updatedTime: remainingTime - subtractAmount };
  }

  return { score: remainingTime, updatedTime: Math.ceil(remainingTime) };
};
