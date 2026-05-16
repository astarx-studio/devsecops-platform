FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/health || exit 1
CMD ["node", "server.js"]
