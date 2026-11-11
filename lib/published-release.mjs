import { request } from 'node:https';

// The public updater feed identifies the release. The Mac updater archive and
// the downloadable DMG share a release stem, but are different artifacts.
const releaseRoot = 'https://downloads.example.invalid/releases/';

function installerUrl(value, version, updaterSuffix, installerSuffix) {
  const prefix = releaseRoot + version + '/';
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw Error('Unexpected release URL');
  const filename = value.slice(prefix.length);
  if (!/^ExampleApp_[A-Za-z0-9._+-]+$/.test(filename) || !filename.endsWith(updaterSuffix)) {
    throw Error('Unexpected installer name');
  }
  return prefix + filename.slice(0, -updaterSuffix.length) + installerSuffix;
}

// Node's fetch needs WebAssembly for its HTTP parser. The signed desktop app
// runs with --jitless, so use the native HTTPS parser for these public files.
function releaseRequest(url, method, signal) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, signal }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(Error('Release server returned HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) { res.destroy(Error('Release metadata exceeds limit')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ length: Number(res.headers['content-length']), text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function publishedFile(platform, arch, url, signal) {
  const file = { platform, arch, url, filename: url.split('/').at(-1) };
  try {
    const { length } = await releaseRequest(url, 'HEAD', signal);
    return { ...file, available: true, bytes: Number.isSafeInteger(length) && length > 0 ? length : null };
  } catch {
    return { ...file, available: false, bytes: null };
  }
}

export async function readPublishedRelease() {
  const signal = AbortSignal.timeout(9000);
  const response = await releaseRequest(releaseRoot + 'latest.json', 'GET', signal);
  const feed = JSON.parse(response.text);
  if (typeof feed.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(feed.version)
      || typeof feed.pub_date !== 'string' || !Number.isFinite(Date.parse(feed.pub_date))) {
    throw Error('Invalid release feed');
  }
  const windows = installerUrl(feed.platforms?.['windows-x86_64']?.url, feed.version, '.exe', '.exe');
  const mac = installerUrl(feed.platforms?.['darwin-aarch64']?.url, feed.version, '.app.tar.gz', '.dmg');
  const installers = await Promise.all([
    publishedFile('Windows', 'x64 / EXE', windows, signal),
    publishedFile('Mac', 'Apple Silicon / DMG', mac, signal),
  ]);
  return { version: feed.version, publishedAt: feed.pub_date, installers };
}
