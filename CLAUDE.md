# Village Gate / بوابة القرية — rules for every session

Read PLAN.md for the data model, screens and phases. Update this file when a decision changes.

## What it is
The village super-app. The mayor (group owner) verifies residents and service businesses.
Residents post requests (gas cylinder, groceries, plumber…). Verified businesses see a privacy-safe
demand heatmap, accept requests, and deliver. Group = village. The session language with the user is English.

## Stack (do not change)
- Plain HTML, CSS and JS ES modules. No framework, no build step, no npm. CDN libraries only as pinned
  URLs (Leaflet 1.9, three.js), loaded lazily.
- GitHub Pages under `/Village-Gate/`. Every path is relative (`./`) and never starts with `/`.
- Files: index.html, config.js, manifest.webmanifest, sw.js, .nojekyll, css/style.css, js/app.js,
  js/data.js, js/data-demo.js, js/data-supabase.js, js/ui.js, js/i18n.js, js/views-*.js,
  supabase/schema.sql, README.md, LICENSE (MIT). Extra helpers: js/state.js (shared state, go(), query()),
  js/shared.js (constants shared by both backends, keep in sync with schema.sql), js/map.js (Leaflet),
  js/scene3d.js (three.js village), js/osm.js (OpenStreetMap search, map download and house placement),
  js/views-setup.js (new-village wizard), js/models3d.js (landmark 3D models), data/demo-village.json (bundled
  real map for the demo), data/maps/ (ready-made village maps + index.json).
  Icons in icons/. When adding a file, add it to SHELL in sw.js.
- Supabase project "github apps" (https://gzvknfvqyqfynainxgur.supabase.co). config.js holds only
  the URL and the publishable key. Never use or ask for the service_role or secret key.

## Backend rules
- Everything lives in schema `village_gate`, never `public`. schema.sql must be safe to re-run:
  `if not exists`, `create or replace`, `drop policy if exists`.
- RLS is on for every table. Policies use `is_member` / `has_role` helpers, which are security definer
  with `set search_path = village_gate, pg_temp`.
- Join, approve, role changes, removal, business verification, accept and deliver, delete, and
  transfer ownership all go through security definer RPCs that check permissions themselves.
- Every group table has id, group_id, created_at, created_by. Changes that matter go to `activity_log`.
- Constraints live in the DB. Grant usage on the schema to `authenticated`. README tells the user
  to add the schema under Data API > Exposed schemas.
- Platform owner page `#/owner` reads only through functions that check `platform_admins`.

## Decisions made
- Businesses are created and edited only through the `save_business` RPC (with their categories in one step).
  The client has no direct insert/update privilege on businesses, memberships or groups. Column-level grants
  keep status, role and verification fields out of reach for direct writes.
- Requests: the client inserts directly (column grants + RLS). Cancel, accept, deliver and release go through RPCs.
- Roles: owner (mayor), admin, member (resident), viewer. "Provider" is not a role: it is a
  verified `businesses` row owned by a member.
- Privacy: providers never read open requests directly, only ~100 m grid cells through `open_demand()`.
  The exact pin and phone are revealed after accepting. Home location is visible only to self and admins.
- Login is email. Phone is a stored field verified by the mayor (no SMS). No national IDs.
- Arabic is the default language (RTL). Arabic and Latin digits are both accepted in inputs. Every label lives in i18n.js.
- Arabic labels are Modern Standard Arabic (فصحى), never Egyptian colloquial. Colloquial spellings may appear only
  as hidden search words in `SERVICES`. Each language reads naturally on its own (no mixed-language labels).
- Village people may not use technology much: big tiles, few words, one main button per screen, plain language.
- Payments: cash only, never in-app. EGP prices arrive in phase 2.
- Requests expire after 3 days. Restore in Supabase mode covers places and categories only.
- The 3D map is original art (three.js), not a copy of any TV title sequence. It respects reduced motion.
- The 3D map is built from the real map: the mayor picks the village on the map in `#/setup`, the browser reads
  OpenStreetMap (Nominatim to search, Overpass for roads, canals, fields, buildings and landmarks) and the result
  is stored once in `village_maps`. Residents never call those services. OSM rarely has village buildings in
  Egypt, so houses are placed along the real streets inside the real built-up area (`synthHouses`, deterministic).
- Landmarks found on the map become places via `import_places()`; `places.osm_ref` stops duplicates
  (OSM ids n/w/r123, Overture ids o<hex>).
- Ready-made maps in data/maps/ are prepared offline (scratch tools, not in the repo) from OpenStreetMap roads plus
  Overture Maps buildings and places (free open data with Google/Microsoft outlines). Setup uses one when the chosen
  centre is within `match_m` of it. Never pay for map data or use services that need a key.
- Landmarks with a model in models3d.js (mosque, church, school, playground, health unit…) show as small original
  3D buildings and clear the houses on their spot.
- Services: 109 categories in 16 sectors plus 21 place types, all in `js/shared.js` and copied into
  `seed_categories()`. Each has hidden search words. "I need…" = big popular tiles, search with voice, then sectors.

## App behaviour
- Demo mode when config.js is empty or the URL has `?demo`: localStorage sample data, a "Demo" badge,
  and a role switcher. Views only call js/data.js, never Supabase directly.
- Mobile-first, light and dark follow the system. Lists have search, filter and sort, helpful empty
  states, confirmation for destructive actions, and toasts.
- PWA: versioned cache in sw.js, network-first for index.html, Supabase never cached, and a
  "New version, reload" prompt.

## Conventions learned while building
- In Arabic, join list items with `sep()` from ui.js (Arabic comma). A middle dot looks like the Arabic zero ٠.
- Show numbers with `fmtNum()` (Arabic-Indic digits in Arabic). Inputs accept both, normalized by `normDigits()`.
- Errors: throw/raise a short code ('forbidden', 'invalid_phone'…); the UI shows t('err.<code>').
- The demo backend (data-demo.js) must enforce the same rules as schema.sql, so the UI behaves the same.
- sw.js is not registered on localhost unless the URL has `?sw` (so edits show at once).
- Local testing: any static server works. Use one that sends `Cache-Control: no-store`, or the browser keeps old modules.

## Before calling a phase done
Run `python -m http.server`, click every screen in demo mode in both languages at phone width,
check the RLS rules on paper, confirm no secrets are in any file, and keep README current.
