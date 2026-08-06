# YouTube Master Suite

YouTube Master Suite combines a focused collection of YouTube userscripts into
one maintainable Tampermonkey installation. It preserves each script as an
isolated feature module while sharing the browser infrastructure that would
otherwise be duplicated across separate scripts.

[Install or update YouTube Master Suite](https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js)

This repository is the definitive source for the suite. The former standalone
component repositories are superseded and are not required to build, maintain
or install it.

## Included functionality

| Module | Source version | Purpose |
| --- | ---: | --- |
| Comment Cleaner | 1.13 | Hides comment engagement and composer clutter, prevents stale comments from appearing after queue navigation, compacts spacing, and distinguishes uploader and commenter names. |
| Feed UI Cleaner | 2.3 | Removes unwanted feed shelves, chips, advertisements, mixes, members-only cards, podcasts, and resulting gaps while preserving YouTube search. |
| Miniplayer Button Restorer | 1.3 | Restores the native-style miniplayer control when YouTube omits it, while avoiding redundant installation work once attached. |
| Page Coherence Guard | 1.0 | Detects incomplete queue navigation, hides confirmed stale metadata and comments, offers an explicit page-data reload, and publishes lightweight navigation-state diagnostics. |
| Player Preferences Lite | 1.33 | Applies player, feed, description, live-chat, volume, quality, Shorts, and watch-page preferences without taking over YouTube's queue or native miniplayer. Keeps native like and Return YouTube Dislike counts vertically aligned. Watched-video filtering deliberately excludes Watch History. Info cards, recommendation grids, and the single autoplay up-next card have independent settings. Layout refresh retries are coalesced, and ordinary wheel events avoid player lookup. |
| Scroll Miniplayer | 5.8 | Floats the active watch or live player when it leaves the viewport and shows compact current-title and queue-position context while the full queue remains hidden. Navigation is locked until the new route settles, queue context follows the current watch or live video ID, and observation stops off eligible routes. |
| Watch Layout Cleaner | 1.25 | Expands watch-page content, keeps the right rail at the SponsorBlock-friendly `374px` width, widens metadata and comments, and provides queue-thumbnail fallbacks. |

The former standalone SponsorBlock Queue Width script remains superseded. Its
required layout rules are owned directly by Watch Layout Cleaner, avoiding a
redundant source artefact, event listener and style element.

## Consolidation and performance design

The master is generated from the canonical module inventory declared by
`sources.lock.json` and matched exactly against `sources/modules/`. It
deliberately avoids concatenating independent userscripts unchanged.

- One native `MutationObserver` dispatches only the mutation records requested
  by each isolated module.
- YouTube SPA lifecycle events are grouped so modules share native listeners
  while retaining their original capture or bubble phase.
- Scroll Miniplayer disconnects its mutation observer and rejects scroll work
  outside settled watch and live routes.
- Player Preferences coalesces overlapping layout-refresh retries and rejects
  ordinary wheel events before querying the player DOM.
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
each canonical path, input version and SHA-256 hash. The build fails when a
module differs from its lock or when a guarded integration point changes,
preventing an unreviewed source edit from being silently included.

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

## Runtime health marker

Every successful injection publishes a small JSON health marker on the root
document element:

```javascript
JSON.parse(document.documentElement.getAttribute("data-yt-master-suite"))
```

It reports the loaded master version; registered and expected module counts;
the enabled, initialised, pending and disabled module IDs; any failed module
IDs and bounded error messages; and `ready` and `healthy` states. `ready` is
false while an enabled module is pending. `healthy` is true only after every
module is registered, no enabled module is pending and no module failed. The
marker is always enabled and does not collect timings or observe additional
DOM changes. A missing marker means the userscript did not reach its
registration-complete stage. This is injection and initialisation health;
errors raised later by lifecycle or mutation callbacks remain console-reported
and do not retroactively change the marker.

## Configuration and fault isolation

The generated userscript contains an `ENABLED_MODULES` object near the top:

