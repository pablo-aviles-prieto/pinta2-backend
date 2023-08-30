import { UserI } from '../interfaces';
import { FALLBACK_USER_COLOR } from './const';

export const getUniqueColor = ({ colorArray, usersArray }: { colorArray: string[]; usersArray: UserI[] }): string => {
  if (usersArray.length >= colorArray.length) {
    return FALLBACK_USER_COLOR;
  }
  const randomColor = colorArray[Math.floor(Math.random() * colorArray.length)];
  const colorAlreadyExists = usersArray.some((user) => user.color === randomColor);
  if (colorAlreadyExists) {
    return getUniqueColor({ usersArray, colorArray });
  }
  return randomColor;
};
