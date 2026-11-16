// Prueba de humo contra un programa ya arrancado con --simular:
// autentica, lista interfaces, abre el ELM327 simulado y le habla.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../agent/package.json', import.meta.url));
const { WebSocket } = require('ws');

const puerto = process.argv[2] ?? '8777';
const token = readFileSync(join(homedir(), '.scaner-elm327', 'token'), 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:${puerto}`);
const fallar = (m) => { console.error('FALLA:', m); process.exit(1); };
setTimeout(() => fallar('tiempo agotado'), 15000).unref();

let recibido = '';
ws.on('error', (e) => fallar(e.message));
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, client: 'humo', token })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'error') return fallar(`${m.code}: ${m.message}`);
  if (m.t === 'hello-ok') {
    console.log(`agente ${m.agent.version} en ${m.agent.platform}, node ${m.agent.node}`);
    return ws.send(JSON.stringify({ t: 'list' }));
  }
  if (m.t === 'interfaces') {
    for (const i of m.items) console.log(`  [${i.kind}] ${i.label}`);
    const roto = m.items.find((i) => i.kind === 'error');
    if (roto) return fallar(`${roto.label}: ${roto.detail}`);
    if (!m.items.some((i) => i.id === 'sim:elm327')) return fallar('falta el simulador');
    return ws.send(JSON.stringify({ t: 'open', id: 'sim:elm327' }));
  }
  if (m.t === 'opened') {
    return ws.send(JSON.stringify({ t: 'write', data: Buffer.from('ATZ\r').toString('base64') }));
  }
  if (m.t === 'data') {
    recibido += Buffer.from(m.data, 'base64').toString('latin1');
    if (recibido.includes('>')) {
      if (!/ELM327/i.test(recibido)) return fallar(`respuesta inesperada: ${recibido}`);
      console.log('ELM327 simulado respondió:', recibido.replace(/[\r\n>]+/g, ' ').trim());
      process.exit(0);
    }
  }
});
