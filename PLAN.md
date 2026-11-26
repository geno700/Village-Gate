# Village Gate / بوابة القرية — Plan

**One line:** the village's own super-app. The mayor (العمدة) verifies every resident and
every service provider. Residents post what they need, like a gas cylinder, a tray of eggs or
a plumber. Providers see a demand map, deliver to exactly the houses that asked, and can stop
driving around with loudspeakers.

- Repo / URL: `Village-Gate` → https://algebratronics.com/Village-Gate/ (GitHub Pages paths are case-sensitive)
- Group type: **village** (قرية). Each village is one group with one owner (the mayor).
- Supabase schema: `village_gate`
- Languages: Arabic (default, RTL) + English
- Currency: EGP (prices in phase 2; payment is always cash on delivery, never in-app)

---

## 1. Roles

| Role | Arabic | Who | Can do |
|---|---|---|---|
| **owner** | العمدة | The mayor. One per village. | Everything an admin can do, plus delete the village, transfer ownership, and promote or demote admins. |
| **admin** | مساعد العمدة | Mayor's staff and verifiers. | Approve, reject or remove members. Verify or suspend businesses. Manage places and categories, the join code, the village name and map center. See the activity log. Export data. Cannot touch the owner or other admins. |
| **member** | ساكن | A verified resident. | See the map and directory. Post requests. Register a business, which needs verification. |
| **viewer** | زائر | A guest or observer, approved but read-only. | See the map and directory. Cannot write anything. |

**Provider is not a role.** It is a **verified business** owned by a member. One person can be
a resident and run a shop, or run several businesses. A business only sees demand after an
admin verifies it, and a suspended business loses that access immediately.

**Platform owner** (you, at `#/owner`): user ids listed in `platform_admins`.

---

## 2. Data model (schema `village_gate`)

Every group-scoped table has `id uuid pk default gen_random_uuid()`, `group_id uuid not null → groups`,
`created_at timestamptz not null default now()` and `created_by uuid not null default auth.uid()`.

