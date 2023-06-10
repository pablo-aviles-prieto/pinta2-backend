export const obscureString = (str: string) => {
  const array = [...str];
  const nonSpaceIndices: number[] = [];

  // Replacing non-space characters with asterisks and tracking their indices
  for (let i = 0; i < array.length; i++) {
    if (array[i] !== ' ') {
      array[i] = '*';
      nonSpaceIndices.push(i);
    }
  }

  if (nonSpaceIndices.length > 10) {
    const randomIndex = nonSpaceIndices[Math.floor(Math.random() * nonSpaceIndices.length)];
    array[randomIndex] = str[randomIndex];
  }

  return array.join('');
};
