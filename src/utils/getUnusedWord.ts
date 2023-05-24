import { checkIfUsedWord } from './checkIfUsedWord';
import { getRandomWord } from './getRandomWord';

export const getUnusedWord = ({
  availableWords,
  usedWords
}: {
  availableWords: string[];
  usedWords: string[];
}): string => {
  const randomWord = getRandomWord(availableWords);

  if (checkIfUsedWord({ word: randomWord, array: usedWords })) {
    const newAvailableWords = availableWords.filter((word) => word !== randomWord);
    return getUnusedWord({ availableWords: newAvailableWords, usedWords });
  }

  return randomWord;
};
