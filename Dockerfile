FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm i || true
COPY . .
CMD ["node","-r","dotenv/config","src/simple/auto_mempool.js"]
