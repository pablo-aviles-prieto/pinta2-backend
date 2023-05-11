import 'dotenv/config';

import http from 'http';
import cors from 'cors';
import express from 'express';
import path from 'path';

const { PORT } = process.env;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

export const httpServer = http
  .createServer(app)
  .listen(PORT, () => console.info(`Server running and listening at http://localhost:${PORT}`));
