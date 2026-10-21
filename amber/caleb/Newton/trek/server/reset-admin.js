const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data/travel.db');
const db = new Database(dbPath);

const hash = bcrypt.hashSync('admin123', 10);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@admin.com');

if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE email = ?')
    .run(hash, 'admin', 'admin@admin.com');
  console.log('✓ Admin-Passwort zurückgesetzt: admin@admin.com / admin123');
} else {
  db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('admin', 'admin@admin.com', hash, 'admin');
  console.log('✓ Admin-User erstellt: admin@admin.com / admin123');
}

db.close();
