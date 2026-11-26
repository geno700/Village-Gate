# Village Gate · بوابة القرية

The village super-app. The mayor (العمدة) verifies every resident and every service business.
Residents ask for what they need (a gas cylinder, groceries, a plumber…). Verified businesses
see a privacy-safe **demand heatmap**, accept requests, and deliver along a suggested route.
There is also a map and directory of every mosque, school, clinic and shop, and an animated 3D model of the
village built from its real map (roads, canals, fields and landmarks from OpenStreetMap).

- 109 services in 16 sectors (home, food, health, trades, transport, farming, shops, vehicles, phones and internet,
  building, industry, education, personal care, events, professional, other) plus 21 kinds of landmarks.
  Residents find a service with big picture tiles, by typing, or by speaking.

- Plain HTML, CSS and JavaScript modules. No framework, no build step, no npm.
- Modern Standard Arabic (default, right-to-left) and English. Light and dark follow the phone.
- Installable as an app (PWA). Works one-handed on a phone and on desktop too.
- Live at: https://geno700.github.io/Village-Gate/

## Try it (demo mode)

Demo mode runs entirely in your browser with a sample village, "Kafr El-Nakhla" (made-up people and shops placed
on the real roads and fields near Damsheet, Gharbia, from `data/demo-village.json`). It has about 40 homes,
20 businesses, 15 places and about 70 requests.
It switches on when `config.js` has no key, or when the URL contains `?demo`.
Tap the orange **Demo** badge to act as the mayor, an admin, a resident, the gas seller, the grocer,
a viewer, or someone still waiting for approval.

## Run locally

```powershell
python -m http.server 8000
```

Open http://localhost:8000/. The service worker is off on localhost so your edits show at once;
add `?sw` to the URL to test offline mode and the "New version" prompt.

## Connect Supabase

The app uses the shared Supabase project "github apps" (`https://gzvknfvqyqfynainxgur.supabase.co`).

1. **Run the schema.** In Supabase, open SQL Editor, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click Run.
   It is safe to run again after changes (it also adds new service categories to villages that already exist).
   Everything lives in its own schema, `village_gate`, never in `public`.
2. **Expose the schema.** Go to Project Settings → **Data API** → **Exposed schemas** and add `village_gate`, then save.
3. **Add the redirect URLs.** Go to Authentication → **URL Configuration** → Redirect URLs and add:
   - `https://geno700.github.io/Village-Gate/`
   - `http://localhost:8000/` (for local testing)

   Sign-up confirmation and password-reset emails come back to `location.origin + location.pathname`.
4. **Add the publishable key.** Go to Project Settings → API Keys and copy the **publishable** key (`sb_publishable_…`).
   Paste it into `config.js` as `SUPABASE_KEY`.
   Never use the `service_role` / secret key in this app. It is not needed anywhere.
5. **Become platform owner (optional).** Find your user id under Authentication → Users and run:
   ```sql
   insert into village_gate.platform_admins(user_id) values ('YOUR-USER-ID');
   ```
   Then `#/owner` shows every village, weekly activity, and lets you disable or re-enable a village.

## Setting up a village

The mayor taps **I am the mayor → Set up my village**:
1. Search the village by name, or tap its centre on the map, and choose its size (small, medium, large).
2. **Build my village in 3D.** The browser reads that area from OpenStreetMap and shows the 3D village. Landmarks
   found on the map (mosques, schools, health units…) can be added to the village guide in one tap.
3. Enter your name, phone and home, and the village is created with its invite code.

