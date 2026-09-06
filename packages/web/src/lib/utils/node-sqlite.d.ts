// tipado mínimo de node:sqlite (node >= 22.13) para el test de periodos: el paquete
// web no tiene @types/node y solo lo usa para pedirle a sqlite la verdad de strftime
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): { get(...params: (string | number)[]): Record<string, unknown> | undefined };
  }
}
