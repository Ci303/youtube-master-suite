# YouTube Master Suite

YouTube Master Suite combines a focused collection of YouTube userscripts into
one maintainable Tampermonkey installation. It preserves each script as an
isolated feature module while sharing the browser infrastructure that would
otherwise be duplicated across separate scripts.

[Install or update YouTube Master Suite](https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js)

The current release is still labelled **Test** in Tampermonkey while its merged
behaviour is validated against YouTube's frequently changing interface.

## Included functionality

| Module | Source version | Purpose |
| --- | ---: | --- |
| Comment Cleaner | 1.12 | Hides comment engagement and composer clutter, compacts spacing, and distinguishes uploader and commenter names. |
| Feed UI Cleaner | 2.1 | Removes unwanted feed shelves, chips, advertisements, mixes, members-only cards, podcasts, and resulting gaps. |
| Miniplayer Button Restorer | 1.2 | Restores the native-style miniplayer control when YouTube omits it. |
| Player Preferences Lite | 1.29 | Applies player, feed, description, live-chat, volume, quality, Shorts, and watch-page preferences without taking over YouTube's queue or native miniplayer. Watched-video filtering deliberately excludes Watch History, and the single autoplay up-next card remains visible while recommendation grids are hidden. |
| Scroll Miniplayer | 5.5 | Floats the active watch or live player when it leaves the viewport. |
| Watch Layout Cleaner | 1.24 | Expands watch-page content, manages the right rail, widens metadata and comments, and provides queue-thumbnail fallbacks. |
| SponsorBlock Queue Width | 1 | Contributes its fixed `374px` right-rail rules to Watch Layout Cleaner for SponsorBlock notice and queue alignment. |

SponsorBlock Queue Width is folded into Watch Layout Cleaner rather than run as
a seventh module. This retains its required CSS without another event listener
or style element.

## Consolidation and performance design

The master is generated from the six sibling source repositories and a local
snapshot of SponsorBlock Queue Width. It deliberately avoids concatenating six
independent userscripts unchanged.

- One native `MutationObserver` dispatches only the mutation records requested
  by each isolated module.
- YouTube SPA lifecycle events are grouped so modules share native listeners
  while retaining their original capture or bubble phase.
- All module CSS is rendered through one ordered stylesheet element.
- Document-start and document-idle modules retain their original execution
  phases.
- A failing module is caught and reported without preventing the other modules
  from starting.
- Each module keeps its original configuration, selectors, functions, timers,
  and state scope.
- Top-level `ENABLED_MODULES` switches allow one module to be isolated during
  debugging without rebuilding the individual scripts.

The source manifest embedded near the top of the generated userscript records
each input version, exact Git commit and SHA-256 hash. The build fails when a
vendored source differs from its lock or when a guarded integration point
changes, preventing an upstream edit from being silently omitted.

## Installation

1. Install Tampermonkey and the Tampermonkey Editors helper extension.
2. Open the [raw userscript](https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js).
3. Confirm the Tampermonkey installation prompt.
4. Disable the individual scripts listed above, including YouTube SponsorBlock
   Queue Width, to prevent duplicated observers, styles, controls and DOM work.
5. Reload YouTube so the master starts at `document-start`.

Do not enable the master and its component userscripts together.

## Automatic updates

The userscript metadata points both `@updateURL` and `@downloadURL` at the raw
`main` userscript. Tampermonkey can therefore discover a release after its
`@version` is increased and the new generated file is committed and pushed.

Publishing a commit without increasing `@version` will not trigger a normal
Tampermonkey update.

## Configuration and fault isolation

The generated userscript contains an `ENABLED_MODULES` object near the top:

```javascript
const ENABLED_MODULES = Object.freeze({
  commentCleaner: true,
  feedUiCleaner: true,
  miniplayerButtonRestorer: true,
  playerPreferencesLite: true,
  scrollMiniplayer: true,
  watchLayoutCleaner: true,
});
```

Set one entry to `false` only when isolating a fault. Feature-specific settings
remain inside their corresponding generated module and originate from the
component source scripts.

### Optional diagnostics

Runtime diagnostics are compiled into the master but disabled by default:

```javascript
const DIAGNOSTICS = Object.freeze({
  enabled: false,
  reportIntervalMs: 30000,
});
```

When enabled for a temporary investigation, the master records module
initialisation time, shared lifecycle-event time, mutation callback time and
the number of mutation records processed. It reports periodically in the
developer console and exposes:

