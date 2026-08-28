// Side-effect module: load .env before any other module reads process.env.
// Must be the FIRST import in the entrypoint — ES module imports hoist, so a
// bare dotenv.config() call in index.js would run after config/env.js evaluates.
// dotenv 17 logs an injection banner by default; quiet keeps startup logs clean.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
