interface Props {
  username: string;
  action: 'left' | 'join';
}

export const updateListMessage = ({ username, action }: Props) => {
  return `El usuario ${username} se ${action === 'join' ? 'conectó a la sala' : 'desconectó de la sala'}`;
};
