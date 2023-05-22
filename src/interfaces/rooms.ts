export interface RoomsI {
  owner?: string;
  password: string;
  users: {
    id: string;
    name: string;
    score: number;
    isDrawing: boolean;
  }[];
}
