-- WORDLY 2.0 — optional accounts, synced profiles, friends and turn-based duels.
-- Every table has RLS enabled and NO policies: the browser can only reach data through the
-- security-definer functions below, which check identity before every read or write.

create table if not exists public.wordly_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar text not null default '🦊',
  color text not null default 'green',
  pass_hash text not null,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.wordly_sessions (
  token_hash text primary key,
  account_id uuid not null references public.wordly_accounts(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.wordly_profiles (
  account_id uuid primary key references public.wordly_accounts(id),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.wordly_friends (
  a uuid not null references public.wordly_accounts(id),
  b uuid not null references public.wordly_accounts(id),
  created_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (a, b),
  check (a < b)
);
create table if not exists public.wordly_matches (
  id text primary key,
  lang text not null check (lang in ('ar', 'en')),
  length int not null check (length between 3 and 8),
  max_attempts int check (max_attempts is null or max_attempts between 2 and 30),
  difficulty text not null default 'normal',
  secret text not null,
  display text, category text, meaning text, translation text, pronunciation text, example text,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  first_seat int not null default 1,
  turn int not null default 1,
  rows jsonb not null default '[]'::jsonb,
  winner int,
  result text,
  reactions jsonb not null default '[]'::jsonb,
  series jsonb not null default '{"s1":0,"s2":0,"d":0}'::jsonb,
  rematch_id text,
  invited uuid references public.wordly_accounts(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wordly_matches_invited on public.wordly_matches (invited) where status = 'waiting';
create table if not exists public.wordly_match_seats (
  match_id text not null references public.wordly_matches(id),
  seat int not null check (seat in (1, 2)),
  token_hash text not null,
  name text not null,
  avatar text not null default '🦊',
  color text not null default 'green',
  account_id uuid references public.wordly_accounts(id),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (match_id, seat)
);

alter table public.wordly_accounts enable row level security;
alter table public.wordly_sessions enable row level security;
alter table public.wordly_profiles enable row level security;
alter table public.wordly_friends enable row level security;
alter table public.wordly_matches enable row level security;
alter table public.wordly_match_seats enable row level security;

-- ───────── helpers: a schema the API does not expose ─────────
create schema if not exists wordly_private;
create or replace function wordly_private.wordly_hash(p text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

create or replace function wordly_private.wordly_new_token() returns text
language sql volatile set search_path = '' as $$ select encode(extensions.gen_random_bytes(24), 'hex') $$;

create or replace function wordly_private.wordly_session_account(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.account_id from public.wordly_sessions s
  where p_token is not null and s.token_hash = wordly_private.wordly_hash(p_token) and s.expires_at > now()
$$;

create or replace function wordly_private.wordly_account_json(a public.wordly_accounts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'username', a.username, 'displayName', a.display_name, 'avatar', a.avatar, 'color', a.color, 'createdAt', a.created_at)
$$;

create or replace function wordly_private.wordly_issue_session(p_account uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t text := wordly_private.wordly_new_token();
begin
  insert into public.wordly_sessions(token_hash, account_id, expires_at) values (wordly_private.wordly_hash(t), p_account, now() + interval '90 days');
  return t;
end $$;

-- ───────── accounts ─────────
create or replace function public.wordly_acc_signup(p_username text, p_password text, p_display text, p_avatar text default '🦊', p_color text default 'green')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare u text := lower(trim(p_username)); a public.wordly_accounts;
begin
  if u !~ '^[a-z0-9_]{3,20}$' then return jsonb_build_object('error', 'username'); end if;
  if char_length(coalesce(p_password, '')) < 6 or char_length(p_password) > 72 then return jsonb_build_object('error', 'password'); end if;
  if exists (select 1 from public.wordly_accounts where username = u) then return jsonb_build_object('error', 'taken'); end if;
  insert into public.wordly_accounts(username, display_name, avatar, color, pass_hash)
  values (u, left(coalesce(nullif(trim(p_display), ''), u), 24), left(coalesce(p_avatar, '🦊'), 8), left(coalesce(p_color, 'green'), 16), extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
  returning * into a;
  insert into public.wordly_profiles(account_id) values (a.id);
  return jsonb_build_object('token', wordly_private.wordly_issue_session(a.id), 'account', wordly_private.wordly_account_json(a), 'profile', '{}'::jsonb);
end $$;

create or replace function public.wordly_acc_login(p_username text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a public.wordly_accounts;
begin
  select * into a from public.wordly_accounts where username = lower(trim(p_username));
  if not found then return jsonb_build_object('error', 'credentials'); end if;
  if a.locked_until is not null and a.locked_until > now() then return jsonb_build_object('error', 'locked', 'until', a.locked_until); end if;
  if a.pass_hash <> extensions.crypt(coalesce(p_password, ''), a.pass_hash) then
    update public.wordly_accounts set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else null end where id = a.id;
    return jsonb_build_object('error', case when a.failed + 1 >= 5 then 'locked' else 'credentials' end);
  end if;
  update public.wordly_accounts set failed = 0, locked_until = null where id = a.id;
  return jsonb_build_object('token', wordly_private.wordly_issue_session(a.id), 'account', wordly_private.wordly_account_json(a),
    'profile', coalesce((select data from public.wordly_profiles where account_id = a.id), '{}'::jsonb));
end $$;

create or replace function public.wordly_acc_me(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token); a public.wordly_accounts;
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  select * into a from public.wordly_accounts where id = me;
  return jsonb_build_object('account', wordly_private.wordly_account_json(a), 'profile', coalesce((select data from public.wordly_profiles where account_id = me), '{}'::jsonb));
end $$;

create or replace function public.wordly_acc_logout(p_token text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  update public.wordly_sessions set expires_at = now() where token_hash = wordly_private.wordly_hash(p_token);
  select jsonb_build_object('ok', true);
$$;

create or replace function public.wordly_acc_update(p_token text, p_display text, p_avatar text, p_color text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token); a public.wordly_accounts;
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  update public.wordly_accounts set
    display_name = left(coalesce(nullif(trim(p_display), ''), display_name), 24),
    avatar = left(coalesce(nullif(p_avatar, ''), avatar), 8),
    color = left(coalesce(nullif(p_color, ''), color), 16)
  where id = me returning * into a;
  return jsonb_build_object('account', wordly_private.wordly_account_json(a));
end $$;

create or replace function public.wordly_acc_password(p_token text, p_old text, p_new text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token); h text;
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  if char_length(coalesce(p_new, '')) < 6 or char_length(p_new) > 72 then return jsonb_build_object('error', 'password'); end if;
  select pass_hash into h from public.wordly_accounts where id = me;
  if h <> extensions.crypt(coalesce(p_old, ''), h) then return jsonb_build_object('error', 'credentials'); end if;
  update public.wordly_accounts set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 8)) where id = me;
  update public.wordly_sessions set expires_at = now() where account_id = me and token_hash <> wordly_private.wordly_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wordly_profile_save(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token);
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 400000 then return jsonb_build_object('error', 'size'); end if;
  insert into public.wordly_profiles(account_id, data, updated_at) values (me, p_data, now())
  on conflict (account_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true, 'savedAt', now());
end $$;

-- public summary of a player (for friend lists and profile cards)
create or replace function wordly_private.wordly_player_card(p_account uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', a.username, 'displayName', a.display_name, 'avatar', a.avatar, 'color', a.color,
    'xp', coalesce((p.data ->> 'xp')::int, 0), 'streak', coalesce(p.data -> 'streakCard', 'null'::jsonb), 'words', coalesce(jsonb_array_length(p.data -> 'words'), 0))
  from public.wordly_accounts a left join public.wordly_profiles p on p.account_id = a.id where a.id = p_account
$$;

create or replace function public.wordly_card(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select wordly_private.wordly_player_card(id) from public.wordly_accounts where username = lower(trim(p_username))), jsonb_build_object('error', 'missing'))
$$;

-- ───────── friends ─────────
create or replace function public.wordly_friend_add(p_token text, p_username text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token); other uuid;
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  select id into other from public.wordly_accounts where username = lower(trim(p_username));
  if other is null then return jsonb_build_object('error', 'missing'); end if;
  if other = me then return jsonb_build_object('error', 'self'); end if;
  insert into public.wordly_friends(a, b) values (least(me, other), greatest(me, other)) on conflict (a, b) do update set active = true, created_at = now();
  return jsonb_build_object('ok', true, 'friend', wordly_private.wordly_player_card(other));
end $$;

create or replace function public.wordly_friend_remove(p_token text, p_username text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token); other uuid;
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  select id into other from public.wordly_accounts where username = lower(trim(p_username));
  update public.wordly_friends set active = false where a = least(me, other) and b = greatest(me, other);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wordly_friends(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := wordly_private.wordly_session_account(p_token);
begin
  if me is null then return jsonb_build_object('error', 'session'); end if;
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(wordly_private.wordly_player_card(case when f.a = me then f.b else f.a end) order by f.created_at desc)
                         from public.wordly_friends f where f.active and (f.a = me or f.b = me)), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'lang', m.lang, 'length', m.length, 'maxAttempts', m.max_attempts,
                           'from', (select jsonb_build_object('name', s.name, 'avatar', s.avatar, 'color', s.color) from public.wordly_match_seats s where s.match_id = m.id and s.seat = 1),
                           'createdAt', m.created_at) order by m.created_at desc)
                         from public.wordly_matches m where m.invited = me and m.status = 'waiting' and m.created_at > now() - interval '2 days'), '[]'::jsonb));
end $$;

-- ───────── duels ─────────
create or replace function wordly_private.wordly_match_seat(p_id text, p_token text) returns int
language sql stable security definer set search_path = '' as $$
  select seat from public.wordly_match_seats where match_id = upper(p_id) and p_token is not null and token_hash = wordly_private.wordly_hash(p_token)
$$;

create or replace function wordly_private.wordly_match_json(m public.wordly_matches, p_seat int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'lang', m.lang, 'length', m.length, 'maxAttempts', m.max_attempts, 'difficulty', m.difficulty,
    'status', m.status, 'firstSeat', m.first_seat, 'turn', m.turn, 'rows', m.rows, 'winner', m.winner, 'result', m.result,
    'reactions', m.reactions, 'series', m.series, 'rematchId', m.rematch_id, 'version', m.version, 'mySeat', p_seat,
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'avatar', s.avatar, 'color', s.color,
              'online', s.last_seen > now() - interval '20 seconds') order by s.seat) from public.wordly_match_seats s where s.match_id = m.id), '[]'::jsonb),
    'answer', case when m.status = 'finished' then jsonb_build_object('w', m.secret, 'd', coalesce(m.display, m.secret), 'c', coalesce(m.category, ''), 'm', coalesce(m.meaning, ''),
              't', m.translation, 'p', m.pronunciation, 'e', m.example) else null end)
