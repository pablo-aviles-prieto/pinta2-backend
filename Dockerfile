FROM node:18-alpine

RUN mkdir -p /home/app
WORKDIR /home/app

COPY package*.json .

RUN npm ci

COPY . .

RUN npm run build

CMD ["npm", "run", "start"]