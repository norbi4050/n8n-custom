const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');

function download(url, headers, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const cleanHeaders = {};
    Object.keys(headers).forEach(k => {
      if (headers[k] && headers[k] !== 'Bearer none') cleanHeaders[k] = headers[k];
    });
    mod.get(url, { headers: cleanHeaders }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, cleanHeaders, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('Download failed: ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

function uploadFile(url, headers, filePath) {
  return new Promise((resolve, reject) => {
    const data = fs.readFileSync(filePath);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname, port: 443, path: parsed.pathname, method: 'POST',
      headers: { ...headers, 'Content-Length': data.length }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error('Upload ' + res.statusCode + ' ' + body));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function uploadBuffer(url, headers, buffer) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname, port: 443, path: parsed.pathname, method: 'POST',
      headers: { ...headers, 'Content-Length': buffer.length }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error('Upload ' + res.statusCode + ' ' + body));
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ffmpeg: true, version: 'v5' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('POST only');
    return;
  }

  // Route: /upload-base64 — recibe base64 de n8n y sube binario real a Supabase
  if (req.url === '/upload-base64') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { base64Data, supabaseUrl, supabaseKey, fileName, contentType, bucket } = JSON.parse(body);
        const bucketName = bucket || 'content-media';
        const buffer = Buffer.from(base64Data, 'base64');
        
        const uploadUrl = supabaseUrl + '/storage/v1/object/' + bucketName + '/' + fileName;
        await uploadBuffer(uploadUrl, {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': contentType || 'audio/mpeg',
          'x-upsert': 'true'
        }, buffer);

        const publicUrl = supabaseUrl + '/storage/v1/object/public/' + bucketName + '/' + fileName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: publicUrl, sizeMB: (buffer.length / 1048576).toFixed(2) }));
      } catch (e) {
        console.error('[upload-base64] ERROR:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Route: / — compress video (original endpoint)
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { mediaUrl, waToken, supabaseUrl, supabaseKey, fileName, skipCompress, bucket } = JSON.parse(body);
      const bucketName = bucket || 'content-media';
      const ts = Date.now();
      const input = '/tmp/in_' + ts + '.mp4';
      const output = '/tmp/out_' + ts + '.mp4';

      const dlHeaders = {};
      if (waToken) dlHeaders['Authorization'] = 'Bearer ' + waToken;
      await download(mediaUrl, dlHeaders, input);

      const origSize = fs.statSync(input).size;
      let compSize = origSize;
      let finalFile = input;

      if (!skipCompress && origSize > 50 * 1024 * 1024) {
        console.log('[compress] ' + (origSize / 1048576).toFixed(1) + 'MB -> comprimiendo...');
        execSync(
          'ffmpeg -i ' + input + ' -vf scale=720:-2 -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 128k -y ' + output + ' 2>/dev/null',
          { timeout: 300000 }
        );
        compSize = fs.statSync(output).size;
        finalFile = output;
        console.log('[compress] -> ' + (compSize / 1048576).toFixed(1) + 'MB');
      }

      const uploadUrl = supabaseUrl + '/storage/v1/object/' + bucketName + '/' + fileName;
      await uploadFile(uploadUrl, {
        'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'video/mp4', 'x-upsert': 'true'
      }, finalFile);

      try { fs.unlinkSync(input); } catch (e) {}
      try { fs.unlinkSync(output); } catch (e) {}

      const publicUrl = supabaseUrl + '/storage/v1/object/public/' + bucketName + '/' + fileName;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true, avatarUrl: publicUrl,
        originalMB: (origSize / 1048576).toFixed(2), compressedMB: (compSize / 1048576).toFixed(2)
      }));
    } catch (e) {
      console.error('[compress] ERROR:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

server.listen(3456, '127.0.0.1', () => {
  console.log('[compress-server] v5 on :3456');
});
