export const getRemaniningPercentageTime = ({
  remainingTime,
  totalTime
}: {
  remainingTime: number;
  totalTime: number;
}) => {
  const result = (remainingTime * 100) / totalTime;
  return parseFloat(result.toFixed(2));
};
