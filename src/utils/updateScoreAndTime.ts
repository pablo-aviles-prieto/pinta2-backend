import { getRemaniningPercentageTime } from './getRemaniningPercentageTime';

interface UpdateScoreAndTimeI {
  remainingTime: number;
  totalTime: number;
  firstGuesser: boolean;
}

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
    if (!firstGuesser) {
      return { score: updatedTime, updatedTime };
    }
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
