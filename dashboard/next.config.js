/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second dev server (Device B on :3001) build into its own directory.
  // NEXT_PUBLIC_* values are inlined at compile time, so two servers sharing
  // ".next" serve each other's bundles and point at the wrong edge node.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
