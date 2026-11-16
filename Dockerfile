# Image avec Chromium déjà installé (même version que la dépendance playwright)
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
