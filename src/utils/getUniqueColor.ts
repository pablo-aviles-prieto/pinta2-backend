import { UserI } from '../interfaces';
import { FALLBACK_USER_COLOR } from './const';

export const getUniqueColor = ({ colorArray, usersArray }: { colorArray: string[]; usersArray: UserI[] }): string => {
  // returning fallback grey color in case that there are more users that color availables
  if (usersArray.length > colorArray.length) {
    return FALLBACK_USER_COLOR;
  }

  // Getting a random color from the color array
  const randomColor = colorArray[Math.floor(Math.random() * colorArray.length)];

  // Checking if this color is already used by a user
  const colorAlreadyExists = usersArray.some((user) => user.color === randomColor);

  if (colorAlreadyExists) {
    // If the color is already used, we call the function again until we find an unused color
    return getUniqueColor({ usersArray, colorArray });
  }
  return randomColor;
};
