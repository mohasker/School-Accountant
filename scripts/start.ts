import { runLocal } from './local';

/** The regular installation on this computer (Start-Madar.bat): real data in .data/moesas, no trial data. */
runLocal(false).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
