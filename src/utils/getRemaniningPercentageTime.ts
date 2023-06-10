export const getRemaniningPercentageTime = ({
  remainingTime,
  totalTime
}: {
  remainingTime: number;
  totalTime: number;
}) => {
  return (remainingTime * 100) / totalTime;
};