| Table | Key columns | Notes |
|---|---|---|
| `platform_admins` | `user_id pk → auth.users` | Insert your own id by hand in the SQL editor. |
| `profiles` | `id pk = auth.uid()`, `full_name`, `phone`, `lang` | Per user, not per group, so it is the one table without `group_id`. A user reads their own row. Admins read the profiles of members of their village through a function. |
| `groups` | `name`, `join_code char(6) unique`, `center_lat`, `center_lng`, `zoom`, `radius_m` (300–3000), `status` (`active` / `disabled`) | `id` doubles as the group id. A disabled village is invisible to everyone except platform admins. |
| `village_maps` | `group_id` (unique), `data` (jsonb, < 4 MB), `updated_at` | The 3D village map read from OpenStreetMap. Members read; admins write only through `save_village_map()`. |
| `memberships` | `user_id`, `role`, `status` (`pending` / `approved` / `rejected` / `removed`), `display_name`, `phone`, `home_lat`, `home_lng`, `home_note` (e.g. "the street behind the big mosque"), `verified_at`, `verified_by` | `unique(group_id, user_id)`, and a partial unique index allowing only one owner per village. Phone must match an Egyptian mobile pattern. |
| `categories` | `key`, `name_en`, `name_ar`, `icon`, `kind` (`service` / `place`), `sector`, `sort`, `active` | Seeded with defaults when a village is created (§6). Admins can add and rename categories. |
| `places` | `category_id` (kind = place), `name`, `phone`, `lat`, `lng`, `note`, `osm_ref` | Public landmarks: mosques, churches, hospital and clinics, schools, pharmacies, the post office, government office, ATM, youth center. Admins edit; members read. |
| `businesses` | `owner_user_id`, `name`, `description`, `phone`, `whatsapp`, `lat`, `lng` (nullable for mobile vendors), `is_mobile` (has a cart or vehicle, no shop), `hours`, `status` (`pending` / `verified` / `suspended` / `rejected`), `verified_at`, `verified_by` | Registered by a member, verified by an admin. |
| `business_categories` | `business_id`, `category_id` | A grocery can also sell gas cylinders. `unique(business_id, category_id)`. |
| `requests` | `category_id`, `details`, `quantity` (1–99), `lat`, `lng`, `location_note`, `needed_by`, `expires_at` (default now + 3 days), `status` (`open` / `accepted` / `delivered` / `cancelled` / `expired`), `business_id` (set when accepted), `accepted_at`, `delivered_at` | Location defaults to the member's home. |
| `activity_log` | `actor`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb` | Written by triggers and RPCs. Admins can read it; nobody can write to it directly. |

Every rule is enforced in the database: not-null fields, check constraints on status, role,
coordinates and phone format, foreign keys with `on delete cascade` from `groups`, and coordinates
restricted to Egypt's bounding box.

### Privacy rules for locations (important with 10,000 homes on a map)
- A member's **exact home location and phone** are visible only to themselves and to village admins.
- An **open request** is never readable directly by providers. A verified business calls
  `open_demand()` and gets only **grid cells of about 100 m** with a count and the request type, so it can see
  "6 gas cylinders around here". It never sees who placed them.
- When a business **accepts** a request (one at a time, or every request in a cell), it gets
  that request's exact pin, the location note and the phone number. This works like an Uber driver
  who learns your address only after taking the trip.
- Admins see all requests, for moderation and statistics.

---

## 3. Access rules (RLS, checked on paper before phase 1 is done)

Helper functions, all `security definer` with `set search_path = village_gate, pg_temp`:
`is_member(g)` (approved and the village is active), `has_role(g, roles[])`, `my_business_ids(g)`
(verified only), and `is_platform_admin()`.

- **Non-member:** every select policy requires `is_member`, so they see nothing. The only
  exceptions are joining by code and seeing their own pending membership.
- **Viewer:** select only. Every insert or update policy requires `has_role(g, ['owner','admin','member'])`
  or an admin role.
- **Removed or rejected member:** `is_member` becomes false at once and every policy fails.
  Any business they own stops passing `my_business_ids`.
- **Writes that matter** go only through RPCs that check permissions themselves: create, join,
  approve, set role, remove, verify a business, accept a request, deliver, delete the village,
  and transfer ownership. These tables have no direct update policy on `role`, `status` or `verified_*`.

---

## 4. Screens

All routes are hash routes (`#/...`), work at phone width first, and include an Arabic/English label.

| Route | Who | What |
|---|---|---|
| `#/welcome` | Signed out | **Animated 3D village map** in the background (see §5), app name, and sign-up / log-in buttons. |
| `#/login`, `#/signup`, `#/reset` | Signed out | Email and password, forgot password, set a new password. |
| `#/start` | Signed in with no village | Create a village (name and center pin on a map) or join with a code or invite link. |
| `#/join/:code` | Anyone | Join form: name, phone, home pin on the map and an address note. Then shows "waiting for the mayor to verify you". |
| `#/` Home | Member | 3D map header with the village's real places and businesses. Grid of **"I need…"** category tiles. My open requests. Village shortcuts. |
| `#/map` | Member, viewer | Flat interactive map (Leaflet + OpenStreetMap) with places and verified businesses, a category filter, and tap-to-call or WhatsApp. |
| `#/directory` | Member, viewer | List of businesses and places with search, category filter, and sort by name or distance. |
| `#/business/:id` | Member, viewer | Business card: categories, hours, call, WhatsApp, location. |
| `#/request/new` | Member | "What do you need?": search or speak, most-requested tiles, then 16 sectors. Then details and quantity, a "needed by" time, and the home location or a pin. |
| `#/setup` | Signed in | New village: find it on the map, choose its size, preview it in 3D, add the landmarks found, then your details. |
| `#/requests` | Member | My requests with status. Cancel while open; confirm when delivered. |
| `#/my-business` | Member | Register a business, see its verification status, edit it. |
| `#/demand` | Verified business | **Demand heatmap** of open requests in my categories (last 24 h, 48 h or 7 days). Tap a cell to accept one request or all of them. **My jobs** list sorted into a nearest-next route from my position, with call and mark-delivered. |
| `#/admin` | Owner, admin | Tabs: **Members** (pending first, home pin shown on a map for checking), **Businesses** (verification queue), **Places**, **Categories**, **Invite** (code, link, regenerate), **Village** (rename, map center, transfer ownership, delete), **Activity log**, **Export** (CSV and JSON). |
| `#/owner` | Platform admin | Totals for villages, users and activity per week. Search villages, disable or re-enable them, read the activity log. |
| `#/settings` | Everyone | Language, profile (name, phone, home pin), village switcher, backup and restore, log out. |

