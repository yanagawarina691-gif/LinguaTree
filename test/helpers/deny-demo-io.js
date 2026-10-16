// Only used by the demo test child: incoming HTTP/static file reads remain allowed.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const deny = name => () => {
  appendFileSync(process.env.DEMO_IO_TRIPWIRE, name + '\n');
  throw new Error(`Demo attempted forbidden IO: ${name}`);
};
globalThis.fetch = deny('fetch');
for (const module of [http, https]) {
  module.request = deny('http.request');
  module.get = deny('http.get');
}
net.Socket.prototype.connect = deny('socket.connect');
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[method] = deny(`child_process.${method}`);
}
syncBuiltinESMExports();
