import { defineConfig } from "astro/config";

// Static output, no adapter, and no client JavaScript but one file: public/copy-prompt.js, which only /submit loads
// (vercel.json lets /submit run same-site scripts; every other page keeps `script-src 'none'`). `build.inlineStylesheets: 'never'` keeps every project
// stylesheet an external file so the CSP can be `style-src 'self' https://api.fontshare.com` with no inline
// `<style>` exception. The dev toolbar is a dev-only overlay, never part of the build, but is disabled outright
// so it never runs even in `astro dev`.
export default defineConfig({
  output: "static",
  site: "https://cryptomcp.io",
  trailingSlash: "never",
  devToolbar: { enabled: false },
  build: {
    inlineStylesheets: "never",
  },
});
