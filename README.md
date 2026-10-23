# JJsoga — Hexin Chen's website

A static bilingual personal portfolio and experimental Play page built with Astro and TypeScript. The site is designed for GitHub Pages and keeps content, interaction rules and presentation separate.

## Run locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev -- --background
```

Astro prints the local address, normally `http://localhost:4321`. To verify the production output:

```bash
npm run build
npm run preview
```

The generated static site is written to `dist/`.

Manage the background development server with `npm run astro -- dev status`,
`npm run astro -- dev logs`, and `npm run astro -- dev stop`.

## Experimental playground

`/play/` is a client-side playground linked from both portfolio homepages. Choose
letters, the existing website card (`public/og.png`), or the JJ mark
(`public/favicon.svg`). Push moves nearby pieces away and returns them to their
resting positions. Grab drags the whole selected sample and carries its release
velocity into a frictional throw. Scatter separates the sample into letters or
tiles; Repel/Attract changes the cursor force and Regroup restores the arrangement.
Reset immediately restores positions and cancels any gesture while preserving the
selected sample, mode, and strength. Changing mode or resizing also restores the
sample; entering Scatter mode scatters it immediately.

Mouse, pen, and one primary touch use Pointer Events and capture. Touch gestures
are confined to the canvas; the rest of the page scrolls normally. Cancellation,
lost capture, loss of focus, and hiding the page stop the current gesture without
throwing it. Keyboard users can focus the stage, move with arrows (Shift for a
larger step), grab/release with Enter, and reset with Escape. Reduced motion uses
direct placement with no inertia or animated recovery. Readable originals and
normal navigation remain available with JavaScript disabled.

The implementation is original and adds no runtime dependency:

- `src/scripts/play/input.ts`: pointer capture, release velocity, cancellation and keyboard input.
- `src/scripts/play/behaviors.ts`: DOM-free movement, recovery and bounds.
- `src/scripts/play/trails.ts`: a separate pool of short-lived pointer particles.
- `src/scripts/play/renderer.ts`: sample layout and canvas drawing.
- `src/scripts/play/config.ts`: shared numerical limits.
- `src/scripts/play/index.ts`: controls, loading and lifecycle cleanup.
- `src/components/Playground.astro`: accessible reusable markup and sample sources.

Reuse with `<Playground id="another-playground" enabledModes={['push', 'grab']} />`.
Use a unique `id` for each instance. `createPlayground(root, { enabledModes })`
also returns `reset()`, `destroy()` and a copied `getSnapshot()` for custom hosts
that manage their own mounting. The standard component mounts automatically and
cleans up on page exit and Astro navigation, including browser Back restoration.

Configuration: 12 text glyphs, 32 website-card tiles or 36 mark tiles; maximum
128 pieces, device pixel ratio capped at 2, speed capped at 900 CSS px/s, physics
timestep capped at 1/30 s. Strength is 0.25–2 (default 1), interaction radius
120 CSS px, spring 120, damping 22, throw friction 2.5, scatter friction 4.5 and
edge restitution 0.42. Scatter placement is deterministic. There is one animation
loop per instance, which sleeps at rest, pauses off-screen/when hidden, and has a
600-frame ceiling per input as a safeguard. At most two image loads are pending.

Run `npm run test:play` for the pure movement regression checks. With a background
dev server and Playwright CLI browser open, run the browser checks using
`npx --yes --package @playwright/cli playwright-cli -s=website-play run-code --filename scripts/check-play-browser.js`.
Run `npm run build` before release. Browser artifacts belong in `output/playwright/`
and are ignored by Git.

This is an engineering experiment, with no participant dataset, labels, training,
test split or performance selection. The comparison baseline is the existing
portfolio: its main content, language routes, assets, styling tokens and hosting
stay in place. The material implementation choices are a bounded canvas, explicit
sample selection, rigid whole-sample dragging, deterministic scattering, single
primary-pointer input, direct reduced-motion behavior, and reset-on-resize. There
are no inter-particle collisions or arbitrary text selections in this first version.

Verification for the initial release (2026-10-23): production build and strict
TypeScript checks passed, along with six physics regression groups and thirteen
Chromium browser check groups. Browser coverage includes actual mouse dragging
and release, native Chromium touch cancellation, lost capture, stale release
velocity, keyboard manipulation, both images, scatter/regroup, reduced motion,
320/390px layouts, independent instances and navigation cleanup. The compiled
site also passed image rendering, both homepage navigation links, and no-JavaScript
fallback checks without browser runtime errors. English and Chinese `<main>`
content matched the pre-change build at commit `0f74754` after stripping generated
Astro scope attributes. New page JavaScript is about 14 kB before compression.
Physical iPhone/Safari testing remains outstanding; touch tests used Chromium.

## Trails and Word Dice (iteration 2)

