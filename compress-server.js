const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

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

function upload(url, headers, filePath, buffer) {
  return new Promise((resolve, reject) => {
    const data = buffer || fs.readFileSync(filePath);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
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

// --- HTML to PDF con Puppeteer ---
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });
  console.log('[pdf-server] Chromium browser lanzado');
  return browserInstance;
}

async function htmlToPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      ...options
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ffmpeg: true, chromium: true, version: 'v5' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('POST only');
    return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    // --- RUTA: /html-to-pdf ---
    if (req.url === '/html-to-pdf') {
      try {
        const { html, options, supabaseUrl, supabaseKey, fileName, bucket } = JSON.parse(body);
        if (!html) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'html field is required' }));
          return;
        }

        console.log('[pdf-server] Generando PDF...');
        const pdfBuffer = await htmlToPdf(html, options || {});
        console.log('[pdf-server] PDF generado: ' + (pdfBuffer.length / 1024).toFixed(1) + 'KB');

        // Si se proporcionan datos de Supabase, subir automaticamente
        if (supabaseUrl && supabaseKey && fileName) {
          const bucketName = bucket || 'propuestas';
          const uploadUrl = supabaseUrl + '/storage/v1/object/' + bucketName + '/' + fileName;
          await upload(uploadUrl, {
            'apikey': supabaseKey,
            'Authorization': 'Bearer ' + supabaseKey,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true'
          }, null, pdfBuffer);

          const publicUrl = supabaseUrl + '/storage/v1/object/public/' + bucketName + '/' + fileName;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            publicUrl: publicUrl,
            sizeKB: (pdfBuffer.length / 1024).toFixed(2)
          }));
        } else {
          // Devolver PDF como binary
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="propuesta.pdf"',
            'Content-Length': pdfBuffer.length
          });
          res.end(pdfBuffer);
        }
      } catch (e) {
        console.error('[pdf-server] ERROR:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // --- RUTA: / (compress video - original) ---
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
      await upload(uploadUrl, {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true'
      }, finalFile, null);

      try { fs.unlinkSync(input); } catch (e) {}
      try { fs.unlinkSync(output); } catch (e) {}

      const publicUrl = supabaseUrl + '/storage/v1/object/public/' + bucketName + '/' + fileName;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        avatarUrl: publicUrl,
        originalMB: (origSize / 1048576).toFixed(2),
        compressedMB: (compSize / 1048576).toFixed(2)
      }));
    } catch (e) {
      console.error('[compress] ERROR:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

server.listen(3456, '127.0.0.1', () => {
  console.log('[compress+pdf-server] v5 on :3456');
});
