FROM node:22-alpine AS build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.29-alpine

COPY --from=build /app/dist/1x1/browser/ /usr/share/nginx/html/
COPY deployment/nginx.container.conf /etc/nginx/conf.d/default.conf

EXPOSE 80