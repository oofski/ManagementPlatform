import { createApp } from './app.js';
import { seed } from './seed.js';
import { hashPassword, token, DEFAULT_SETTINGS } from './core.js';

const port = Number(process.env.PORT || 3000);
// Demo mode shows the demo-account picker on the sign-in page and loads sample data into an empty database.
const demo = process.env.DEMO_MODE === '1' || process.env.NODE_ENV !== 'production';
const app = createApp({ dev: demo });

if (!app.db.get('SELECT 1 FROM programs LIMIT 1')) {
  if (demo) {
    console.log('Empty database: loading the demo program…');
    seed(app.db);
  } else if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    // First run in production: create the program and the head coach account from environment variables.
    const pid = app.db.insert('programs', { name: process.env.PROGRAM_NAME || 'Football', school: process.env.SCHOOL_NAME || '', state: process.env.STATE || 'OTHER', settings: DEFAULT_SETTINGS });
    const y = new Date().getFullYear();
    app.db.insert('seasons', { program_id: pid, name: `Fall ${y}`, start_date: `${y}-06-01`, end_date: `${y}-12-15`, active: 1, phases: [] });
    app.db.insert('users', { program_id: pid, name: process.env.ADMIN_NAME || 'Head Coach', email: process.env.ADMIN_EMAIL, password_hash: hashPassword(process.env.ADMIN_PASSWORD), role: 'head_coach', title: 'Head coach', joined_at: new Date().toISOString(), cal_token: token(16) });
    console.log(`Created program and head coach account for ${process.env.ADMIN_EMAIL}`);
  } else {
    console.warn('Empty database. Set ADMIN_EMAIL and ADMIN_PASSWORD (and PROGRAM_NAME) to create the first account, or DEMO_MODE=1 to load demo data.');
  }
}
app.tick();
app.server.listen(port, () => console.log(`Program Manager running on port ${port}${demo ? ' (demo mode)' : ''}`));
