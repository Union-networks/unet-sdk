import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig({
  base: process.env.DOCS_BASE ?? '/',
  title: `U-net SDK ${packageJson.version}`,
  description: 'Sovereign Core V2 developer documentation for U-net',
  cleanUrls: true,
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Guides', link: '/quickstarts/sign-in-with-unet' },
      { text: 'API', link: '/api/generated/README' },
      { text: packageJson.version.includes('-') ? `${packageJson.version} · next` : `${packageJson.version} · stable`, items: [
        { text: 'Changelog', link: '/changelog' },
        { text: 'GitHub releases', link: 'https://github.com/Union-networks/unet-sdk/releases' },
      ] },
    ],
    sidebar: [
      { text: 'Quickstarts', items: [
        { text: 'Sign in with U-net', link: '/quickstarts/sign-in-with-unet' },
        { text: 'Over-18 verification', link: '/quickstarts/over-18-verification' },
      ]},
      { text: 'Concepts', items: [
        { text: 'Scoped IDs', link: '/concepts/scoped-ids' },
        { text: 'Login assertions', link: '/concepts/login-assertions' },
        { text: 'Checkout-bound verification', link: '/concepts/checkout-bound-verification' },
      ]},
      { text: 'Guides', items: [
        { text: 'Make your web app miniapp-ready', link: '/guides/miniapp-ready' },
        { text: 'Migrate to @u-net', link: '/migration/from-union-networks' },
      ]},
      { text: 'Reference', items: [
        { text: 'Packages', link: '/packages/client' },
        { text: 'API Reference', link: '/api/generated/README' },
        { text: 'Provider environment', link: '/provider-environment' },
        { text: 'Changelog', link: '/changelog' },
      ]},
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Union-networks/unet-sdk' },
      { icon: 'github', link: 'https://github.com/orgs/Union-networks/discussions' },
    ],
  },
});
