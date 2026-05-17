/**
 * Idempotent MongoDB users for platform stack (runs before --auth is enabled).
 */
const adminUser = process.env.MONGO_ADMIN_USER;
const adminPass = process.env.MONGO_ADMIN_PASSWORD;
const appUser = process.env.MONGO_APP_USER;
const appPass = process.env.MONGO_APP_PASSWORD;
const dbName = process.env.MONGO_DB_NAME || 'platform';

function requireEnv(name, value) {
  if (!value) {
    print(`[ERROR] ${name} is required`);
    quit(1);
  }
}

requireEnv('MONGO_ADMIN_USER', adminUser);
requireEnv('MONGO_ADMIN_PASSWORD', adminPass);
requireEnv('MONGO_APP_USER', appUser);
requireEnv('MONGO_APP_PASSWORD', appPass);

function userExists(username, authDb) {
  const users = db.getSiblingDB(authDb).getUsers({ filter: { user: username } }).users;
  return users.length > 0;
}

if (!userExists(adminUser, 'admin')) {
  print(`[INFO] Creating admin user ${adminUser}`);
  db.getSiblingDB('admin').createUser({
    user: adminUser,
    pwd: adminPass,
    roles: [
      { role: 'userAdminAnyDatabase', db: 'admin' },
      { role: 'readWriteAnyDatabase', db: 'admin' },
      { role: 'dbAdminAnyDatabase', db: 'admin' },
    ],
  });
} else {
  print(`[INFO] Admin user ${adminUser} already exists`);
}

if (!userExists(appUser, dbName)) {
  print(`[INFO] Creating app user ${appUser} on ${dbName}`);
  db.getSiblingDB(dbName).createUser({
    user: appUser,
    pwd: appPass,
    roles: [{ role: 'readWrite', db: dbName }],
  });
} else {
  print(`[INFO] App user ${appUser} already exists`);
}

print('[INFO] MongoDB auth users ready');
