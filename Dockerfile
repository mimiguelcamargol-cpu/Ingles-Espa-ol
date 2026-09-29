FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 DATA_DIR=/data COOKIE_SECURE=1
VOLUME /data
USER node
CMD ["node", "server/server.js"]
