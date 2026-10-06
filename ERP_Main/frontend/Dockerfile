# Stage 1: Build the Vite React SPA
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build-time environment arguments
ARG VITE_API_ORIGIN=""
ARG VITE_CONTROL_PLANE_URL=""
ARG VITE_CENTRAL_AUTH_API=""
ARG VITE_COOKIE_DOMAIN=""
ARG VITE_YINGLIMA_URL=""
ARG VITE_INHYMA_URL=""

ENV VITE_API_ORIGIN=$VITE_API_ORIGIN \
    VITE_CONTROL_PLANE_URL=$VITE_CONTROL_PLANE_URL \
    VITE_CENTRAL_AUTH_API=$VITE_CENTRAL_AUTH_API \
    VITE_COOKIE_DOMAIN=$VITE_COOKIE_DOMAIN \
    VITE_YINGLIMA_URL=$VITE_YINGLIMA_URL \
    VITE_INHYMA_URL=$VITE_INHYMA_URL

RUN npm run build

# Stage 2: Serve statically with lightweight Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
