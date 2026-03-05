FROM n8nio/n8n:2.4.7

USER root

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY compress-server.js /opt/compress-server.js
COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

USER node

ENTRYPOINT ["tini", "--", "/opt/start.sh"]
