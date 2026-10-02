import { runLocal } from './local';

/** Trial run with synthetic data (.data/demo); the real installation is scripts/start.ts (Start-Madar.bat). */
runLocal(true).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
