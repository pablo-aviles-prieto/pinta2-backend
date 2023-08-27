import words from '../assets/words.json';
import { DEFAULT_TURN_DURATION } from './const';

export const getCategoriesAndTurnDuration = () => {
  return {
    categories: Object.keys(words),
    possibleTurnDurations: { min: 90000, default: DEFAULT_TURN_DURATION, max: 150000 }
  };
};