Header: village switcher, a **Demo** badge in demo mode, and a role switcher in demo mode
(act as mayor, resident or gas vendor) so you can test every view from one browser.

---

## 5. The 3D village map (built from the real map)

An **original** animated scene, inspired by "clockwork map" title sequences but copying none of them.
- **Setting up a village starts on the map** (`#/setup`): the mayor searches the village by name (OpenStreetMap
  Nominatim, Egypt only) or taps its centre, and picks its size (small 600 m, medium 1 km, large 1.6 km).
- **Build:** the browser reads the real roads, canals, drains, fields, built-up areas, building outlines and
  landmarks around that point from OpenStreetMap (Overpass API, three mirrors with retries) and turns them into a
  small "village map" (format in `js/osm.js`). The mayor sees the 3D preview before creating the village.
- **Stored once:** the map is saved in `village_maps` (one row per village, through `save_village_map()`), and
  residents load it from there, so they never call the map services. Phones keep a copy and re-download only when it changes.
- **Houses:** OpenStreetMap has the streets and canals of most Egyptian villages but few building outlines. Real
  buildings are used where they exist; elsewhere houses are placed along the real streets inside the real built-up
  area (residential areas, or where village lanes are dense). Same result on every phone.
- **Landmarks:** mosques, churches, schools, health units, pharmacies, post offices, the agricultural cooperative and
  others found on the map can be added to the village guide in one tap (`import_places()`, never twice: each keeps its OSM id).
- **Ready-made maps** (`data/maps/`, listed in `index.json`): prepared offline from OpenStreetMap roads plus
  Overture Maps building outlines and places (free open data that includes Google and Microsoft buildings, so the
  real houses appear). Setup uses one when the chosen centre is near it. Al-Safa (قرية الصفا) is the first.
- **Landmark models** (`js/models3d.js`): mosque with dome and minaret, church, school with flag, kindergarten,
  football pitch with goals, hospital and health unit with a red cross, clinic, pharmacy, government office with
  columns, police, fire station, post office, bank, market stalls, bakery, fuel station, transport stop, veterinary
  unit, cooperative warehouse with silo, garden, cemetery. Drawn 1.8× life size; houses on their spot are cleared.
- **Rebuild** any time from Mayor's office → Village (after moving the centre, or when new streets are mapped).
- Built with **three.js**, loaded from a pinned CDN URL only where the scene shows. One painted ground texture
  (fields, land use, water, roads), one merged mesh for all houses (they rise from the centre outwards), palm trees
  along the canals, and every place and business rising as a marker with its icon at its real spot.
- Light and dark mode (sunset or night with lit windows). Pauses when hidden. Reduced motion shows one still frame.
- Welcome screen and demo mode use a bundled real map (`data/demo-village.json`, roads and fields near Damsheet,
  Gharbia) with the fictional sample village "Kafr El-Nakhla" on it. A village without a map gets a drawn one.

---

## 6. Default categories (seeded per village; admins can edit)

All names are in Modern Standard Arabic and English. The full list lives in `js/shared.js` (`SECTORS`, `SERVICES`,
`PLACES`) and is copied into `seed_categories()` in `schema.sql`. Each service has hidden search words (including
everyday spellings like "انبوبة" or "سباك") so residents find it by typing or speaking.