The 3D map is stored with the village, so residents never contact the map services. Rebuild it any time from
Mayor's office → Village. Most Egyptian villages on OpenStreetMap have their streets and canals but not each house,
so houses are placed along the real streets inside the built-up area. Adding buildings and landmarks to
[OpenStreetMap](https://www.openstreetmap.org) improves the model the next time you rebuild.

**Ready-made maps.** Some villages ship with a detailed map in `data/maps/` (real building outlines from
[Overture Maps](https://overturemaps.org), free open data that includes Google's and Microsoft's building
outlines, plus OpenStreetMap roads). When the mayor picks a point near one of them, setup uses it instead of
reading OpenStreetMap live. Al-Safa (قرية الصفا, 30.958° N, 31.574° E) is the first one.

**Landmark models.** Mosques, churches, schools, kindergartens, playgrounds and youth centres, hospitals and
health units, clinics, pharmacies, government offices, police, fire station, post office, bank, market, bakery,
fuel station, transport stop, veterinary unit, agricultural cooperative, gardens and cemeteries each have their
own small 3D building, drawn larger than life so people recognise them.

Only the village search text and the chosen area are sent to OpenStreetMap's public services
(nominatim.openstreetmap.org and the Overpass API), never anyone's name, phone or home.

## Turn on GitHub Pages

1. Push this folder to the `Village-Gate` repository. Keep `.nojekyll`.
2. Go to Settings → Pages → Build and deployment → **Deploy from a branch** → `main` / root.
3. The app appears at `https://geno700.github.io/Village-Gate/`.
   Every path in the app is relative (`./`), so it works under that sub-path.
4. When you release changes, bump `VERSION` in `sw.js` so installed apps show "New version, reload".

## How it fits together

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | The page shell and all the styling (mobile first, right-to-left aware, light and dark). |
| `js/app.js` | Router (`#/…`), header with the village switcher, bottom navigation, service worker. |
| `js/data.js` | Picks `data-demo.js` or `data-supabase.js`. Both expose the same functions; views never call Supabase. |
| `js/views-*.js` | One file per area: auth, home, map & directory, requests, business & demand, admin, owner, settings. |
| `js/scene3d.js` | The animated 3D village (three.js from a pinned CDN, loaded only where it shows). |
| `js/osm.js` | OpenStreetMap: village search, reading roads/canals/fields/landmarks, placing houses along real streets. |
| `js/views-setup.js` | New-village wizard: find it on the map, build it in 3D, your details. |
| `js/shared.js` | Sectors, the 109 services with their search words, place types, sizes (kept in sync with `schema.sql`). |
| `data/demo-village.json` | Real map data for the demo village (© OpenStreetMap contributors, ODbL). |
| `js/map.js` | Leaflet + OpenStreetMap helpers and the pin picker. |
| `js/i18n.js` | Every label in Arabic and English. |
| `supabase/schema.sql` | Tables, constraints, Row Level Security, RPC functions and activity log. |

## Who can do what

| | Owner (mayor) | Admin | Member (resident) | Viewer | Not a member |
|---|---|---|---|---|---|
| See map, directory, places | ✅ | ✅ | ✅ | ✅ | ❌ |
| Post requests, register a business | ✅ | ✅ | ✅ | ❌ | ❌ |
| See demand (verified business owners only) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve or reject people, verify businesses, edit places | ✅ | ✅ | ❌ | ❌ | ❌ |
| Make or remove admins | ✅ | ❌ | ❌ | ❌ | ❌ |
| Transfer ownership, delete the village | ✅ | ❌ | ❌ | ❌ | ❌ |

**Privacy:** a business never reads open requests directly. It gets only ~100 m grid cells with counts.
It sees the exact pin and phone number only for requests it has accepted.
Home locations are visible only to the person themselves and the village admins.

## License

MIT, see [LICENSE](LICENSE).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL) and
[Overture Maps Foundation](https://overturemaps.org) (buildings: ODbL; places: [CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/),
read live from Overture's public tiles). Place names and locations also come from [Wikidata](https://www.wikidata.org) (CC0).

When a village is set up, the browser asks these free sources for places around it (no key, no account):
OpenStreetMap through Overpass, Overture's place tiles (`js/overture.js`, a small built-in reader) and Wikidata.
The mayor ticks what to keep. Google Maps is not used: its terms do not allow copying its places into another app.