```javascript
__YT_MASTER_DIAGNOSTICS__.snapshot()
__YT_MASTER_DIAGNOSTICS__.report()
__YT_MASTER_DIAGNOSTICS__.clear()
```

Leave diagnostics disabled during normal use.

## Repository layout

```text
youtube-master-suite/
|-- build-master.mjs
|-- refresh-source-lock.mjs
|-- verify-master.mjs
|-- sources.lock.json
|-- youtube-master-suite.user.js
|-- sources/
|   |-- modules/
|   |   `-- <six pinned component userscripts>
|   `-- youtube-sponsorblock-queue-width.user.js
|-- .gitignore
`-- README.md
```

- `build-master.mjs` is the consolidation logic and build entry point.
- `sources.lock.json` pins every component to an exact repository commit and
  SHA-256 hash.
- `refresh-source-lock.mjs` verifies the sibling source repositories and
  refreshes the pinned, vendored source snapshots.
- `verify-master.mjs` checks reproducibility, syntax, metadata, source locks,
  shared infrastructure, route exclusions, diagnostics defaults and the local
  manual-install copy.
- `youtube-master-suite.user.js` is the generated, installable artefact.
- `sources/modules/` makes a clean clone reproducible without separately
  cloning or importing the six component repositories.
- `sources/youtube-sponsorblock-queue-width.user.js` preserves the standalone
  source that is folded into Watch Layout Cleaner.
- `youtube-master-suite.txt` is a local manual-install copy and is deliberately
  ignored because the `.user.js` file is the canonical published artefact.

## Building and verification

A normal build uses the committed source lock and vendored snapshots, so a
clean clone is sufficient:

```powershell
node .\build-master.mjs
node .\verify-master.mjs
```

`node .\build-master.mjs --check` verifies that the generated userscript is
current without writing it. `node .\verify-master.mjs --release` additionally
requires a clean, upstream-synchronised maintainer checkout and a matching
local `.txt` copy.

Identical locked inputs produce an identical userscript and SHA-256 hash.

### Refreshing component sources

Maintainers keep the six component repositories beside this repository. After
a component change has been committed and pushed:

```powershell
node .\refresh-source-lock.mjs
node .\build-master.mjs
Copy-Item .\youtube-master-suite.user.js .\youtube-master-suite.txt -Force
node .\verify-master.mjs
```

The refresh command refuses dirty, non-`main` or upstream-diverged component
repositories. This ensures the public master never embeds an unpublished
working-tree version.

## TampermonkeyFS workflow

The recommended permanent local link is the generated file in the repository
checkout:

```text
<repository checkout>\youtube-master-suite.user.js
```

In VS Code, connect TampermonkeyFS to Tampermonkey, open **YouTube Master Suite
(Test)** from the virtual Tampermonkey folder, select **Link With Local
File...**, and choose the generated `.user.js` file.

TampermonkeyFS is editor-centred. A permanent change should follow this flow:

1. Edit, validate, commit and push the relevant component source.
2. Run `node .\refresh-source-lock.mjs`.
3. Increase the master version and run `node .\build-master.mjs`.
4. Run `node .\verify-master.mjs`.
5. Let TampermonkeyFS load the changed linked file into its virtual editor.
6. Save the virtual editor to send the same source to Tampermonkey.
7. Verify that the installed and repository sources match before committing.

Direct edits to the generated userscript can be overwritten by the next build.

## Validation checklist

Before publishing a new version:

1. Increase the master `@version` in `build-master.mjs`.
2. Refresh and review `sources.lock.json`.
3. Rebuild and run `node .\verify-master.mjs`.
4. Confirm the route-policy checks cover any new exclusions.
5. Test YouTube home, History and subscription feeds, watch-page SPA navigation,
   comments, queue changes, the restored miniplayer button, scroll miniplayer,
   fullscreen transitions, live pages, and the `374px` SponsorBlock queue.
6. Commit and push, then run `node .\verify-master.mjs --release`.
7. Confirm the installed Tampermonkey source matches the generated file.

## Compatibility and limitations

- YouTube is a continuously changing single-page application. Selectors and
  lifecycle timing may require updates without warning.
- The suite targets `https://www.youtube.com/*` and does not run in frames.
- The static Premium masthead-logo preference can only be fully validated when
  YouTube serves an event or animated logo.
- The script does not attempt to control SponsorBlock itself; it only preserves
  the right-rail width needed for its notice and queue alignment.
- Automatic updates require access to the public raw GitHub URL.

## Licence

The generated userscript is published under GNU GPLv3, consistent with the
licence metadata carried by its GPL-covered source components.