```javascript
const ENABLED_MODULES = Object.freeze({
  commentCleaner: true,
  feedUiCleaner: true,
  miniplayerButtonRestorer: true,
  pageCoherence: true,
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
developer console, sorted by total execution time, and exposes:

```javascript
__YT_MASTER_DIAGNOSTICS__.snapshot()
__YT_MASTER_DIAGNOSTICS__.report()
__YT_MASTER_DIAGNOSTICS__.clear()
```

Firefox may keep that API inside the userscript sandbox. The same snapshot is
therefore published every 30 seconds as a diagnostic document attribute and
can be retrieved from the page console with:

```javascript
JSON.parse(
  document.documentElement.getAttribute("data-yt-master-diagnostics"),
)
```

Leave diagnostics disabled during normal use.

### Lightweight navigation state

The Page Coherence Guard always publishes a small current-state snapshot and a
bounded history of the last 20 navigation events. It performs no continuous
polling and collects no performance timings:

```javascript
JSON.parse(document.documentElement.getAttribute("data-yt-master-state"))
JSON.parse(document.documentElement.getAttribute("data-yt-master-events"))
```

When accessible from the page console, the equivalent API is:

```javascript
__YT_MASTER_STATE__.snapshot()
__YT_MASTER_STATE__.events()
__YT_MASTER_STATE__.check()
```

After two persistent checks confirm that the URL and player have advanced but
`ytd-watch-flexy` still belongs to the previous video, stale metadata and
comments are hidden. The suite displays an explicit reload control; it never
reloads automatically because that could discard a temporary queue.

## Repository layout

```text
youtube-master-suite/
|-- build-master.mjs
|-- refresh-source-lock.mjs
|-- verify-installed-master.mjs
|-- verify-master.mjs
|-- release-manifest.json
|-- sources.lock.json
|-- youtube-master-suite.user.js
|-- sources/
|   |-- modules/
|   |   `-- <pinned component userscripts>
|-- .gitignore
`-- README.md
```

- `build-master.mjs` is the consolidation logic and build entry point.
- `sources.lock.json` pins every canonical module to its version and SHA-256
  hash.
- `release-manifest.json` records the generated version, SHA-256 hash, byte and
  character lengths, and exact module-registration count.
- `refresh-source-lock.mjs` refreshes those values from the reviewed canonical
  files in `sources/modules/`.
- `verify-installed-master.mjs` compares an installed or exported userscript
  file against the release manifest.
- `verify-master.mjs` checks reproducibility, syntax, metadata, source locks,
  shared infrastructure, route exclusions, diagnostics defaults and the local
  manual-install copy.
- `youtube-master-suite.user.js` is the generated, installable artefact.
- `sources/modules/` contains the definitive, directly maintained feature
  module sources. The build rejects missing, orphaned or duplicate inventory
  entries.
- `youtube-master-suite.txt` is a local manual-install copy and is deliberately
  ignored because the `.user.js` file is the canonical published artefact.

## Building and verification

A normal build uses the committed source lock and canonical sources contained
in this repository, so a clean clone is sufficient:

```powershell
node .\build-master.mjs
node .\verify-master.mjs
node .\verify-installed-master.mjs .\youtube-master-suite.user.js
```

`node .\build-master.mjs --check` verifies that the generated userscript is
current without writing it. `node .\verify-master.mjs --release` additionally
requires a clean, upstream-synchronised maintainer checkout and a matching
local `.txt` copy.

Identical locked inputs produce an identical userscript and SHA-256 hash.
GitHub Actions runs the build check, verifier and syntax checks on every push
and pull request. Its version check compares the generated artefact with the
push-before commit or pull-request base rather than the already checked-out
commit.

### Editing module sources

Edit the relevant canonical userscript in `sources/modules/`, increase that
module's metadata version, then refresh the lock and rebuild:

```powershell
node .\refresh-source-lock.mjs
node .\build-master.mjs
Copy-Item .\youtube-master-suite.user.js .\youtube-master-suite.txt -Force
node .\verify-master.mjs
```

The refresh command only updates module versions and hashes. Review its diff
before building. A normal build refuses any canonical source whose content or
version differs from the lock.

## TampermonkeyFS workflow

The recommended permanent local link is the generated file in the repository
checkout:

```text
<repository checkout>\youtube-master-suite.user.js
```

In VS Code, connect TampermonkeyFS to Tampermonkey, open **YouTube Master
Suite** from the virtual Tampermonkey folder, select **Link With Local File...**,
and choose the generated `.user.js` file.

TampermonkeyFS is editor-centred. A permanent change should follow this flow:

1. Edit and validate the relevant source in `sources/modules/`.
2. Run `node .\refresh-source-lock.mjs`.
3. Increase the master version and run `node .\build-master.mjs`.
4. Run `node .\verify-master.mjs`.
5. Let TampermonkeyFS load the changed linked file into its virtual editor.
6. Save the virtual editor to send the same source to Tampermonkey.
7. Read the saved script back from Tampermonkey and verify its hash, length and
   manifest-declared module registrations against `release-manifest.json`
   before committing.

For a file-backed or exported installed copy, run:

```powershell
node .\verify-installed-master.mjs <installed-source-path>
```

Direct edits to the generated userscript can be overwritten by the next build.

## Validation checklist

Before publishing a new version:

1. Increase the master `@version` in `build-master.mjs`.
2. Refresh and review `sources.lock.json` after editing canonical module
   sources.
3. Rebuild and run `node .\verify-master.mjs`.
4. Confirm the route-policy checks cover any new exclusions.
5. Test YouTube home, History and subscription feeds, watch-page SPA navigation,
   comment/video-ID parity during queue changes, the restored miniplayer button,
   scroll miniplayer, fullscreen transitions, live pages, and the `374px`
   SponsorBlock queue.
6. Commit and push, then run `node .\verify-master.mjs --release`.
7. Confirm the installed Tampermonkey source matches
   `release-manifest.json`, including its declared module registrations.

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
