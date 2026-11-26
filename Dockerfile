FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Genera el vocabulario con embeddings durante el build (descarga el modelo, ~10 min la primera vez)
RUN npm run build-vocab
ENV PORT=3000 DB_PATH=/data/grena.db
VOLUME /data
EXPOSE 3000
CMD ["npm","start"]
