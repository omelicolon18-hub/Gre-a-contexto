FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN npm run build-vocab
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/grena.db
VOLUME /data
EXPOSE 3000
CMD ["npm","start"]
