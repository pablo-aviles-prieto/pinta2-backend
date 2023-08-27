import { getRemaniningPercentageTime } from './getRemaniningPercentageTime';

interface UpdateScoreAndTimeI {
  remainingTime: number;
  totalTime: number;
  firstGuesser: boolean;
}

// Always returning an absolute number. Using Match.ceil in case of decimals
export const updateScoreAndTime = ({
  remainingTime,
  totalTime,
  firstGuesser
}: UpdateScoreAndTimeI): { score: number; updatedTime: number } => {
  const timeRemainingPercentage = getRemaniningPercentageTime({ remainingTime, totalTime });
  const subtractAmount = totalTime === 150 ? 15 : totalTime === 120 ? 10 : 5;
  if (timeRemainingPercentage > 50) {
    const halfTime = totalTime / 2;
    const updatedTime = Math.ceil(halfTime);
    // Check we dont have 2 concurrent guessed words, so if there is already a guess registered in the
    // turnScore prop in gameState, we assign the half
    if (!firstGuesser) {
      return { score: updatedTime, updatedTime };
    }
    // When its in the 5/10/15 last seconds before reaching the halfTime, we just subtract the
    // corresponding amount (depending on the totalTime) for the remainingTime
    if (remainingTime <= halfTime + subtractAmount) {
      return { score: remainingTime, updatedTime: remainingTime - subtractAmount };
    }
    return { score: remainingTime, updatedTime };
  }

  if (timeRemainingPercentage <= 50 && timeRemainingPercentage > 17) {
    return { score: remainingTime, updatedTime: remainingTime - subtractAmount };
  }

  return { score: remainingTime, updatedTime: Math.ceil(remainingTime) };
};
