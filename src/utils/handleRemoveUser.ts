import { Socket } from 'socket.io';
import { UsersI } from '../interfaces';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';

interface Props {
  users: {
    [key: string]: UsersI;
  };
  socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, string>;
  username: string;
  usersAmount: number;
}

export const handleRemoveUser = ({ users, socket, username, usersAmount }: Props) => {
  delete users[socket.id];
  console.info(`${username} disconnected // Total users => ${usersAmount}`);
};
