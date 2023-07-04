import { Server, Socket } from 'socket.io';
import { RoomsI, UsersI } from '../interfaces';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { updateListMessage } from './updateListMessage';

interface RemoveUserProps {
  users: {
    [key: string]: UsersI;
  };
  socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, string>;
  username: string;
  usersAmount: number;
}

interface RemoveUserRoomProps extends RemoveUserProps {
  userIndex: number;
  selectedRoom: RoomsI;
  roomNumber: number;
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;
  isOwner: boolean;
}

export const handleRemoveUser = ({ users, socket, username, usersAmount }: RemoveUserProps) => {
  delete users[socket.id];
  console.info(`${username} disconnected // Total users => ${usersAmount}`);
};

// Removes the user from the room, send the update event. If is owner it passes to 1st user
// last, removes the user from the userList and display console info
export const handleRemoveUserOnRoom = ({
  users,
  socket,
  username,
  usersAmount,
  userIndex,
  selectedRoom,
  roomNumber,
  io,
  isOwner
}: RemoveUserRoomProps) => {
  if (userIndex !== -1) {
    selectedRoom.users.splice(userIndex, 1);
  }
  io.to(roomNumber.toString()).emit('update user list', {
    newUsers: selectedRoom.users,
    action: 'left',
    msg: updateListMessage({ username, action: 'left' })
  });
  if (isOwner) {
    selectedRoom.owner = selectedRoom.users[0].id;
  }
  handleRemoveUser({ socket, username, users, usersAmount });
};
