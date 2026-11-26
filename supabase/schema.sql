-- =====================================================================================
-- Village Gate / بوابة القرية — Supabase schema
-- Everything lives in schema "village_gate" (never public). Safe to run again:
-- create ... if not exists, create or replace, drop policy/trigger if exists.
--
-- After running:
--   1. Settings > Data API > Exposed schemas: add  village_gate
--   2. Insert yourself as platform owner (optional):
--        insert into village_gate.platform_admins(user_id) values ('<your auth user id>');
-- =====================================================================================

create schema if not exists village_gate;
grant usage on schema village_gate to authenticated;
revoke all on schema village_gate from anon;

-- -------------------------------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------------------------------
create table if not exists village_gate.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists village_gate.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '' check (char_length(full_name) <= 80),
  phone      text check (phone is null or phone ~ '^01[0125][0-9]{8}$'),
  lang       text not null default 'ar' check (lang in ('ar', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists village_gate.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  join_code  text not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
  center_lat double precision not null check (center_lat between 22 and 32),
  center_lng double precision not null check (center_lng between 24 and 37),
  zoom       int not null default 16 check (zoom between 10 and 19),
  status     text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

-- village size: metres around the centre that the 3D map covers (added after the first release)
alter table village_gate.groups add column if not exists radius_m int not null default 1000 check (radius_m between 300 and 3000);

create table if not exists village_gate.memberships (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references village_gate.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  phone        text not null check (phone ~ '^01[0125][0-9]{8}$'),
  home_lat     double precision check (home_lat between 22 and 32),
  home_lng     double precision check (home_lng between 24 and 37),
  home_note    text not null default '' check (char_length(home_note) <= 200),
  verified_at  timestamptz,
  verified_by  uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  unique (group_id, user_id),
  check ((home_lat is null) = (home_lng is null)),
  check (role <> 'owner' or status = 'approved')
);
create unique index if not exists memberships_one_owner on village_gate.memberships(group_id) where role = 'owner';
create index if not exists memberships_user on village_gate.memberships(user_id);

create table if not exists village_gate.categories (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references village_gate.groups(id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9_]{2,30}$'),
  kind       text not null check (kind in ('service', 'place')),
  icon       text not null default '•' check (char_length(icon) between 1 and 8),
  name_en    text not null check (char_length(btrim(name_en)) between 1 and 40),
  name_ar    text not null check (char_length(btrim(name_ar)) between 1 and 40),
  sort       int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  unique (group_id, key),
  unique (group_id, id)
);

-- sector groups services for the "I need…" picker (home, food, medical, trades, …); places use 'places'
alter table village_gate.categories add column if not exists sector text not null default 'other' check (sector ~ '^[a-z_]{2,20}$');

create table if not exists village_gate.places (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references village_gate.groups(id) on delete cascade,
  category_id uuid not null,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  phone       text check (phone is null or phone ~ '^0[0-9]{8,10}$'),
  lat         double precision not null check (lat between 22 and 32),
  lng         double precision not null check (lng between 24 and 37),
  note        text not null default '' check (char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid(),
  foreign key (group_id, category_id) references village_gate.categories(group_id, id)
);
create index if not exists places_group on village_gate.places(group_id);
-- landmarks imported from OpenStreetMap remember their id (n123, w456, r789) so they are never added twice
alter table village_gate.places add column if not exists osm_ref text check (osm_ref ~ '^([nwr][0-9]{1,12}|o[0-9a-f]{8,32})$');
create unique index if not exists places_osm_ref on village_gate.places(group_id, osm_ref) where osm_ref is not null;
-- residents suggest places; they stay 'pending' (seen only by admins and the person who suggested them) until approved
alter table village_gate.places add column if not exists status text not null default 'approved' check (status in ('pending', 'approved'));
create index if not exists places_pending on village_gate.places(group_id) where status = 'pending';

-- the 3D village map: roads, canals, fields and buildings read once from OpenStreetMap by an admin
-- (format in js/osm.js). Residents read it from here, so they never call the map services themselves.
create table if not exists village_gate.village_maps (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null unique references village_gate.groups(id) on delete cascade,
  data       jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 4000000),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create table if not exists village_gate.businesses (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references village_gate.groups(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  description   text not null default '' check (char_length(description) <= 500),
  phone         text not null check (phone ~ '^01[0125][0-9]{8}$'),
  whatsapp      text check (whatsapp is null or whatsapp ~ '^01[0125][0-9]{8}$'),
  lat           double precision check (lat between 22 and 32),
  lng           double precision check (lng between 24 and 37),
  is_mobile     boolean not null default false,
  hours         text not null default '' check (char_length(hours) <= 100),
  status        text not null default 'pending' check (status in ('pending', 'verified', 'suspended', 'rejected')),
  verified_at   timestamptz,
  verified_by   uuid,
  created_at    timestamptz not null default now(),
  created_by    uuid not null default auth.uid(),
  unique (group_id, id),
  check ((lat is null) = (lng is null)),
  check (is_mobile or lat is not null)
);
create index if not exists businesses_group on village_gate.businesses(group_id, status);

create table if not exists village_gate.business_categories (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null,
  business_id uuid not null,
  category_id uuid not null,
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid(),
  unique (business_id, category_id),
  foreign key (group_id, business_id) references village_gate.businesses(group_id, id) on delete cascade,
  foreign key (group_id, category_id) references village_gate.categories(group_id, id)
);

create table if not exists village_gate.requests (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references village_gate.groups(id) on delete cascade,
  category_id   uuid not null,
  details       text not null default '' check (char_length(details) <= 300),
  quantity      int not null default 1 check (quantity between 1 and 99),
  lat           double precision not null check (lat between 22 and 32),
  lng           double precision not null check (lng between 24 and 37),
  location_note text not null default '' check (char_length(location_note) <= 200),
  needed_by     timestamptz,
  expires_at    timestamptz not null default (now() + interval '3 days'),
  status        text not null default 'open' check (status in ('open', 'accepted', 'delivered', 'cancelled', 'expired')),
  business_id   uuid,
  accepted_at   timestamptz,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid not null default auth.uid(),
  foreign key (group_id, category_id) references village_gate.categories(group_id, id),
  foreign key (group_id, business_id) references village_gate.businesses(group_id, id) on delete set null (business_id),
  check (status <> 'accepted' or business_id is not null)
);
create index if not exists requests_open on village_gate.requests(group_id, status, category_id, created_at);
create index if not exists requests_creator on village_gate.requests(created_by);
create index if not exists requests_business on village_gate.requests(business_id) where business_id is not null;

create table if not exists village_gate.activity_log (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references village_gate.groups(id) on delete cascade,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists activity_group on village_gate.activity_log(group_id, created_at desc);

-- -------------------------------------------------------------------------------------
-- Helper functions (security definer, fixed search_path). They bypass RLS so policies
-- can call them without recursion.
-- -------------------------------------------------------------------------------------
create or replace function village_gate.is_member(g uuid) returns boolean
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select exists (
    select 1 from memberships m join groups gr on gr.id = m.group_id
    where m.group_id = g and m.user_id = auth.uid() and m.status = 'approved' and gr.status = 'active');
$$;

create or replace function village_gate.has_role(g uuid, roles text[]) returns boolean
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select exists (
    select 1 from memberships m join groups gr on gr.id = m.group_id
    where m.group_id = g and m.user_id = auth.uid() and m.status = 'approved' and gr.status = 'active'
      and m.role = any (roles));
$$;

create or replace function village_gate.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select village_gate.has_role(g, array['owner', 'admin']);
$$;

create or replace function village_gate.can_write(g uuid) returns boolean
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select village_gate.has_role(g, array['owner', 'admin', 'member']);
$$;

create or replace function village_gate.is_platform_admin() returns boolean
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- verified businesses of the caller in a village (only while the caller may still write there)
create or replace function village_gate.my_business_ids(g uuid) returns setof uuid
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select b.id from businesses b
  where b.group_id = g and b.owner_user_id = auth.uid() and b.status = 'verified' and village_gate.can_write(g);
$$;

-- internal: write one activity row (not callable from the browser)
create or replace function village_gate.log_activity(g uuid, p_action text, p_entity text, p_id uuid, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = village_gate, pg_temp as $$
  insert into activity_log(group_id, actor, action, entity, entity_id, before, after)
  values (g, auth.uid(), p_action, p_entity, p_id, p_before, p_after);
$$;

-- generic trigger: log inserts/updates/deletes of the tables that matter
create or replace function village_gate.tg_log() returns trigger
language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare
  g uuid;
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  g := coalesce(a ->> 'group_id', b ->> 'group_id')::uuid;
  if tg_table_name = 'groups' then g := coalesce(a ->> 'id', b ->> 'id')::uuid; end if;
  -- the village itself is being deleted (cascade): nothing to log into
  if not exists (select 1 from groups where id = g) then return null; end if;
  if tg_op = 'UPDATE' and b = a then return null; end if;
  -- the RPCs log their own semantic action (approve, accept, ...); skip the duplicate generic update
  if tg_op = 'UPDATE' and current_setting('village_gate.skip_log', true) = 'on' then return null; end if;
  if tg_op = 'INSERT' and current_setting('village_gate.skip_log_insert', true) = 'on' then return null; end if;
  insert into activity_log(group_id, actor, action, entity, entity_id, before, after)
  values (g, auth.uid(), lower(tg_op), tg_table_name, coalesce(a ->> 'id', b ->> 'id')::uuid, b, a);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['groups', 'memberships', 'categories', 'places', 'businesses', 'requests'] loop
    execute format('drop trigger if exists log_changes on village_gate.%I', t);
    execute format('create trigger log_changes after insert or update or delete on village_gate.%I for each row execute function village_gate.tg_log()', t);
  end loop;
end $$;

-- category kind checks (places need a "place" category; businesses and requests a "service" one)
create or replace function village_gate.tg_check_kind() returns trigger
language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare want text := case when tg_table_name = 'places' then 'place' else 'service' end;
begin
  if not exists (select 1 from categories c where c.id = new.category_id and c.group_id = new.group_id and c.kind = want) then
    raise exception 'invalid_input';
  end if;
  return new;
end $$;
drop trigger if exists check_kind on village_gate.places;
create trigger check_kind before insert or update of category_id on village_gate.places for each row execute function village_gate.tg_check_kind();
drop trigger if exists check_kind on village_gate.business_categories;
create trigger check_kind before insert or update of category_id on village_gate.business_categories for each row execute function village_gate.tg_check_kind();
drop trigger if exists check_kind on village_gate.requests;
create trigger check_kind before insert or update of category_id on village_gate.requests for each row execute function village_gate.tg_check_kind();

-- -------------------------------------------------------------------------------------
-- Row Level Security
-- -------------------------------------------------------------------------------------
alter table village_gate.platform_admins     enable row level security;
alter table village_gate.profiles            enable row level security;
alter table village_gate.groups              enable row level security;
alter table village_gate.memberships         enable row level security;
alter table village_gate.categories          enable row level security;
alter table village_gate.village_maps        enable row level security;
alter table village_gate.places              enable row level security;
alter table village_gate.businesses          enable row level security;
alter table village_gate.business_categories enable row level security;
alter table village_gate.requests            enable row level security;
alter table village_gate.activity_log        enable row level security;

-- platform_admins: you can only see whether you are one
drop policy if exists pa_select on village_gate.platform_admins;
create policy pa_select on village_gate.platform_admins for select to authenticated using (user_id = auth.uid());

-- profiles: your own row only
drop policy if exists profiles_select on village_gate.profiles;
create policy profiles_select on village_gate.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert on village_gate.profiles;
create policy profiles_insert on village_gate.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on village_gate.profiles;
create policy profiles_update on village_gate.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- groups: members see their village; a pending applicant sees the name of the village they asked to join.
-- All writes go through RPCs.
drop policy if exists groups_select on village_gate.groups;
create policy groups_select on village_gate.groups for select to authenticated using (
  village_gate.is_member(id)
  or exists (select 1 from village_gate.memberships m where m.group_id = groups.id and m.user_id = auth.uid() and m.status = 'pending'));

-- memberships: your own rows, and admins see every row of their village. Writes only through RPCs.
drop policy if exists memberships_select on village_gate.memberships;
create policy memberships_select on village_gate.memberships for select to authenticated using (
  user_id = auth.uid() or village_gate.is_admin(group_id));

-- categories & places: members read, admins write
drop policy if exists categories_select on village_gate.categories;
create policy categories_select on village_gate.categories for select to authenticated using (village_gate.is_member(group_id));
drop policy if exists categories_insert on village_gate.categories;
create policy categories_insert on village_gate.categories for insert to authenticated with check (village_gate.is_admin(group_id));
drop policy if exists categories_update on village_gate.categories;
create policy categories_update on village_gate.categories for update to authenticated using (village_gate.is_admin(group_id)) with check (village_gate.is_admin(group_id));

-- village map: members read; admins write only through save_village_map()
drop policy if exists village_maps_select on village_gate.village_maps;
create policy village_maps_select on village_gate.village_maps for select to authenticated using (village_gate.is_member(group_id));

drop policy if exists places_select on village_gate.places;
create policy places_select on village_gate.places for select to authenticated using (
  village_gate.is_member(group_id) and (status = 'approved' or created_by = auth.uid() or village_gate.is_admin(group_id)));
drop policy if exists places_insert on village_gate.places;
create policy places_insert on village_gate.places for insert to authenticated with check (village_gate.is_admin(group_id));
drop policy if exists places_update on village_gate.places;
create policy places_update on village_gate.places for update to authenticated using (village_gate.is_admin(group_id)) with check (village_gate.is_admin(group_id));
drop policy if exists places_delete on village_gate.places;
create policy places_delete on village_gate.places for delete to authenticated using (village_gate.is_admin(group_id));

-- businesses: members see verified ones; owners see their own; admins see all. Writes only through RPCs.
drop policy if exists businesses_select on village_gate.businesses;
create policy businesses_select on village_gate.businesses for select to authenticated using (
  village_gate.is_member(group_id)
  and (status = 'verified' or owner_user_id = auth.uid() or village_gate.is_admin(group_id)));

drop policy if exists bc_select on village_gate.business_categories;
create policy bc_select on village_gate.business_categories for select to authenticated using (village_gate.is_member(group_id));

-- requests: the requester, the village admins, and the business that accepted it.
-- Open requests are NEVER readable by other businesses; they only get ~100 m cells via open_demand().
drop policy if exists requests_select on village_gate.requests;
create policy requests_select on village_gate.requests for select to authenticated using (
  (created_by = auth.uid() and village_gate.is_member(group_id))
  or village_gate.is_admin(group_id)
  or (business_id is not null and business_id in (select village_gate.my_business_ids(group_id))));
drop policy if exists requests_insert on village_gate.requests;
create policy requests_insert on village_gate.requests for insert to authenticated with check (
  village_gate.can_write(group_id) and created_by = auth.uid());

-- activity log: admins read; nobody writes directly
drop policy if exists activity_select on village_gate.activity_log;
create policy activity_select on village_gate.activity_log for select to authenticated using (village_gate.is_admin(group_id));

-- -------------------------------------------------------------------------------------
-- Table privileges (RLS still applies on top). Column lists stop clients from setting
-- status, roles, verification or ownership fields directly.
-- -------------------------------------------------------------------------------------
revoke all on all tables in schema village_gate from anon, authenticated;
grant select on all tables in schema village_gate to authenticated;
grant insert (id, full_name, phone, lang, updated_at), update (id, full_name, phone, lang, updated_at) on village_gate.profiles to authenticated;
grant insert (group_id, key, kind, sector, icon, name_en, name_ar, sort, active), update (sector, icon, name_en, name_ar, sort, active) on village_gate.categories to authenticated;
grant insert (group_id, category_id, name, phone, lat, lng, note), update (category_id, name, phone, lat, lng, note), delete on village_gate.places to authenticated;
grant insert (group_id, category_id, details, quantity, lat, lng, location_note, needed_by) on village_gate.requests to authenticated;

-- -------------------------------------------------------------------------------------
-- RPC functions (each checks permissions itself)
-- -------------------------------------------------------------------------------------
create or replace function village_gate.new_join_code() returns text
language plpgsql volatile security definer set search_path = village_gate, pg_temp as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from groups where join_code = c);
  end loop;
  return c;
end $$;

create or replace function village_gate.seed_categories(g uuid) returns void
language sql security definer set search_path = village_gate, pg_temp as $$
  -- keep in sync with DEFAULT_CATEGORIES in js/shared.js
  insert into categories(group_id, key, kind, sector, icon, name_en, name_ar, sort)
  select g, v.key, v.kind, v.sector, v.icon, v.en, v.ar, v.ord * 10
  from (values
    (1, 'gas', 'service', 'home', '🔥', 'Gas cylinders', 'أسطوانات الغاز'),
    (2, 'water', 'service', 'home', '💧', 'Drinking water', 'مياه الشرب'),
    (3, 'cleaning', 'service', 'home', '🧽', 'Home cleaning', 'تنظيف المنازل'),
    (4, 'laundry', 'service', 'home', '👕', 'Laundry & ironing', 'الغسيل والكي'),
    (5, 'tank_cleaning', 'service', 'home', '🛢️', 'Water tank cleaning', 'تنظيف خزانات المياه'),
    (6, 'pest_control', 'service', 'home', '🪳', 'Pest control', 'مكافحة الحشرات'),
    (7, 'furniture', 'service', 'home', '🛋️', 'Furniture & upholstery', 'الأثاث والتنجيد'),
    (8, 'grocery', 'service', 'food', '🛒', 'Groceries', 'البقالة'),
    (9, 'bakery', 'service', 'food', '🍞', 'Bread & bakery', 'الخبز والمخبوزات'),
    (10, 'vegetables', 'service', 'food', '🥕', 'Vegetables & fruit', 'الخضروات والفاكهة'),
    (11, 'meat', 'service', 'food', '🥩', 'Meat', 'اللحوم'),
    (12, 'poultry', 'service', 'food', '🍗', 'Poultry & eggs', 'الدواجن والبيض'),
    (13, 'fish', 'service', 'food', '🐟', 'Fish', 'الأسماك'),
    (14, 'dairy', 'service', 'food', '🧀', 'Milk & dairy', 'الألبان ومنتجاتها'),
    (15, 'sweets', 'service', 'food', '🍰', 'Sweets & cakes', 'الحلويات'),
    (16, 'ready_food', 'service', 'food', '🍲', 'Restaurants & ready meals', 'المطاعم والوجبات الجاهزة'),
    (17, 'home_food', 'service', 'food', '🥘', 'Home-cooked food', 'الطعام المنزلي'),
    (18, 'pharmacy', 'service', 'medical', '💊', 'Pharmacy delivery', 'توصيل الأدوية'),
    (19, 'doctor', 'service', 'medical', '🩺', 'Doctor home visit', 'زيارة طبيب منزلية'),
    (20, 'nursing', 'service', 'medical', '💉', 'Nursing & injections', 'التمريض والحقن'),
    (21, 'lab', 'service', 'medical', '🧪', 'Home lab tests', 'التحاليل المنزلية'),
    (22, 'physio', 'service', 'medical', '🦴', 'Physiotherapy', 'العلاج الطبيعي'),
    (23, 'dentist', 'service', 'medical', '🦷', 'Dentist', 'طب الأسنان'),
    (24, 'eye_care', 'service', 'medical', '👓', 'Eye care & glasses', 'العيون والنظارات'),
    (25, 'ambulance', 'service', 'medical', '🚑', 'Patient transport', 'نقل المرضى'),
    (26, 'elder_care', 'service', 'medical', '🧓', 'Elderly care', 'رعاية المسنين'),
    (27, 'medical_supplies', 'service', 'medical', '🩼', 'Medical equipment', 'المستلزمات الطبية'),
    (28, 'plumbing', 'service', 'trades', '🔧', 'Plumbing', 'السباكة'),
    (29, 'electric', 'service', 'trades', '💡', 'Electrician', 'الكهرباء'),
    (30, 'carpentry', 'service', 'trades', '🪚', 'Carpentry', 'النجارة'),
    (31, 'painting', 'service', 'trades', '🖌️', 'Painting', 'الدهان'),
    (32, 'appliance', 'service', 'trades', '🔌', 'Appliance repair', 'صيانة الأجهزة المنزلية'),
    (33, 'ac_repair', 'service', 'trades', '❄️', 'AC & refrigeration', 'التكييف والتبريد'),
    (34, 'welding', 'service', 'trades', '⚒️', 'Blacksmith & welding', 'الحدادة واللحام'),
    (35, 'aluminium', 'service', 'trades', '🪟', 'Aluminium & glass', 'الألوميتال والزجاج'),
    (36, 'locksmith', 'service', 'trades', '🔑', 'Locks & keys', 'الأقفال والمفاتيح'),
    (37, 'delivery', 'service', 'transport', '🛵', 'Delivery & errands', 'توصيل الطلبات'),
    (38, 'transport', 'service', 'transport', '🛺', 'Tuk-tuk rides', 'التوك توك'),
    (39, 'taxi', 'service', 'transport', '🚕', 'Car hire & taxi', 'سيارات الأجرة'),
    (40, 'microbus', 'service', 'transport', '🚐', 'Microbus & group trips', 'النقل الجماعي'),
    (41, 'truck', 'service', 'transport', '🚚', 'Goods transport', 'نقل البضائع'),
    (42, 'moving', 'service', 'transport', '📦', 'House moving', 'نقل الأثاث'),
    (43, 'shipping', 'service', 'transport', '📮', 'Parcels & shipping', 'شحن الطرود'),
    (44, 'tractor', 'service', 'farming', '🚜', 'Tractor & ploughing', 'الجرارات والحرث'),
    (45, 'irrigation', 'service', 'farming', '💦', 'Irrigation & pumps', 'الري والمضخات'),
    (46, 'seeds', 'service', 'farming', '🌱', 'Seeds & fertiliser', 'البذور والأسمدة'),
    (47, 'spraying', 'service', 'farming', '🧴', 'Pesticide spraying', 'رش المبيدات'),
    (48, 'harvest', 'service', 'farming', '🌾', 'Harvest & threshing', 'الحصاد والدراس'),
    (49, 'farm_labour', 'service', 'farming', '👨‍🌾', 'Farm workers', 'العمالة الزراعية'),
    (50, 'animal_feed', 'service', 'farming', '🌽', 'Animal feed', 'الأعلاف'),
    (51, 'vet', 'service', 'farming', '🐄', 'Veterinarian', 'الطب البيطري'),
    (52, 'livestock', 'service', 'farming', '🐑', 'Livestock trade', 'تجارة المواشي'),
    (53, 'clothing', 'service', 'shops', '👗', 'Clothes & shoes', 'الملابس والأحذية'),
    (54, 'household', 'service', 'shops', '🍳', 'Household goods', 'الأدوات المنزلية'),
    (55, 'books', 'service', 'shops', '📚', 'Books & stationery', 'المكتبات والأدوات المدرسية'),
    (56, 'electronics', 'service', 'shops', '📺', 'Electrical appliances', 'الأجهزة الكهربائية'),
    (57, 'hardware', 'service', 'shops', '🔩', 'Hardware & paint', 'الخردوات والدهانات'),
    (58, 'cosmetics', 'service', 'shops', '💄', 'Cosmetics & perfume', 'مستحضرات التجميل والعطور'),
    (59, 'gifts', 'service', 'shops', '🧸', 'Toys & gifts', 'الألعاب والهدايا'),
    (60, 'mechanic', 'service', 'vehicles', '🚗', 'Car mechanic', 'ميكانيكا السيارات'),
    (61, 'tyres', 'service', 'vehicles', '🛞', 'Tyres', 'الإطارات'),
    (62, 'auto_electric', 'service', 'vehicles', '🔋', 'Car electrics & batteries', 'كهرباء السيارات والبطاريات'),
    (63, 'motorbike', 'service', 'vehicles', '🏍️', 'Motorbike & tuk-tuk repair', 'صيانة الدراجات النارية'),
    (64, 'bicycle', 'service', 'vehicles', '🚲', 'Bicycle repair', 'صيانة الدراجات'),
    (65, 'car_wash', 'service', 'vehicles', '🧼', 'Car wash', 'غسيل السيارات'),
    (66, 'fuel', 'service', 'vehicles', '⛽', 'Fuel delivery', 'توصيل الوقود'),
    (67, 'phones', 'service', 'tech', '📱', 'Phones & accessories', 'الهواتف وملحقاتها'),
    (68, 'phone_repair', 'service', 'tech', '📲', 'Phone repair', 'صيانة الهواتف'),
    (69, 'computer', 'service', 'tech', '💻', 'Computer repair', 'صيانة الحاسوب'),
    (70, 'internet', 'service', 'tech', '🌐', 'Internet & networks', 'الإنترنت والشبكات'),
    (71, 'satellite', 'service', 'tech', '📡', 'Satellite dishes', 'أطباق الاستقبال'),
    (72, 'cctv', 'service', 'tech', '📹', 'Security cameras', 'كاميرات المراقبة'),
    (73, 'printing', 'service', 'tech', '🖨️', 'Printing & copying', 'الطباعة والتصوير'),
    (74, 'e_services', 'service', 'tech', '🧾', 'Online services & bills', 'الخدمات الإلكترونية والفواتير'),
    (75, 'software', 'service', 'tech', '👨‍💻', 'Websites & software', 'المواقع والبرمجة'),
    (76, 'mason', 'service', 'building', '🧱', 'Masonry & building', 'أعمال البناء'),
    (77, 'tiling', 'service', 'building', '🔲', 'Tiling & marble', 'البلاط والرخام'),
    (78, 'plastering', 'service', 'building', '🏗️', 'Plastering', 'المحارة'),
    (79, 'building_materials', 'service', 'building', '🧰', 'Building materials', 'مواد البناء'),
    (80, 'contractor', 'service', 'building', '👷', 'Contractor', 'المقاولات'),
    (81, 'surveyor', 'service', 'building', '📐', 'Engineer & surveyor', 'الهندسة والمساحة'),
    (82, 'machining', 'service', 'industry', '⚙️', 'Lathe & machining', 'الخراطة وتشغيل المعادن'),
    (83, 'motor_rewind', 'service', 'industry', '🌀', 'Motor rewinding', 'لف المحركات'),
    (84, 'generators', 'service', 'industry', '⚡', 'Generators', 'المولدات الكهربائية'),
    (85, 'well_drilling', 'service', 'industry', '🕳️', 'Well drilling', 'حفر الآبار'),
    (86, 'equipment_rental', 'service', 'industry', '🏗️', 'Equipment rental', 'تأجير المعدات'),
    (87, 'manufacturing', 'service', 'industry', '🏭', 'Custom manufacturing', 'التصنيع حسب الطلب'),
    (88, 'scrap', 'service', 'industry', '♻️', 'Scrap & recycling', 'الخردة وإعادة التدوير'),
    (89, 'tutoring', 'service', 'education', '✏️', 'Private lessons', 'الدروس الخصوصية'),
    (90, 'quran', 'service', 'education', '📖', 'Quran teaching', 'تحفيظ القرآن'),
    (91, 'childcare', 'service', 'education', '👶', 'Nursery & childcare', 'الحضانة ورعاية الأطفال'),
    (92, 'courses', 'service', 'education', '🎓', 'Training courses', 'الدورات التدريبية'),
    (93, 'languages', 'service', 'education', '🗣️', 'Language lessons', 'تعليم اللغات'),
    (94, 'barber', 'service', 'personal', '💈', 'Barber', 'الحلاقة'),
    (95, 'salon', 'service', 'personal', '💇‍♀️', 'Women''s salon', 'التجميل للسيدات'),
    (96, 'tailor', 'service', 'personal', '🧵', 'Tailor', 'الخياطة'),
    (97, 'shoe_repair', 'service', 'personal', '👞', 'Shoe repair', 'إصلاح الأحذية'),
    (98, 'catering', 'service', 'events', '🍽️', 'Catering & banquets', 'الطهي والولائم'),
    (99, 'tents', 'service', 'events', '⛺', 'Tents & chairs', 'السرادقات والكراسي'),
    (100, 'sound', 'service', 'events', '🔊', 'Sound & lighting', 'الصوت والإضاءة'),
    (101, 'photography', 'service', 'events', '📷', 'Photography', 'التصوير الفوتوغرافي'),
    (102, 'wedding', 'service', 'events', '💍', 'Weddings', 'تجهيز الأفراح'),
    (103, 'lawyer', 'service', 'professional', '⚖️', 'Lawyer', 'المحاماة'),
    (104, 'accountant', 'service', 'professional', '🧮', 'Accountant & taxes', 'المحاسبة والضرائب'),
    (105, 'real_estate', 'service', 'professional', '🏘️', 'Real estate', 'الوساطة العقارية'),
    (106, 'paperwork', 'service', 'professional', '📝', 'Paperwork & forms', 'استخراج الأوراق الرسمية'),
    (107, 'translation', 'service', 'professional', '🔤', 'Translation', 'الترجمة'),
    (108, 'insurance', 'service', 'professional', '🛡️', 'Insurance', 'التأمين'),
    (109, 'other', 'service', 'other', '✨', 'Something else', 'أخرى'),
    (110, 'mosque', 'place', 'places', '🕌', 'Mosque', 'مسجد'),
    (111, 'church', 'place', 'places', '⛪', 'Church', 'كنيسة'),
    (112, 'health', 'place', 'places', '🏥', 'Hospital / health unit', 'مستشفى / وحدة صحية'),
    (113, 'clinic', 'place', 'places', '🩺', 'Clinic', 'عيادة'),
    (114, 'pharmacy_place', 'place', 'places', '⚕️', 'Pharmacy', 'صيدلية'),
    (115, 'school', 'place', 'places', '🏫', 'School', 'مدرسة'),
    (116, 'kindergarten', 'place', 'places', '🧒', 'Kindergarten', 'روضة أطفال'),
    (117, 'government', 'place', 'places', '🏛️', 'Government office', 'جهة حكومية'),
    (118, 'post', 'place', 'places', '📮', 'Post office', 'مكتب بريد'),
    (119, 'bank', 'place', 'places', '🏧', 'ATM / bank', 'ماكينة صرف / بنك'),
    (120, 'police', 'place', 'places', '🚓', 'Police', 'نقطة شرطة'),
    (121, 'fire', 'place', 'places', '🚒', 'Fire station', 'مطافئ'),
    (122, 'youth', 'place', 'places', '⚽', 'Youth center', 'مركز شباب'),
    (123, 'market', 'place', 'places', '🧺', 'Market', 'سوق'),
    (124, 'bakery_place', 'place', 'places', '🥖', 'Bakery', 'مخبز'),
    (125, 'fuel_station', 'place', 'places', '⛽', 'Fuel station', 'محطة وقود'),
    (126, 'transport_stop', 'place', 'places', '🚏', 'Transport stop', 'موقف المواصلات'),
    (127, 'vet_place', 'place', 'places', '🐄', 'Veterinary unit', 'وحدة بيطرية'),
    (128, 'agri_coop', 'place', 'places', '🌾', 'Agricultural cooperative', 'الجمعية الزراعية'),
    (129, 'park', 'place', 'places', '🌳', 'Garden', 'حديقة'),
    (130, 'cemetery', 'place', 'places', '🪦', 'Cemetery', 'مقابر'),
    (131, 'shop', 'place', 'places', '🏪', 'Shop or business', 'محل أو نشاط تجاري')
  ) as v(ord, key, kind, sector, icon, en, ar)
  on conflict (group_id, key) do update set sector = excluded.sector
    where categories.sector = 'other' and excluded.sector <> 'other';
$$;

-- look up a village by its join code (to show its name before joining)
create or replace function village_gate.group_by_code(p_code text)
returns table (id uuid, name text, center_lat double precision, center_lng double precision)
language sql stable security definer set search_path = village_gate, pg_temp as $$
  select g.id, g.name, g.center_lat, g.center_lng from groups g
  where g.join_code = upper(btrim(p_code)) and g.status = 'active' and auth.uid() is not null;
$$;

drop function if exists village_gate.create_group(text, double precision, double precision, text, text, double precision, double precision, text);
create or replace function village_gate.create_group(p_name text, p_lat double precision, p_lng double precision, p_radius int,
  p_display_name text, p_phone text, p_home_lat double precision, p_home_lng double precision, p_home_note text)
returns uuid language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  insert into groups(name, join_code, center_lat, center_lng, radius_m, created_by)
  values (btrim(p_name), new_join_code(), p_lat, p_lng, coalesce(p_radius, 1000), auth.uid()) returning id into g;
  insert into memberships(group_id, user_id, role, status, display_name, phone, home_lat, home_lng, home_note, verified_at, verified_by)
  values (g, auth.uid(), 'owner', 'approved', btrim(p_display_name), p_phone, p_home_lat, p_home_lng, coalesce(btrim(p_home_note), ''), now(), auth.uid());
  perform seed_categories(g);
  return g;
end $$;

create or replace function village_gate.join_group(p_code text, p_display_name text, p_phone text,
  p_home_lat double precision, p_home_lng double precision, p_home_note text)
returns uuid language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare g uuid; m memberships;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select id into g from groups where join_code = upper(btrim(p_code)) and status = 'active';
  if g is null then raise exception 'invalid_code'; end if;
  select * into m from memberships where group_id = g and user_id = auth.uid();
  if found and m.status in ('pending', 'approved') then return g; end if;
  if found then
    perform set_config('village_gate.skip_log', 'on', true);
    update memberships set status = 'pending', role = 'member', display_name = btrim(p_display_name), phone = p_phone,
      home_lat = p_home_lat, home_lng = p_home_lng, home_note = coalesce(btrim(p_home_note), ''), verified_at = null, verified_by = null
    where id = m.id;
    perform log_activity(g, 'rejoin', 'memberships', m.id, to_jsonb(m), (select to_jsonb(x) from memberships x where x.id = m.id));
  else
    insert into memberships(group_id, user_id, role, status, display_name, phone, home_lat, home_lng, home_note)
    values (g, auth.uid(), 'member', 'pending', btrim(p_display_name), p_phone, p_home_lat, p_home_lng, coalesce(btrim(p_home_note), ''));
  end if;
  return g;
end $$;

drop function if exists village_gate.update_group(uuid, text, double precision, double precision, int);
create or replace function village_gate.update_group(p_group uuid, p_name text, p_lat double precision, p_lng double precision, p_zoom int, p_radius int)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  update groups set name = coalesce(btrim(p_name), name), center_lat = coalesce(p_lat, center_lat),
    center_lng = coalesce(p_lng, center_lng), zoom = case when p_zoom is null then zoom else least(19, greatest(10, p_zoom)) end,
    radius_m = coalesce(p_radius, radius_m)
  where id = p_group;
end $$;

-- store the 3D village map (built in the browser from OpenStreetMap, see js/osm.js)
create or replace function village_gate.save_village_map(p_group uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_data) <> 'object' or (p_data ->> 'v') is distinct from '1' or jsonb_typeof(p_data -> 'rd') <> 'array'
    or jsonb_typeof(p_data -> 'b') <> 'array' then raise exception 'invalid_input'; end if;
  if pg_column_size(p_data) >= 4000000 then raise exception 'map_too_big'; end if;
  insert into village_maps(group_id, data) values (p_group, p_data)
  on conflict (group_id) do update set data = excluded.data, updated_at = now();
  perform log_activity(p_group, 'build_map', 'groups', p_group, null, jsonb_build_object(
    'buildings', jsonb_array_length(p_data -> 'b'), 'roads', jsonb_array_length(p_data -> 'rd'),
    'places', coalesce(jsonb_array_length(p_data -> 'p'), 0)));
end $$;

-- add landmarks found on the map as places; p_places = [{key, name, lat, lng, osm_ref}]. Returns how many were added.
create or replace function village_gate.import_places(p_group uuid, p_places jsonb)
returns int language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare p jsonb; cat uuid; n int := 0; c int;
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) > 300 then raise exception 'invalid_input'; end if;
  perform set_config('village_gate.skip_log_insert', 'on', true);
  for p in select * from jsonb_array_elements(p_places) loop
    select id into cat from categories where group_id = p_group and kind = 'place' and key = p ->> 'key';
    continue when cat is null or coalesce(p ->> 'osm_ref', '') !~ '^([nwr][0-9]{1,12}|o[0-9a-f]{8,32})$';
    begin
      insert into places(group_id, category_id, name, phone, lat, lng, osm_ref)
      values (p_group, cat, left(btrim(p ->> 'name'), 80), case when p ->> 'phone' ~ '^0[0-9]{8,10}$' then p ->> 'phone' end,
        (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, p ->> 'osm_ref')
      on conflict (group_id, osm_ref) where osm_ref is not null do nothing;
      get diagnostics c = row_count;
      n := n + c;
    exception when check_violation or not_null_violation or invalid_text_representation then null; -- skip invalid rows
    end;
  end loop;
  perform set_config('village_gate.skip_log_insert', 'off', true);
  if n > 0 then perform log_activity(p_group, 'import_places', 'places', p_group, null, jsonb_build_object('added', n)); end if;
  return n;
end $$;

-- a resident suggests a place for the village guide; the mayor approves it (an admin's own suggestion is approved at once)
create or replace function village_gate.suggest_place(p_group uuid, p_category uuid, p_name text, p_lat double precision, p_lng double precision, p_note text)
returns uuid language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare pid uuid;
begin
  if not can_write(p_group) then raise exception 'forbidden'; end if;
  if not is_admin(p_group) and (select count(*) from places where group_id = p_group and created_by = auth.uid() and status = 'pending') >= 10 then
    raise exception 'too_many';
  end if;
  insert into places(group_id, category_id, name, lat, lng, note, status)
  values (p_group, p_category, btrim(p_name), p_lat, p_lng, coalesce(btrim(p_note), ''), case when is_admin(p_group) then 'approved' else 'pending' end)
  returning id into pid;
  return pid;
end $$;

-- the mayor approves a suggested place, or turns it down (which removes it)
create or replace function village_gate.review_place(p_place uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare r places;
begin
  select * into r from places where id = p_place;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(r.group_id) then raise exception 'forbidden'; end if;
  if r.status <> 'pending' then raise exception 'invalid_state'; end if;
  if p_approve then update places set status = 'approved' where id = r.id;
  else delete from places where id = r.id; end if;
end $$;

create or replace function village_gate.regenerate_join_code(p_group uuid)
returns text language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare c text := new_join_code();
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  update groups set join_code = c where id = p_group;
  return c;
end $$;

create or replace function village_gate.delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  if not has_role(p_group, array['owner']) then raise exception 'owner_only'; end if;
  delete from groups where id = p_group;
end $$;

create or replace function village_gate.transfer_ownership(p_group uuid, p_membership uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare t memberships;
begin
  if not has_role(p_group, array['owner']) then raise exception 'owner_only'; end if;
  select * into t from memberships where id = p_membership and group_id = p_group;
  if not found or t.status <> 'approved' or t.user_id = auth.uid() then raise exception 'invalid_input'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set role = 'admin' where group_id = p_group and user_id = auth.uid();
  update memberships set role = 'owner' where id = p_membership;
  perform log_activity(p_group, 'transfer_owner', 'memberships', p_membership,
    jsonb_build_object('owner', auth.uid()), jsonb_build_object('owner', t.user_id, 'display_name', t.display_name));
end $$;

create or replace function village_gate.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare m memberships;
begin
  select * into m from memberships where group_id = p_group and user_id = auth.uid();
  if not found then raise exception 'not_found'; end if;
  if m.role = 'owner' then raise exception 'owner_cannot_leave'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set status = 'removed' where id = m.id;
  update requests set status = 'open', business_id = null, accepted_at = null
  where group_id = p_group and status = 'accepted' and business_id in (select id from businesses where owner_user_id = auth.uid() and group_id = p_group);
  perform log_activity(p_group, 'leave', 'memberships', m.id, to_jsonb(m), jsonb_build_object('status', 'removed', 'display_name', m.display_name));
end $$;

create or replace function village_gate.update_my_membership(p_group uuid, p_display_name text, p_phone text,
  p_home_lat double precision, p_home_lng double precision, p_home_note text)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  update memberships set display_name = btrim(p_display_name), phone = p_phone, home_lat = p_home_lat, home_lng = p_home_lng,
    home_note = coalesce(btrim(p_home_note), '')
  where group_id = p_group and user_id = auth.uid() and status in ('approved', 'pending');
  if not found then raise exception 'forbidden'; end if;
end $$;

create or replace function village_gate.approve_member(p_membership uuid, p_role text default 'member')
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare m memberships;
begin
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(m.group_id) then raise exception 'forbidden'; end if;
  if p_role not in ('member', 'viewer') then raise exception 'invalid_input'; end if;
  if m.status not in ('pending', 'rejected') then raise exception 'invalid_state'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set status = 'approved', role = p_role, verified_at = now(), verified_by = auth.uid() where id = m.id;
  perform log_activity(m.group_id, 'approve', 'memberships', m.id, to_jsonb(m), (select to_jsonb(x) from memberships x where x.id = m.id));
end $$;

create or replace function village_gate.reject_member(p_membership uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare m memberships;
begin
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(m.group_id) then raise exception 'forbidden'; end if;
  if m.status <> 'pending' then raise exception 'invalid_state'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set status = 'rejected' where id = m.id;
  perform log_activity(m.group_id, 'reject', 'memberships', m.id, to_jsonb(m), (select to_jsonb(x) from memberships x where x.id = m.id));
end $$;

create or replace function village_gate.set_member_role(p_membership uuid, p_role text)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare m memberships;
begin
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(m.group_id) then raise exception 'forbidden'; end if;
  if p_role not in ('admin', 'member', 'viewer') or m.status <> 'approved' or m.role = 'owner' then raise exception 'invalid_input'; end if;
  if (p_role = 'admin' or m.role = 'admin') and not has_role(m.group_id, array['owner']) then raise exception 'owner_only'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set role = p_role where id = m.id;
  -- a viewer cannot run a business: release its accepted requests
  if p_role = 'viewer' then
    update requests set status = 'open', business_id = null, accepted_at = null
    where group_id = m.group_id and status = 'accepted' and business_id in (select id from businesses where owner_user_id = m.user_id and group_id = m.group_id);
  end if;
  perform log_activity(m.group_id, 'set_role', 'memberships', m.id, to_jsonb(m), (select to_jsonb(x) from memberships x where x.id = m.id));
end $$;

create or replace function village_gate.remove_member(p_membership uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare m memberships;
begin
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(m.group_id) then raise exception 'forbidden'; end if;
  if m.role = 'owner' then raise exception 'owner_cannot_leave'; end if;
  if m.role = 'admin' and not has_role(m.group_id, array['owner']) then raise exception 'owner_only'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update memberships set status = 'removed' where id = m.id;
  update requests set status = 'open', business_id = null, accepted_at = null
  where group_id = m.group_id and status = 'accepted' and business_id in (select id from businesses where owner_user_id = m.user_id and group_id = m.group_id);
  perform log_activity(m.group_id, 'remove', 'memberships', m.id, to_jsonb(m), (select to_jsonb(x) from memberships x where x.id = m.id));
end $$;

-- create or edit a business with its categories in one step (new businesses always start "pending")
create or replace function village_gate.save_business(p_group uuid, p_id uuid, p_name text, p_description text, p_phone text,
  p_whatsapp text, p_lat double precision, p_lng double precision, p_is_mobile boolean, p_hours text, p_categories uuid[])
returns uuid language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare b businesses; bid uuid; c uuid;
begin
  if not can_write(p_group) then raise exception 'forbidden'; end if;
  if p_categories is null or cardinality(p_categories) = 0 then raise exception 'pick_category'; end if;
  if p_id is null then
    insert into businesses(group_id, owner_user_id, name, description, phone, whatsapp, lat, lng, is_mobile, hours)
    values (p_group, auth.uid(), btrim(p_name), coalesce(btrim(p_description), ''), p_phone, nullif(p_whatsapp, ''), p_lat, p_lng, coalesce(p_is_mobile, false), coalesce(btrim(p_hours), ''))
    returning id into bid;
  else
    select * into b from businesses where id = p_id and group_id = p_group;
    if not found then raise exception 'not_found'; end if;
    if b.owner_user_id <> auth.uid() and not is_admin(p_group) then raise exception 'forbidden'; end if;
    update businesses set name = btrim(p_name), description = coalesce(btrim(p_description), ''), phone = p_phone, whatsapp = nullif(p_whatsapp, ''),
      lat = p_lat, lng = p_lng, is_mobile = coalesce(p_is_mobile, false), hours = coalesce(btrim(p_hours), '')
    where id = p_id;
    bid := p_id;
  end if;
  delete from business_categories where business_id = bid and category_id <> all (p_categories);
  foreach c in array p_categories loop
    insert into business_categories(group_id, business_id, category_id) values (p_group, bid, c)
    on conflict (business_id, category_id) do nothing;
  end loop;
  return bid;
end $$;

create or replace function village_gate.delete_business(p_business uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare b businesses;
begin
  select * into b from businesses where id = p_business;
  if not found then raise exception 'not_found'; end if;
  if not ((b.owner_user_id = auth.uid() and can_write(b.group_id)) or is_admin(b.group_id)) then raise exception 'forbidden'; end if;
  update requests set status = 'open', accepted_at = null, business_id = null where business_id = b.id and status = 'accepted';
  delete from businesses where id = b.id;
end $$;

create or replace function village_gate.set_business_status(p_business uuid, p_status text)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare b businesses;
begin
  select * into b from businesses where id = p_business;
  if not found then raise exception 'not_found'; end if;
  if not is_admin(b.group_id) then raise exception 'forbidden'; end if;
  if p_status not in ('pending', 'verified', 'suspended', 'rejected') then raise exception 'invalid_input'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update businesses set status = p_status,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    verified_by = case when p_status = 'verified' then auth.uid() else verified_by end
  where id = b.id;
  if p_status <> 'verified' then
    update requests set status = 'open', business_id = null, accepted_at = null where business_id = b.id and status = 'accepted';
  end if;
  perform log_activity(b.group_id, 'set_status', 'businesses', b.id, to_jsonb(b), (select to_jsonb(x) from businesses x where x.id = b.id));
end $$;

-- ---------- requests ----------
create or replace function village_gate.cancel_request(p_request uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare r requests;
begin
  select * into r from requests where id = p_request;
  if not found then raise exception 'not_found'; end if;
  if r.created_by <> auth.uid() or not is_member(r.group_id) then raise exception 'forbidden'; end if;
  if r.status not in ('open', 'accepted') then raise exception 'invalid_state'; end if;
  update requests set status = 'cancelled', cancelled_at = now() where id = r.id;
end $$;

create or replace function village_gate.deliver_request(p_request uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare r requests;
begin
  select * into r from requests where id = p_request;
  if not found then raise exception 'not_found'; end if;
  if not ((r.created_by = auth.uid() and is_member(r.group_id)) or r.business_id in (select my_business_ids(r.group_id))) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'accepted' then raise exception 'invalid_state'; end if;
  update requests set status = 'delivered', delivered_at = now() where id = r.id;
end $$;

create or replace function village_gate.release_request(p_request uuid)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare r requests;
begin
  select * into r from requests where id = p_request;
  if not found then raise exception 'not_found'; end if;
  if r.status <> 'accepted' or r.business_id not in (select my_business_ids(r.group_id)) then raise exception 'forbidden'; end if;
  update requests set status = 'open', business_id = null, accepted_at = null where id = r.id;
end $$;

-- Demand for one verified business: open requests in its categories, location rounded to a ~100 m cell.
-- No names, no phones, no exact pins.
create or replace function village_gate.open_demand(p_group uuid, p_business uuid, p_hours int default 48)
returns table (id uuid, category_id uuid, quantity int, details text, created_at timestamptz, needed_by timestamptz,
  cell_lat double precision, cell_lng double precision)
language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  if p_business not in (select my_business_ids(p_group)) then raise exception 'forbidden'; end if;
  perform set_config('village_gate.skip_log', 'on', true); -- expiring old requests is housekeeping, not worth a log line each
  update requests r set status = 'expired' where r.group_id = p_group and r.status = 'open' and r.expires_at < now();
  return query
    select r.id, r.category_id, r.quantity, r.details, r.created_at, r.needed_by,
      round((floor(r.lat / 0.001) * 0.001 + 0.0005)::numeric, 6)::double precision,
      round((floor(r.lng / 0.001) * 0.001 + 0.0005)::numeric, 6)::double precision
    from requests r
    where r.group_id = p_group and r.status = 'open' and r.expires_at > now()
      and r.created_at >= now() - make_interval(hours => least(greatest(coalesce(p_hours, 48), 1), 24 * 14))
      and r.category_id in (select bc.category_id from business_categories bc where bc.business_id = p_business)
    order by r.created_at
    limit 2000;
end $$;

create or replace function village_gate.accept_requests(p_business uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare b businesses; n int;
begin
  select * into b from businesses where id = p_business;
  if not found or p_business not in (select my_business_ids(b.group_id)) then raise exception 'forbidden'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update requests r set status = 'accepted', business_id = b.id, accepted_at = now()
  where r.id = any (p_ids) and r.group_id = b.group_id and r.status = 'open' and r.expires_at > now()
    and r.category_id in (select bc.category_id from business_categories bc where bc.business_id = b.id);
  get diagnostics n = row_count;
  if n > 0 then perform log_activity(b.group_id, 'accept', 'requests', null, null, jsonb_build_object('business', b.name, 'count', n)); end if;
  return n;
end $$;

-- Jobs of my business: exact pin and contact, only for requests this business accepted.
create or replace function village_gate.my_jobs(p_business uuid)
returns table (id uuid, category_id uuid, quantity int, details text, lat double precision, lng double precision,
  location_note text, needed_by timestamptz, created_at timestamptz, accepted_at timestamptz, delivered_at timestamptz,
  status text, contact_name text, contact_phone text)
language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare b businesses;
begin
  select * into b from businesses x where x.id = p_business;  -- qualified: "id" is also an output column
  if not found or b.owner_user_id <> auth.uid() or not is_member(b.group_id) then raise exception 'forbidden'; end if;
  return query
    select r.id, r.category_id, r.quantity, r.details, r.lat, r.lng, r.location_note, r.needed_by, r.created_at,
      r.accepted_at, r.delivered_at, r.status, m.display_name, m.phone
    from requests r
    left join memberships m on m.group_id = r.group_id and m.user_id = r.created_by
    where r.business_id = b.id
      and (r.status = 'accepted' or (r.status = 'delivered' and r.delivered_at > now() - interval '7 days'))
    order by r.accepted_at;
end $$;

-- ---------- export / restore ----------
create or replace function village_gate.export_group(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'kind', 'village-gate-backup', 'version', 1, 'exported_at', now(),
    'group', (select to_jsonb(g) from groups g where g.id = p_group),
    'categories', coalesce((select jsonb_agg(to_jsonb(x)) from categories x where x.group_id = p_group), '[]'),
    'places', coalesce((select jsonb_agg(to_jsonb(x)) from places x where x.group_id = p_group), '[]'),
    'memberships', coalesce((select jsonb_agg(to_jsonb(x)) from memberships x where x.group_id = p_group), '[]'),
    'businesses', coalesce((select jsonb_agg(to_jsonb(x)) from businesses x where x.group_id = p_group), '[]'),
    'business_categories', coalesce((select jsonb_agg(to_jsonb(x)) from business_categories x where x.group_id = p_group), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(x)) from requests x where x.group_id = p_group), '[]'));
end $$;

-- Restores categories (matched by key) and places only. Members, businesses and requests are never
-- restored from a file because they must be verified by the mayor.
create or replace function village_gate.import_group(p_group uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = village_gate, pg_temp as $$
declare c jsonb; p jsonb; nc int := 0; np int := 0; cat uuid; key_of jsonb := '{}';
begin
  if not is_admin(p_group) then raise exception 'forbidden'; end if;
  if p_data ->> 'kind' is distinct from 'village-gate-backup' or jsonb_typeof(p_data -> 'categories') <> 'array' then raise exception 'invalid_backup'; end if;
  for c in select * from jsonb_array_elements(p_data -> 'categories') loop
    continue when coalesce(c ->> 'key', '') !~ '^[a-z0-9_]{2,30}$' or coalesce(c ->> 'kind', '') not in ('service', 'place');
    key_of := key_of || jsonb_build_object(c ->> 'id', c ->> 'key');
    insert into categories(group_id, key, kind, sector, icon, name_en, name_ar, sort, active)
    values (p_group, c ->> 'key', c ->> 'kind',
      case when c ->> 'kind' = 'place' then 'places' when coalesce(c ->> 'sector', '') ~ '^[a-z_]{2,20}$' then c ->> 'sector' else 'other' end,
      coalesce(c ->> 'icon', '•'), c ->> 'name_en', c ->> 'name_ar',
      coalesce((c ->> 'sort')::int, 100), coalesce((c ->> 'active')::boolean, true))
    on conflict (group_id, key) do update set sector = excluded.sector, icon = excluded.icon, name_en = excluded.name_en, name_ar = excluded.name_ar,
      sort = excluded.sort, active = excluded.active;
    nc := nc + 1;
  end loop;
  for p in select * from jsonb_array_elements(coalesce(p_data -> 'places', '[]')) loop
    select id into cat from categories where group_id = p_group and kind = 'place' and key = key_of ->> (p ->> 'category_id');
    continue when cat is null;
    begin
      insert into places(id, group_id, category_id, name, phone, lat, lng, note)
      values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), p_group, cat, p ->> 'name', nullif(p ->> 'phone', ''),
        (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, coalesce(p ->> 'note', ''))
      on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, phone = excluded.phone,
        lat = excluded.lat, lng = excluded.lng, note = excluded.note
      where places.group_id = p_group;
      np := np + 1;
    exception when check_violation or not_null_violation or invalid_text_representation then null; -- skip invalid rows
    end;
  end loop;
  perform log_activity(p_group, 'restore', 'groups', p_group, null, jsonb_build_object('categories', nc, 'places', np));
  return jsonb_build_object('categories', nc, 'places', np);
end $$;

-- ---------- platform owner (only users in platform_admins) ----------
create or replace function village_gate.platform_stats()
returns jsonb language plpgsql stable security definer set search_path = village_gate, pg_temp as $$
declare w jsonb;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  select jsonb_agg(jsonb_build_object(
      'week', to_char(wk, 'YYYY-MM-DD'),
      'activity', (select count(*) from activity_log a where a.created_at >= wk and a.created_at < wk + interval '7 days'),
      'new_users', (select count(*) from profiles u where u.created_at >= wk and u.created_at < wk + interval '7 days'),
      'new_groups', (select count(*) from groups g where g.created_at >= wk and g.created_at < wk + interval '7 days')) order by wk)
    into w
  from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') wk;
  return jsonb_build_object(
    'groups', (select count(*) from groups),
    'active_groups', (select count(*) from groups where status = 'active'),
    'users', (select count(*) from profiles),
    'memberships', (select count(*) from memberships where status = 'approved'),
    'requests_7d', (select count(*) from requests where created_at > now() - interval '7 days'),
    'weeks', coalesce(w, '[]'));
end $$;

create or replace function village_gate.platform_groups(p_query text default '')
returns table (id uuid, name text, status text, created_at timestamptz, owner_name text, members bigint, pending bigint,
  businesses bigint, requests_7d bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return query
    select g.id, g.name, g.status, g.created_at,
      (select m.display_name from memberships m where m.group_id = g.id and m.role = 'owner'),
      (select count(*) from memberships m where m.group_id = g.id and m.status = 'approved'),
      (select count(*) from memberships m where m.group_id = g.id and m.status = 'pending'),
      (select count(*) from businesses b where b.group_id = g.id and b.status = 'verified'),
      (select count(*) from requests r where r.group_id = g.id and r.created_at > now() - interval '7 days'),
      (select max(a.created_at) from activity_log a where a.group_id = g.id)
    from groups g
    where coalesce(p_query, '') = '' or g.name ilike '%' || p_query || '%' or g.join_code = upper(btrim(p_query))
    order by g.created_at desc
    limit 500;
end $$;

create or replace function village_gate.platform_set_group_status(p_group uuid, p_status text)
returns void language plpgsql security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'invalid_input'; end if;
  perform set_config('village_gate.skip_log', 'on', true);
  update groups set status = p_status where id = p_group;
  if not found then raise exception 'not_found'; end if;
  perform log_activity(p_group, 'platform_status', 'groups', p_group, null, jsonb_build_object('status', p_status));
end $$;

create or replace function village_gate.platform_activity(p_group uuid default null, p_limit int default 200)
returns table (id uuid, group_id uuid, group_name text, actor uuid, actor_name text, action text, entity text,
  entity_id uuid, before jsonb, after jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = village_gate, pg_temp as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return query
    select a.id, a.group_id, g.name, a.actor,
      coalesce((select m.display_name from memberships m where m.group_id = a.group_id and m.user_id = a.actor), ''),
      a.action, a.entity, a.entity_id, a.before, a.after, a.created_at
    from activity_log a join groups g on g.id = a.group_id
    where p_group is null or a.group_id = p_group
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

-- -------------------------------------------------------------------------------------
-- Function privileges: browser (authenticated) may call the RPCs and the policy helpers;
-- internal helpers stay private. Nothing is callable by anon.
-- -------------------------------------------------------------------------------------
revoke all on all functions in schema village_gate from public, anon, authenticated;
grant execute on function
  village_gate.is_member(uuid), village_gate.has_role(uuid, text[]), village_gate.is_admin(uuid), village_gate.can_write(uuid),
  village_gate.is_platform_admin(), village_gate.my_business_ids(uuid),
  village_gate.group_by_code(text),
  village_gate.create_group(text, double precision, double precision, int, text, text, double precision, double precision, text),
  village_gate.join_group(text, text, text, double precision, double precision, text),
  village_gate.update_group(uuid, text, double precision, double precision, int, int),
  village_gate.save_village_map(uuid, jsonb), village_gate.import_places(uuid, jsonb),
  village_gate.suggest_place(uuid, uuid, text, double precision, double precision, text), village_gate.review_place(uuid, boolean),
  village_gate.regenerate_join_code(uuid), village_gate.delete_group(uuid), village_gate.transfer_ownership(uuid, uuid),
  village_gate.leave_group(uuid),
  village_gate.update_my_membership(uuid, text, text, double precision, double precision, text),
  village_gate.approve_member(uuid, text), village_gate.reject_member(uuid), village_gate.set_member_role(uuid, text),
  village_gate.remove_member(uuid),
  village_gate.save_business(uuid, uuid, text, text, text, text, double precision, double precision, boolean, text, uuid[]),
  village_gate.delete_business(uuid), village_gate.set_business_status(uuid, text),
  village_gate.cancel_request(uuid), village_gate.deliver_request(uuid), village_gate.release_request(uuid),
  village_gate.open_demand(uuid, uuid, int), village_gate.accept_requests(uuid, uuid[]), village_gate.my_jobs(uuid),
  village_gate.export_group(uuid), village_gate.import_group(uuid, jsonb),
  village_gate.platform_stats(), village_gate.platform_groups(text), village_gate.platform_set_group_status(uuid, text),
  village_gate.platform_activity(uuid, int)
to authenticated;
-- RLS policies call the helpers as the signed-in user, so they need execute (granted above).
-- new_join_code, seed_categories, log_activity, tg_log and tg_check_kind stay private.

-- Villages created before the full service list get the new categories (existing names are kept).
select village_gate.seed_categories(id) from village_gate.groups;