$$;

-- called by the wordly-match edge function only (service role): the AI picked and validated the word
create or replace function public.wordly_match_create_internal(p_cfg jsonb, p_word jsonb, p_prev text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text; i int; t text := wordly_private.wordly_new_token(); me uuid; inv uuid; first int; prev public.wordly_matches; m public.wordly_matches;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  loop
    code := '';
    for i in 1..6 loop code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.wordly_matches where id = code);
  end loop;
  if p_prev is not null then
    select * into prev from public.wordly_matches where id = p_prev for update;
    if not found then return jsonb_build_object('error', 'missing'); end if;
    if prev.rematch_id is not null then return jsonb_build_object('id', prev.rematch_id, 'existing', true); end if;
    first := 3 - prev.first_seat;
    insert into public.wordly_matches(id, lang, length, max_attempts, difficulty, secret, display, category, meaning, translation, pronunciation, example, status, first_seat, turn, series)
    values (code, prev.lang, prev.length, prev.max_attempts, prev.difficulty, p_word->>'word', p_word->>'display', p_word->>'category', p_word->>'meaning', p_word->>'translation', p_word->>'pronunciation', p_word->>'example',
            'playing', first, first, prev.series) returning * into m;
    insert into public.wordly_match_seats(match_id, seat, token_hash, name, avatar, color, account_id)
    select code, seat, token_hash, name, avatar, color, account_id from public.wordly_match_seats where match_id = p_prev;
    update public.wordly_matches set rematch_id = code, version = version + 1, updated_at = now() where id = p_prev;
    return jsonb_build_object('id', code, 'state', wordly_private.wordly_match_json(m, (p_cfg->>'seat')::int));
  end if;
  me := wordly_private.wordly_session_account(p_cfg->>'accountToken');
  if nullif(p_cfg->>'invite', '') is not null then select id into inv from public.wordly_accounts where username = lower(p_cfg->>'invite'); end if;
  first := case p_cfg->>'first' when 'guest' then 2 when 'random' then 1 + floor(random() * 2)::int else 1 end;
  insert into public.wordly_matches(id, lang, length, max_attempts, difficulty, secret, display, category, meaning, translation, pronunciation, example, first_seat, turn, invited)
  values (code, p_cfg->>'lang', (p_cfg->>'length')::int, nullif(p_cfg->>'maxAttempts', '')::int, coalesce(p_cfg->>'difficulty', 'normal'),
          p_word->>'word', p_word->>'display', p_word->>'category', p_word->>'meaning', p_word->>'translation', p_word->>'pronunciation', p_word->>'example', first, first, inv)
  returning * into m;
  insert into public.wordly_match_seats(match_id, seat, token_hash, name, avatar, color, account_id)
  values (code, 1, wordly_private.wordly_hash(t), left(coalesce(nullif(trim(p_cfg->>'name'), ''), 'Player 1'), 24), left(coalesce(p_cfg->>'avatar', '🦊'), 8), left(coalesce(p_cfg->>'color', 'green'), 16), me);
  return jsonb_build_object('id', code, 'token', t, 'state', wordly_private.wordly_match_json(m, 1));
