import { Hono } from 'hono';
import { isMieridConfigured, getMieridAccount, deleteMieridAccount } from '../services/mierid-client.js';
import type { AppVariables } from '../app.js';

const mierid = new Hono<{ Variables: AppVariables }>();

// estado de la integración para el usuario actual
mierid.get('/', (c) => {
  const account = getMieridAccount(c.get('userId'));
  return c.json({
    configured: isMieridConfigured(),
    account: account ? { sub: account.sub, username: account.username } : null,
  });
});

// desvincular la cuenta (la sesión actual sigue viva)
mierid.delete('/', (c) => {
  deleteMieridAccount(c.get('userId'));
  return c.json({ ok: true });
});

export default mierid;
