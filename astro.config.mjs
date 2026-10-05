// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://JJsoga.github.io',
  output: 'static',
  i18n: {
    locales: ['en', { path: 'zh', codes: ['zh-CN', 'zh'] }],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
