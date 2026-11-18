import { createApp } from './app.js';
import { seed } from './seed.js';

const port = Number(process.env.PORT || 3000);
const app = createApp({ dev: process.env.NODE_ENV !== 'production' });
if (!app.db.get('SELECT 1 FROM programs LIMIT 1')) {
  console.log('Empty database: loading demo program…');
  seed(app.db);
}
app.tick();
app.server.listen(port, () => console.log(`Program Manager running on http://localhost:${port}`));
