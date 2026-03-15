import { createHash } from 'crypto';

// genera un ID determinístico a partir de dos componentes
export function syntheticId(prefix: string, a: string, b: string): string {
  const hash = createHash('sha256')
    .update(`${a.toLowerCase()}|${b.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}${hash}`;
}
