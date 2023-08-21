export const checkCurrentWordStatus = (word: string) => {
  const revealedLettersCount = Array.from(word).filter((char) => char !== '*').length;
  return { wordLength: word.length, revealedLettersCount };
};
