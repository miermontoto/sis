import { eq } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { users } from '../../db/schema.js';
import { getAllUsers, updateUser, getUserById, hardDeleteUser } from '../../services/user-manager.js';
import { adminRouter } from './_shared.js';

const usersRoute = adminRouter();

usersRoute.get('/users', (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);
  return c.json(getAllUsers());
});

usersRoute.post('/users', async (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ spotifyId: string }>();
  if (!body.spotifyId?.trim()) {
    return c.json({ error: 'spotifyId is required' }, 400);
  }

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.spotifyId, body.spotifyId.trim())).get();
  if (existing) {
    return c.json({ error: 'user already exists' }, 409);
  }

  const now = new Date().toISOString();
  const result = db.insert(users).values({
    spotifyId: body.spotifyId.trim(),
    isAdmin: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }).returning().get();

  return c.json(result, 201);
});

usersRoute.put('/users/:id', async (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const id = parseInt(c.req.param('id'));
  const body = await c.req.json<{ isAdmin?: boolean; isActive?: boolean }>();

  const user = getUserById(id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  // prevenir quitar admin al último admin
  if (body.isAdmin === false && user.isAdmin) {
    const allUsers = getAllUsers();
    const adminCount = allUsers.filter(u => u.isAdmin && u.isActive).length;
    if (adminCount <= 1) {
      return c.json({ error: 'cannot remove last admin' }, 400);
    }
  }

  const updated = updateUser(id, body);
  return c.json(updated);
});

usersRoute.delete('/users/:id', (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const id = parseInt(c.req.param('id'));
  const currentUserId = c.get('userId');

  if (id === currentUserId) {
    return c.json({ error: 'cannot delete yourself' }, 400);
  }

  const user = getUserById(id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (user.isActive) {
    // active users get soft-deleted first
    updateUser(id, { isActive: false });
  } else {
    // inactive users get hard-deleted
    hardDeleteUser(id);
  }
  return c.json({ success: true });
});

export default usersRoute;