Trail is on by default, independently of Push, Grab or Scatter. Its native
checkbox disables the effect immediately. A separate particle pool is emitted
along mouse/pen movement, captured touch drags, or keyboard cursor movement;
speed adjusts spacing and size, with limits in `PLAY_CONFIG.trail`. Defaults:
96 particles, at most 12 emissions per move, 0.55-second lifetime, 22 CSS px/s
drift, 5–10 px spacing, 1.4–3.2 px radius, and a speed response capped at
1600 CSS px/s. Aging and drift use elapsed seconds. Particles fade behind the
sample, remain clipped to the canvas, and keep the existing animation loop awake
only until they expire. Reduced motion suppresses trails while remembering the
toggle preference. Reset, cancellation, resize, blur, hiding, scrolling offscreen,
and teardown clear them; re-entry cannot draw a bridge across the page.

Word Dice uses the four curated banks in `src/scripts/word-dice/rules.ts`:
adjective + plural subject + plural-compatible verb phrase + adverbial ending.
Each bank has exactly six faces, yielding 1,296 possible lines. The visible rules
show every face-to-phrase mapping. Initial faces are `[1, 1, 1, 1]`; each unlocked
die uses `floor(Math.random() * 6) + 1`. Repeated faces are valid, with no hidden
reroll-until-different rule or selection of preferred sentences. Locks preserve
their values, including individual rerolls. `generateLine` and `rollDice` are
pure and accept injected randomness for repeatable checks. The presentation is
in `WordDice.astro`, its stylesheet, and `src/scripts/word-dice/index.ts`.

The generated line updates immediately, without an animation or external text
service. Copy uses the Clipboard API and provides selectable text if access is
denied. Cached history restores faces and locks together; a fresh document resets
both. A one-shot synchronization after page restoration prevents browser-restored
checkboxes from disagreeing with the dice model. The example and phrase
banks are readable without JavaScript. All output is labelled as a generated line,
with no author attribution. There is no dataset, train/test partition, or scientific
claim; all combinations are checked rather than selecting a favorable subset.

Verification commands:

```bash
npm run build
npm run test:metadata
npm run test:play
npm run test:word-dice
npx --yes --package @playwright/cli playwright-cli -s=website-play open http://localhost:4321/play/
npx --yes --package @playwright/cli playwright-cli -s=website-play run-code --filename scripts/check-play-browser.js --raw
npx --yes --package @playwright/cli playwright-cli -s=website-play run-code --filename scripts/check-play-v2-browser.js --raw
```

Iteration 2 checks cover exact generated metadata and 96×96 icon bytes, unchanged
Google verification, all 1,296 word mappings and 16 lock masks, trail caps/expiry/
timestep consistency, existing interactions, visibility/offscreen cleanup, keyboard
controls, narrow layouts and history restoration. Clipboard success/denial tests
use isolated browser stubs so testing does not alter the user's clipboard. Grammar
is curated and reviewed; automated mapping checks do not measure literary quality.
The intended behavior is supported by these checks, with physical Safari/device
testing still outstanding. Defaults chosen for this iteration are the bounded
trail settings above, trails on except under reduced motion, immediate dice results,
the curated banks and initial faces, and honest repeat faces. No material deviation
from the understanding checkpoint was needed.

To explain the result: this adds an isolated interactive page to the existing
static portfolio. Input events update a bounded set of letters or image tiles,
and a small physics step redraws them only while motion is needed. Explicit modes,
reset, readable originals and reduced-motion support preserve user control.
The automated checks support functional correctness in Chromium, not claims about
engagement, universal device support or benchmark performance. No material design
deviation from the initial checkpoint was required.

## Edit content

- `src/data/profile.ts` contains the name, biography, education, interests, contact links, coursework, awards, navigation, and default metadata.
- `src/data/site.ts` contains the JJsoga site identity and single root-homepage WebSite entity. Personal headings remain Hexin Chen / 陈鹤鑫; page titles are independent of the brand.
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

## Branding and search appearance

The English title, Open Graph title and Twitter title are `Hexin Chen`; the
Chinese equivalents are `陈鹤鑫`. The Play title remains `Play | Hexin Chen`.
All pages share the visible JJsoga brand and `og:site_name`. The single `WebSite`
JSON-LD entity on `/` uses `JJsoga`, alternative name `Hexin Chen`, and
`https://jjsoga.github.io/`. Canonical URLs, language alternatives, and the Google
verification file are preserved. The JJ monogram is shared by headers and Play;
`npm run icons` regenerates its 96 × 96 PNG from `public/favicon.svg`.

After deployment, open Google Search Console, choose the verified property for
`https://jjsoga.github.io/`, inspect that exact homepage URL, and choose **Request
indexing**. Use **Test live URL** first to check the deployed page if needed. An
owner or full-user role is required. This requests a recrawl, not a guaranteed
search title or site name; Google controls indexing, appearance and timing, which
can take days to weeks. Repeating the request does not make it faster. See
[Google's recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
and [site-name guidance](https://developers.google.com/search/docs/appearance/site-names).