end $$;

create or replace function public.wordly_match_join(p_id text, p_name text, p_avatar text, p_color text, p_account_token text default null, p_seat_token text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare m public.wordly_matches; s int := wordly_private.wordly_match_seat(p_id, p_seat_token); t text;
begin
  select * into m from public.wordly_matches where id = upper(p_id) for update;
  if not found then return jsonb_build_object('error', 'missing'); end if;
  if s is not null then
    update public.wordly_match_seats set last_seen = now() where match_id = m.id and seat = s;
    return jsonb_build_object('seat', s, 'token', p_seat_token, 'state', wordly_private.wordly_match_json(m, s));
  end if;
  if m.status <> 'waiting' or exists (select 1 from public.wordly_match_seats where match_id = m.id and seat = 2) then
    return jsonb_build_object('error', 'full', 'state', wordly_private.wordly_match_json(m, null));
  end if;
  t := wordly_private.wordly_new_token();
  insert into public.wordly_match_seats(match_id, seat, token_hash, name, avatar, color, account_id)
  values (m.id, 2, wordly_private.wordly_hash(t), left(coalesce(nullif(trim(p_name), ''), 'Player 2'), 24), left(coalesce(p_avatar, '🐼'), 8), left(coalesce(p_color, 'gold'), 16), wordly_private.wordly_session_account(p_account_token));
  update public.wordly_matches set status = 'playing', version = version + 1, updated_at = now() where id = m.id returning * into m;
  return jsonb_build_object('seat', 2, 'token', t, 'state', wordly_private.wordly_match_json(m, 2));
end $$;

create or replace function public.wordly_match_state(p_id text, p_seat_token text default null, p_since int default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare m public.wordly_matches; s int := wordly_private.wordly_match_seat(p_id, p_seat_token);
begin
  if s is not null then update public.wordly_match_seats set last_seen = now() where match_id = upper(p_id) and seat = s; end if;
  select * into m from public.wordly_matches where id = upper(p_id);
  if not found then return jsonb_build_object('error', 'missing'); end if;
  if p_since is not null and p_since = m.version then return jsonb_build_object('unchanged', true, 'version', m.version); end if;
  return wordly_private.wordly_match_json(m, s);
end $$;

create or replace function public.wordly_match_guess(p_id text, p_seat_token text, p_guess text, p_known boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare m public.wordly_matches; s int := wordly_private.wordly_match_seat(p_id, p_seat_token); pat text; n int; solved boolean;
begin
  if s is null then return jsonb_build_object('error', 'seat'); end if;
  select * into m from public.wordly_matches where id = upper(p_id) for update;
  if m.status <> 'playing' then return jsonb_build_object('error', 'status', 'state', wordly_private.wordly_match_json(m, s)); end if;
  if m.turn <> s then return jsonb_build_object('error', 'turn', 'state', wordly_private.wordly_match_json(m, s)); end if;
  if char_length(coalesce(p_guess, '')) <> m.length then return jsonb_build_object('error', 'length'); end if;
  if not coalesce(p_known, false) and p_guess <> m.secret then return jsonb_build_object('error', 'word'); end if;
  pat := public.wordly_evaluate(m.secret, p_guess);
  solved := pat = repeat('C', m.length);
  n := jsonb_array_length(m.rows) + 1;
  update public.wordly_matches set
    rows = rows || jsonb_build_array(jsonb_build_object('seat', s, 'guess', p_guess, 'pattern', pat, 'at', now())),
    status = case when solved or (max_attempts is not null and n >= max_attempts) then 'finished' else 'playing' end,
    winner = case when solved then s else null end,
    result = case when solved then 'win' when max_attempts is not null and n >= max_attempts then 'draw' else null end,
    series = case when solved then jsonb_set(series, array['s' || s], to_jsonb(coalesce((series ->> ('s' || s))::int, 0) + 1))
                  when max_attempts is not null and n >= max_attempts then jsonb_set(series, '{d}', to_jsonb(coalesce((series ->> 'd')::int, 0) + 1))
                  else series end,
    turn = 3 - s, version = version + 1, updated_at = now()
  where id = m.id returning * into m;
  return wordly_private.wordly_match_json(m, s);
end $$;

create or replace function public.wordly_match_react(p_id text, p_seat_token text, p_emoji text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s int := wordly_private.wordly_match_seat(p_id, p_seat_token); r jsonb;
begin
  if s is null then return jsonb_build_object('error', 'seat'); end if;
  if p_emoji not in ('😂', '🔥', '😮', '👏', '😤', '❤️') then return jsonb_build_object('error', 'emoji'); end if;
  update public.wordly_matches set
    reactions = (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(reactions || jsonb_build_array(jsonb_build_object('seat', s, 'e', p_emoji, 'n', version + 1))) x offset greatest(0, jsonb_array_length(reactions) + 1 - 12)) q),
    version = version + 1, updated_at = now()
  where id = upper(p_id) returning reactions into r;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wordly_match_resign(p_id text, p_seat_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare m public.wordly_matches; s int := wordly_private.wordly_match_seat(p_id, p_seat_token);
begin
  if s is null then return jsonb_build_object('error', 'seat'); end if;
  update public.wordly_matches set status = 'finished', winner = case when status = 'playing' then 3 - s else null end, result = 'resign',
    series = case when status = 'playing' then jsonb_set(series, array['s' || (3 - s)], to_jsonb(coalesce((series ->> ('s' || (3 - s)))::int, 0) + 1)) else series end,
    version = version + 1, updated_at = now()
  where id = upper(p_id) and status <> 'finished' returning * into m;
  if not found then select * into m from public.wordly_matches where id = upper(p_id); end if;
  return wordly_private.wordly_match_json(m, s);
end $$;

-- ───────── grants ─────────
grant execute on function
  public.wordly_acc_signup(text, text, text, text, text), public.wordly_acc_login(text, text), public.wordly_acc_me(text), public.wordly_acc_logout(text),
  public.wordly_acc_update(text, text, text, text), public.wordly_acc_password(text, text, text), public.wordly_profile_save(text, jsonb), public.wordly_card(text),
  public.wordly_friend_add(text, text), public.wordly_friend_remove(text, text), public.wordly_friends(text),
  public.wordly_match_join(text, text, text, text, text, text), public.wordly_match_state(text, text, int), public.wordly_match_guess(text, text, text, boolean),
  public.wordly_match_react(text, text, text), public.wordly_match_resign(text, text)
to anon, authenticated;
grant execute on function public.wordly_match_create_internal(jsonb, jsonb, text) to service_role;

-- follow-up (applied as wordly_card_wordcount): progress data stores words as a map, so the card reads wordCount
create or replace function wordly_private.wordly_player_card(p_account uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', a.username, 'displayName', a.display_name, 'avatar', a.avatar, 'color', a.color,
    'xp', coalesce((p.data ->> 'xp')::int, 0), 'streak', coalesce(p.data -> 'streakCard', 'null'::jsonb),
    'words', case when jsonb_typeof(p.data -> 'wordCount') = 'number' then (p.data ->> 'wordCount')::int
                  when jsonb_typeof(p.data -> 'words') = 'array' then jsonb_array_length(p.data -> 'words') else 0 end)
  from public.wordly_accounts a left join public.wordly_profiles p on p.account_id = a.id where a.id = p_account
$$;
