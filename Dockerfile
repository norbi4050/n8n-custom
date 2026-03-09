FROM node:22-alpine

# Instalar dependencias del sistema: ffmpeg, chromium, fonts, tini
RUN apk add --no-cache \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    tini

# Instalar n8n globalmente (misma version que usabas)
RUN npm install -g n8n@2.4.7

# Puppeteer usa el Chromium del sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instalar puppeteer-core para el sidecar
RUN cd /opt && npm init -y > /dev/null 2>&1 && npm install puppeteer-core --save

# Copiar sidecar server y script de inicio
COPY compress-server.js /opt/compress-server.js
COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

# Crear directorio de datos de n8n
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n

USER node

ENTRYPOINT ["tini", "--", "/opt/start.sh"]