**109 services in 16 sectors:**
home essentials (gas cylinders, drinking water, cleaning, laundry, tank cleaning, pest control, furniture) ·
food (groceries, bread, vegetables, meat, poultry, fish, dairy, sweets, restaurants, home-cooked food) ·
health (pharmacy delivery, doctor visit, nursing, home lab tests, physiotherapy, dentist, eye care, patient transport, elderly care, medical equipment) ·
repairs and trades (plumbing, electrician, carpentry, painting, appliances, AC, welding, aluminium, locks) ·
transport and delivery (errands, tuk-tuk, taxi, microbus, goods transport, house moving, parcels) ·
farming and livestock (tractor, irrigation, seeds and fertiliser, spraying, harvest, farm workers, feed, vet, livestock) ·
shops (clothes, household goods, books, electrical appliances, hardware, cosmetics, gifts) ·
vehicles (mechanic, tyres, car electrics, motorbike and tuk-tuk repair, bicycles, car wash, fuel) ·
phones, computers and internet (phones, phone repair, computers, internet, satellite dishes, cameras, printing, online services and bills, websites) ·
building (masonry, tiling, plastering, materials, contractor, engineer and surveyor) ·
industry and workshops (machining, motor rewinding, generators, well drilling, equipment rental, custom manufacturing, scrap) ·
education (private lessons, Quran, childcare, courses, languages) ·
personal care (barber, women's salon, tailor, shoe repair) ·
events (catering, tents and chairs, sound, photography, weddings) ·
professional (lawyer, accountant, real estate, paperwork, translation, insurance) · other.

**22 place types:** mosque, church, hospital or health unit, clinic, pharmacy, school, kindergarten, government office,
post office, ATM or bank, police, fire station, youth centre, market, bakery, fuel station, transport stop,
veterinary unit, agricultural cooperative, garden, cemetery, shop or business.

**"I need…"** shows 8 big tiles first (what the village's verified businesses offer, everyday needs first), a search
box with a microphone (speech recognition where the phone supports it), then the 16 sectors as big tiles.

## 7. Phases

### Phase 1: the core loop (smallest useful app) — built, waiting for review
Accounts, villages, joining and **mayor verification**, places and businesses on the map and in the directory, **requests → demand heatmap → accept → deliver**, the admin page, the owner page, the 3D intro map, demo mode, Arabic and English, PWA, CSV and JSON backup, and `schema.sql` with RLS.

### Phase 2: shops and prices
- A **shared product list** per village, so prices are comparable. Admins curate it and businesses can suggest items.
  Example: "Egg tray 30", "Gas cylinder", "Rice 1 kg".
- Businesses set **price, unit and in stock** on products. A resident who wants eggs sees every
  grocery that sells them, sorted by **cheapest, nearest, or best rated**.
- Order a specific product from a chosen shop.
- **Ratings** after delivery (1–5 stars and a short note).
- **"Rounds" (جولة)**: a mobile vendor announces "gas cylinders, Al-Bahr street, today 4–6 pm".
  Residents on that route see it and can tap "I need one". This replaces the loudspeaker.

### Phase 3: community and reach
- **Push notifications** (Web Push through a Supabase Edge Function) for new nearby demand, an accepted request, or a round coming down your street.
- **Recurring requests**, for example a gas cylinder every 3 weeks.
- **Mayor's announcements board**: water or power cuts, vaccination days, funeral announcements (نعي), and lost and found.
- **Emergency page**: ambulance, police, fire, the village doctor's number. Works offline.
- WhatsApp share of a business or round, a QR "verified by the mayor" sticker for shops, and PDF monthly reports for the mayor.
- Optional phone OTP (it costs money per SMS, see the decisions below).

---

## 8. Decisions I made. Change any of them before I start.

1. **Login is email and password** (the stack's rule). Phone numbers are stored and checked by the
   mayor in person, not by SMS, because Supabase SMS needs a paid provider like Twilio.
2. **No national ID numbers** are collected. Verification is the mayor knowing the person, plus the home pin.
3. **Maps:** Leaflet 1.9 + OpenStreetMap tiles from a CDN, with attribution. Village coverage on OSM can be thin,
   but the pins are ours. three.js is also loaded from a CDN. Both are pinned versions and cached by the service worker.
4. **The heatmap is a grid** of about 100 m cells, drawn by us rather than with a plugin. This is also what protects privacy.
5. **Restore:** in demo mode it replaces the local data. In Supabase mode, admins can restore **places
   and categories only**, because re-creating members, businesses or requests from a file would bypass verification.
6. **Demo village:** a fictional Delta village, "Kafr El-Nakhla" (كفر النخلة), with about 40 homes, 15 businesses,
   12 places and about 60 requests spread over the last 3 days.
7. Requests **expire after 3 days** unless delivered, to keep the heatmap fresh.
