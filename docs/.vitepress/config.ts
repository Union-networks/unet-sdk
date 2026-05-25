import { defineConfig } from 'vitepress';
export default defineConfig({
  title: 'U-net SDK',
  description: 'Developer docs for U-net web login and verification SDKs',
  themeConfig: {
    nav: [{ text: 'Quickstarts', link: '/quickstarts/sign-in-with-unet' }, { text: 'API', link: '/api' }],
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
      ]},
      { text: 'Reference', items: [{ text: 'API Reference', link: '/api' }]},
    ],
  },
});
