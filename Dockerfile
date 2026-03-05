FROM n8nio/n8n:2.4.7

USER root

RUN apk add --no-cache ffmpeg

COPY compress-server.js /opt/compress-server.js
COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

USER node

ENTRYPOINT ["tini", "--", "/opt/start.sh"]
