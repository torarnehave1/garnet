import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Which version this build is: the commit it was built from (Cloudflare Pages gives it as
// CF_PAGES_COMMIT_SHA; a local build asks git) and when it was built. Shown as the version pill.
function commit(): string {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) return fromPages.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
