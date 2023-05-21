export interface RoomsI {
  password: string;
  users: {
    id: string;
    name: string;
  }[];
}
