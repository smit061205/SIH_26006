# Multi-stage: build the static Vite bundle, then serve it with nginx.
# Build context is the project root (see docker-compose.yml).
FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
# Backend is reached via the BROWSER, not container-to-container, so this
# must be the host-visible address (the docker-compose port mapping),
# not the backend container's internal service name.
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
