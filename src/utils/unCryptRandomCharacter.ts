export const unCryptRandomCharacter = ({
  cryptedWord,
  unCryptedWord
}: {
  cryptedWord: string;
  unCryptedWord: string;
}) => {
  const cryptedArray = [...cryptedWord];
  const asteriskIndices: number[] = [];

  for (let i = 0; i < cryptedArray.length; i++) {
    if (cryptedArray[i] === '*') {
      asteriskIndices.push(i);
    }
  }

  const randomIndex = asteriskIndices[Math.floor(Math.random() * asteriskIndices.length)];
  cryptedArray[randomIndex] = unCryptedWord[randomIndex];

  return cryptedArray.join('');
};
