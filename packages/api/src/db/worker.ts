// Worker thread: conexión SQLite propia para queries de lectura
// Auto-registra todas las funciones exportadas de los módulos de queries
import { parentPort } from 'worker_threads';
import { getDb } from './connection.js';
import * as queries from './queries/index.js';

const db = getDb();

// auto-register: todas las funciones exportadas que toman db como primer arg
const fns: Record<string, (args: any[]) => any> = {};
for (const [name, fn] of Object.entries(queries)) {
  if (typeof fn === 'function') {
    fns[name] = (args: any[]) => (fn as any)(db, ...args);
  }
}

parentPort!.on('message', (msg: { id: number; fn: string; args: any[] }) => {
  try {
    const handler = fns[msg.fn];
    if (!handler) throw new Error(`unknown function: ${msg.fn}`);
    const result = handler(msg.args);
    parentPort!.postMessage({ id: msg.id, result });
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, error: err.message });
  }
});

console.log(`[worker] read worker listo (${Object.keys(fns).length} funciones)`);
