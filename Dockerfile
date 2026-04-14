FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080 5001 5002 5003

CMD ["node", "gateway/gateway.js"]
