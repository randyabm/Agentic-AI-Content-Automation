# nginx for the Coolify deployment — config baked into the image (no relative
# bind mounts, which Coolify's compose parser can mis-resolve).
FROM nginx:alpine
COPY nginx.conf.coolify /etc/nginx/conf.d/default.conf
