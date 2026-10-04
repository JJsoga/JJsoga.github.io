# Hexin Chen — Academic Portfolio

A static, single-page academic and technical portfolio built with Astro and TypeScript. The site is designed for GitHub Pages and keeps profile content separate from presentation code.

## Run locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Astro prints the local address, normally `http://localhost:4321`. To verify the production output:

```bash
npm run build
npm run preview
```

The generated static site is written to `dist/`.

## Edit content

- `src/data/profile.ts` contains the name, biography, education, interests, contact links, coursework, awards, navigation, and default metadata.
- `src/data/projects.ts` contains the flagship and current-work project content.
- `src/components/FlagshipProjectCard.astro` contains the accessible neural-audio and sensing pipeline diagrams.
- `src/pages/index.astro` defines the homepage section structure.
- `src/styles/global.css` contains the visual system and responsive layout.

Email, GitHub, and CV links are configured in `src/data/profile.ts`. The CV file is stored at `public/Hexin.pdf`; replace that file or update its filename in the profile data when publishing a new revision. Add a project link only after a real public route or external destination exists.

## Deploy to GitHub Pages

The workflow at `.github/workflows/deploy.yml` builds and publishes the site whenever the `main` branch is pushed. The `site` value in `astro.config.mjs` is configured for `JJsoga.github.io`. Commit `package-lock.json`, then:

1. Push the repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.

For a user site stored in a repository named `JJsoga.github.io`, no other Astro setting is needed.

For a project site at `https://JJsoga.github.io/REPOSITORY-NAME/`, add the repository subpath:

```js
export default defineConfig({
  site: 'https://JJsoga.github.io',
  base: '/REPOSITORY-NAME',
  output: 'static',
});
```

If the deployment branch is not `main`, update the branch name in `.github/workflows/deploy.yml`.

## Use a custom domain later

1. Add a `public/CNAME` file containing only the domain, such as `www.example.com`.
2. Change `site` in `astro.config.mjs` to the full custom-domain URL and remove `base` unless the site is intentionally served below a path.
3. Configure the domain in the repository's **Settings → Pages** and add the DNS records GitHub provides.

Run `npm run build` after every configuration change so canonical and social metadata use the final public URL.
