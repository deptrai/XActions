FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV RELAY_HOST=0.0.0.0
ENV RELAY_PORT=3800

EXPOSE 3800

CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.js"]
