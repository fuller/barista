import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {createLiveFixtureHandler} from './live-fixture.mjs';
const fixture=createLiveFixtureHandler();

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const { default: worker } = await import(pathToFileURL(`${process.cwd()}/dist/server/index.js`));
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be set to a valid test port');

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 65536) {
        res.writeHead(413);
        res.end('Request too large');
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
    });
    const response = await fixture(request) ?? await worker.fetch(request, {}, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Local preview error');
  }
});

server.listen(port, '127.0.0.1');
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close(() => process.exit(0)));
