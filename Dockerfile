FROM n8nio/n8n:2.4.7

USER root

# FFmpeg (video) + Chromium (PDF) + fonts para renderizado correcto
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-freefont-ttf \
    fonts-noto \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# puppeteer-core usa el Chromium del sistema (no descarga otro)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN cd /opt && npm init -y > /dev/null 2>&1 && npm install puppeteer-core --save

COPY compress-server.js /opt/compress-server.js
COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

USER node

ENTRYPOINT ["tini", "--", "/opt/start.sh"]
