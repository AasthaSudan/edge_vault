// Set NEXT_PUBLIC_DEMO_NOTICE=1 at build time for the hosted demo. It runs on a small cloud
// server with the on-device LLM switched off, so the UI says so and points to a local setup.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_NOTICE === "1";

export const LOCAL_SETUP_URL = "https://github.com/AasthaSudan/edge_vault#quickstart";
