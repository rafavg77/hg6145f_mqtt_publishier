# Dockerfile

# Use the official Node.js image as the base image
FROM node:16-alpine

# Install required packages including dcron
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn \
    dcron

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Add crontab file in the cron directory
RUN echo "*/5 * * * * cd /app && /usr/local/bin/node router_mqtt_publisher.js >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Create the log file to be able to run tail
RUN touch /var/log/cron.log

# Run crond in the foreground
CMD crond -f -l 2 && tail -f /var/log/cron.log