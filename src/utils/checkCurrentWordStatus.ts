export const checkCurrentWordStatus = (word: string) => {
  const revealedLettersCount = Array.from(word).filter((char) => char !== '*' && char !== ' ').length;
  const onlyLettersCount = Array.from(word).filter((char) => char !== ' ').length;
  return { wordLength: onlyLettersCount, revealedLettersCount };
};
