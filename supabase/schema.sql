-- CleanSpot database and security schema. Run this in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  email text not null,
  role text not null default 'citizen' check (role in ('citizen', 'cleanup_company', 'admin')),
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cleanup_companies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text not null,
  service_area text not null default 'Sri Lanka',
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_url text not null,
  photo_urls text[] not null default '{}',
  description text not null check (char_length(description) between 8 and 1000),
  location text not null,
  latitude double precision,
  longitude double precision,
  waste_category text check (waste_category in ('Plastic', 'Paper/Cardboard', 'Glass', 'Metal', 'Organic', 'Electronic', 'Construction', 'Mixed Waste', 'Other')),
  status text not null default 'pending' check (status in ('submitted', 'pending', 'accepted', 'assigned', 'cleaning', 'cleaned', 'declined')),
  decline_reason text,
  duplicate_of_report_id uuid references public.reports(id),
  cleanup_company_id uuid references public.cleanup_companies(id),
  after_cleaning_photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleaned_at timestamptz
);

create table if not exists public.report_status_history (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  status text not null check (status in ('submitted', 'pending', 'accepted', 'assigned', 'cleaning', 'cleaned', 'declined')),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_analysis (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports(id) on delete cascade,
  waste_type text not null,
  severity text not null check (severity in ('Low', 'Medium', 'High', 'Critical')),
  priority text not null check (priority in ('Normal', 'High', 'Urgent')),
  estimated_scale text not null check (estimated_scale in ('Small', 'Medium', 'Large')),
  description text not null,
  recommended_action text not null,
  source text not null default 'hackclub-gpt-4',
  raw_response text,
  created_at timestamptz not null default now()
);

create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid unique references public.reports(id) on delete set null,
  points integer not null,
  type text not null check (type in ('cleanup_reward', 'reward_claim', 'admin_adjustment')),
  created_at timestamptz not null default now()
);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  image_url text,
  points_cost integer not null check (points_cost > 0),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid not null references public.rewards(id),
  points_spent integer not null check (points_spent > 0),
  status text not null default 'claimed' check (status in ('claimed', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 8 and 1000),
  category text not null check (category in ('Cardboard', 'Plastic', 'Glass', 'Metal', 'Electronics', 'Furniture', 'Reusable Items', 'Other')),
  quantity text not null,
  listing_type text not null check (listing_type in ('individual', 'bulk')),
  condition text not null,
  price numeric(12,2) not null check (price >= 0),
  location text not null,
  contact_info text not null,
  image_urls text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_status_created_at_idx on public.reports(status, created_at desc);
create index if not exists reports_coordinates_idx on public.reports(latitude, longitude) where latitude is not null and longitude is not null;
create index if not exists marketplace_active_created_at_idx on public.marketplace_listings(active, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists reports_updated_at on public.reports;
create trigger reports_updated_at before update on public.reports for each row execute procedure public.set_updated_at();
drop trigger if exists marketplace_listings_updated_at on public.marketplace_listings;
create trigger marketplace_listings_updated_at before update on public.marketplace_listings for each row execute procedure public.set_updated_at();

-- The transaction protects against double awarding points from repeated requests.
create or replace function public.complete_report_with_points(
  p_report_id uuid,
  p_company_user_id uuid,
  p_proof_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_record public.reports%rowtype;
  company_profile_id uuid;
  awarded_points integer;
begin
  select * into report_record from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if report_record.status not in ('accepted', 'assigned', 'cleaning') then raise exception 'Report cannot be completed from its current status'; end if;
  select profile_id into company_profile_id from public.cleanup_companies where id = report_record.cleanup_company_id;
  if company_profile_id is null or not exists (
    select 1 from public.profiles where id = company_profile_id and user_id = p_company_user_id and role = 'cleanup_company'
  ) then raise exception 'Only the assigned cleanup company can complete this report'; end if;

  update public.reports
    set status = 'cleaned', after_cleaning_photo_url = p_proof_photo_url, cleaned_at = now()
    where id = p_report_id;
  insert into public.report_status_history(report_id, status, changed_by)
    values (p_report_id, 'cleaned', p_company_user_id);

  if not exists (select 1 from public.points_transactions where report_id = p_report_id and type = 'cleanup_reward') then
    awarded_points := case (
      select estimated_scale from public.ai_analysis where report_id = p_report_id
    ) when 'Large' then 50 when 'Medium' then 25 else 10 end;
    update public.profiles set points = points + awarded_points where user_id = report_record.user_id;
    insert into public.points_transactions(user_id, report_id, points, type)
      values (report_record.user_id, p_report_id, awarded_points, 'cleanup_reward');
  else
    awarded_points := 0;
  end if;

  return jsonb_build_object('report_id', p_report_id, 'status', 'cleaned', 'awarded_points', awarded_points);
end;
$$;

-- The reward and profile rows are locked before points and stock change.
create or replace function public.claim_reward(p_reward_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles%rowtype;
  reward_record public.rewards%rowtype;
  claim_id uuid;
begin
  select * into profile_record from public.profiles where user_id = p_user_id for update;
  if not found or profile_record.role <> 'citizen' then raise exception 'Only citizens can claim rewards'; end if;
  select * into reward_record from public.rewards where id = p_reward_id and active = true for update;
  if not found then raise exception 'Reward is unavailable'; end if;
  if reward_record.stock <= 0 then raise exception 'Reward is out of stock'; end if;
  if profile_record.points < reward_record.points_cost then raise exception 'You do not have enough points for this reward'; end if;

  update public.profiles set points = points - reward_record.points_cost where id = profile_record.id;
  update public.rewards set stock = stock - 1 where id = reward_record.id;
  insert into public.reward_claims(user_id, reward_id, points_spent)
    values (p_user_id, p_reward_id, reward_record.points_cost) returning id into claim_id;
  insert into public.points_transactions(user_id, points, type)
    values (p_user_id, -reward_record.points_cost, 'reward_claim');
  return jsonb_build_object('claim_id', claim_id, 'reward_name', reward_record.name, 'points_spent', reward_record.points_cost);
end;
$$;

insert into public.rewards(name, description, image_url, points_cost, stock)
select * from (values
  ('Eco Bag', 'A durable reusable shopping bag for everyday essentials.', 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80', 500, 40),
  ('Plant', 'A small indoor plant with a compostable starter pot.', 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80', 750, 25),
  ('Reusable Bottle', 'A stainless steel bottle to replace single-use plastics.', 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=80', 1000, 20),
  ('Eco Certificate', 'A digital CleanSpot recognition certificate for verified community impact.', 'https://images.unsplash.com/photo-1524032175535-863d8a2200df?auto=format&fit=crop&w=900&q=80', 1500, 100)
) as seed(name, description, image_url, points_cost, stock)
where not exists (select 1 from public.rewards);

insert into storage.buckets(id, name, public)
values
  ('report-photos', 'report-photos', true),
  ('cleanup-proof-photos', 'cleanup-proof-photos', true),
  ('marketplace-photos', 'marketplace-photos', true),
  ('reward-images', 'reward-images', true)
on conflict (id) do update set public = true;

alter table public.profiles enable row level security;
alter table public.cleanup_companies enable row level security;
alter table public.reports enable row level security;
alter table public.report_status_history enable row level security;
alter table public.ai_analysis enable row level security;
alter table public.points_transactions enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_claims enable row level security;
alter table public.marketplace_listings enable row level security;

-- Browser clients never receive policies that can award points, change report workflow, or alter another user's data.
drop policy if exists "profiles are readable by owner" on public.profiles;
create policy "profiles are readable by owner" on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "companies are readable by authenticated users" on public.cleanup_companies;
create policy "companies are readable by authenticated users" on public.cleanup_companies for select to authenticated using (true);
drop policy if exists "citizens read own reports" on public.reports;
create policy "citizens read own reports" on public.reports for select to authenticated using (user_id = auth.uid());
drop policy if exists "citizens read own report history" on public.report_status_history;
create policy "citizens read own report history" on public.report_status_history for select to authenticated using (
  exists (select 1 from public.reports where reports.id = report_status_history.report_id and reports.user_id = auth.uid())
);
drop policy if exists "citizens read own ai analysis" on public.ai_analysis;
create policy "citizens read own ai analysis" on public.ai_analysis for select to authenticated using (
  exists (select 1 from public.reports where reports.id = ai_analysis.report_id and reports.user_id = auth.uid())
);
drop policy if exists "citizens read own points transactions" on public.points_transactions;
create policy "citizens read own points transactions" on public.points_transactions for select to authenticated using (user_id = auth.uid());
drop policy if exists "rewards are publicly readable" on public.rewards;
create policy "rewards are publicly readable" on public.rewards for select to authenticated using (active = true);
drop policy if exists "citizens read own reward claims" on public.reward_claims;
create policy "citizens read own reward claims" on public.reward_claims for select to authenticated using (user_id = auth.uid());
drop policy if exists "active listings are readable" on public.marketplace_listings;
create policy "active listings are readable" on public.marketplace_listings for select to authenticated using (active = true or seller_id in (select id from public.profiles where user_id = auth.uid()));

drop policy if exists "public reads CleanSpot images" on storage.objects;
create policy "public reads CleanSpot images" on storage.objects for select using (
  bucket_id in ('report-photos', 'cleanup-proof-photos', 'marketplace-photos', 'reward-images')
);

revoke all on public.profiles, public.cleanup_companies, public.reports, public.report_status_history,
  public.ai_analysis, public.points_transactions, public.reward_claims from authenticated;
grant select on public.rewards, public.marketplace_listings to authenticated;
grant execute on function public.complete_report_with_points(uuid, uuid, text) to service_role;
grant execute on function public.claim_reward(uuid, uuid) to service_role;
