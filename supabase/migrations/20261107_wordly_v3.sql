-- WORDLY 3.0 — weekly league, private groups, hard-mode daily, archive, daily stats, metrics.
-- Additive only: no table, column or function is removed. Same security model as before:
--  * every new table has RLS enabled and NO policies (unreachable from the browser);
--  * the browser only calls SECURITY DEFINER functions in `public`, which validate every input;
--  * shared helpers live in `wordly_private`, a schema the anon role cannot use;
--  * league points are computed ONLY here, inside the same transaction that finishes a daily game.

-- ───────── schema changes ─────────
alter table public.wordly_daily_sessions add column if not exists hard boolean not null default false;
alter table public.wordly_daily_sessions add column if not exists finished_at timestamptz;
alter table public.wordly_daily_words add column if not exists root text;

create table if not exists public.wordly_league_members (
  player_id  uuid primary key,
  handle     text not null unique,
  name       text not null check (char_length(name) between 1 and 24),
  avatar     text not null default '🦊',
  color      text not null default 'green',
  tier       smallint not null default 1 check (tier between 1 and 5),
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wordly_league_weeks (
  player_id      uuid not null,
  week_start     date not null,
  tier           smallint not null default 1 check (tier between 1 and 5),
  cohort         int,
  points         int not null default 0,
  wins           int not null default 0,
  games          int not null default 0,
  seated_at      timestamptz,
  final_rank     int,
  outcome        text check (outcome in ('up', 'stay', 'down')),
  reward_claimed boolean not null default false,
  primary key (player_id, week_start)
);
create index if not exists wordly_league_weeks_cohort on public.wordly_league_weeks (week_start, tier, cohort);

create table if not exists public.wordly_groups (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name       text not null check (char_length(name) between 2 and 24),
  owner      uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wordly_group_members (
  group_id  uuid not null references public.wordly_groups(id),
  player_id uuid not null,
  active    boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (group_id, player_id)
);
create index if not exists wordly_group_members_player on public.wordly_group_members (player_id);

create table if not exists public.wordly_metrics (
  day   date not null,
  event text not null,
  dim   text not null default '',
  n     int not null default 0,
  primary key (day, event, dim)
);

alter table public.wordly_league_members enable row level security;
alter table public.wordly_league_weeks enable row level security;
alter table public.wordly_groups enable row level security;
alter table public.wordly_group_members enable row level security;
alter table public.wordly_metrics enable row level security;

-- ───────── private helpers ─────────
create schema if not exists wordly_private;

-- Weeks start on Sunday (Riyadh calendar).
create or replace function wordly_private.wordly_week_of(d date) returns date
language sql immutable set search_path = '' as $$ select d - extract(dow from d)::int $$;

-- Daily points: win = 10 + 2 × (6 − attempts) → 10..20, loss = 2; hard mode × 1.5.
create or replace function wordly_private.wordly_league_points(p_won boolean, p_attempts int, p_hard boolean) returns int
language sql immutable set search_path = '' as $$
  select (case when p_won then 10 + 2 * (6 - least(greatest(p_attempts, 1), 6)) else 2 end)
         * (case when p_hard then 3 else 2 end) / 2
$$;

create or replace function wordly_private.wordly_clean_name(p text) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]​-‏‪-‮⁦-⁩]', '', 'g'), '\s+', ' ', 'g')), 24)
$$;

-- Hard-mode check, identical to src/core/difficulty/difficulty-engine.ts (level "hard"):
-- greens stay in place, every revealed letter is reused (as many times as revealed), and a
-- yellow letter may not sit where it was already yellow. Returns null when the guess is allowed.
create or replace function wordly_private.wordly_hard_violation(p_guesses text[], p_patterns text[], p_guess text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  g text[] := regexp_split_to_array(p_guess, '');
  prev text[];
  pat text[];
  i int;
  j int;
  k int;
  need int;
  have int;
begin
  if p_guesses is null or coalesce(array_length(p_guesses, 1), 0) = 0 then return null; end if;
  for i in 1..array_length(p_guesses, 1) loop
    prev := regexp_split_to_array(p_guesses[i], '');
    pat := regexp_split_to_array(p_patterns[i], '');
    for j in 1..array_length(prev, 1) loop
      if pat[j] = 'C' and g[j] is distinct from prev[j] then return 'must_keep_correct'; end if;
    end loop;
    for j in 1..array_length(prev, 1) loop
      continue when pat[j] not in ('C', 'P');
      need := 0;
      have := 0;
      for k in 1..array_length(prev, 1) loop
        if prev[k] = prev[j] and pat[k] in ('C', 'P') then need := need + 1; end if;
      end loop;
      for k in 1..array_length(g, 1) loop
        if g[k] = prev[j] then have := have + 1; end if;
      end loop;
      if have < need then return 'must_include'; end if;
      if pat[j] = 'P' and g[j] = prev[j] then return 'must_move_present'; end if;
    end loop;
  end loop;
  return null;
end $$;

-- Closes every finished (past) week of a player that is not closed yet and moves their tier.
create or replace function wordly_private.wordly_league_settle(p_player uuid) returns void
language plpgsql volatile set search_path = '' as $$
declare
  cur date := wordly_private.wordly_week_of(public.wordly_today());
  r public.wordly_league_weeks;
  n int;
  rk int;
  res text;
begin
  for r in select * from public.wordly_league_weeks
            where player_id = p_player and week_start < cur and outcome is null
            order by week_start loop
    if r.cohort is null then
      update public.wordly_league_weeks set outcome = 'stay' where player_id = p_player and week_start = r.week_start;
      continue;
    end if;
    select count(*) into n from public.wordly_league_weeks
     where week_start = r.week_start and tier = r.tier and cohort = r.cohort;
    select x.rnk into rk from (
      select w.player_id, rank() over (order by w.points desc, w.wins desc, w.seated_at asc) as rnk
        from public.wordly_league_weeks w
       where w.week_start = r.week_start and w.tier = r.tier and w.cohort = r.cohort
    ) x where x.player_id = p_player;
    res := case when rk <= 3 and r.points > 0 and r.tier < 5 then 'up'
                when n >= 8 and rk > n - 3 and r.tier > 1 then 'down'
                else 'stay' end;
    update public.wordly_league_weeks set outcome = res, final_rank = rk
     where player_id = p_player and week_start = r.week_start;
    update public.wordly_league_members
       set tier = r.tier + case res when 'up' then 1 when 'down' then -1 else 0 end, updated_at = now()
     where player_id = p_player;
  end loop;
end $$;

-- Makes sure a member has this week's row and a seat in a cohort of up to 20 players of their tier.
create or replace function wordly_private.wordly_league_seat(p_player uuid) returns public.wordly_league_weeks
language plpgsql volatile set search_path = '' as $$
declare
  cur date := wordly_private.wordly_week_of(public.wordly_today());
  m public.wordly_league_members;
  w public.wordly_league_weeks;
  c int;
begin
  select * into m from public.wordly_league_members where player_id = p_player;
  if not found then return null; end if;
  perform wordly_private.wordly_league_settle(p_player);
  select * into m from public.wordly_league_members where player_id = p_player;
  insert into public.wordly_league_weeks (player_id, week_start, tier) values (p_player, cur, m.tier)
  on conflict (player_id, week_start) do nothing;
  select * into w from public.wordly_league_weeks where player_id = p_player and week_start = cur for update;
  if w.cohort is null then
    perform pg_advisory_xact_lock(hashtext('wordly_league:' || cur::text || ':' || m.tier::text));
    select x.cohort into c from (
      select cohort, count(*) as size from public.wordly_league_weeks
       where week_start = cur and tier = m.tier and cohort is not null
       group by cohort
    ) x where x.size < 20 order by x.cohort limit 1;
    if c is null then
      select coalesce(max(cohort), 0) + 1 into c from public.wordly_league_weeks where week_start = cur and tier = m.tier;
    end if;
    update public.wordly_league_weeks set cohort = c, tier = m.tier, seated_at = now()
     where player_id = p_player and week_start = cur
    returning * into w;
  end if;
  return w;
end $$;

-- Adds a finished daily game to the player's week. Points are kept even before they join the league.
create or replace function wordly_private.wordly_league_award(p_player uuid, p_date date, p_won boolean, p_attempts int, p_hard boolean) returns int
language plpgsql volatile set search_path = '' as $$
declare
  pts int := wordly_private.wordly_league_points(p_won, p_attempts, p_hard);
  wk date := wordly_private.wordly_week_of(p_date);
  t smallint;
begin
  perform wordly_private.wordly_league_settle(p_player);
  select tier into t from public.wordly_league_members where player_id = p_player;
  insert into public.wordly_league_weeks (player_id, week_start, tier, points, wins, games)
  values (p_player, wk, coalesce(t, 1), pts, case when p_won then 1 else 0 end, 1)
  on conflict (player_id, week_start) do update
    set points = public.wordly_league_weeks.points + excluded.points,
        wins = public.wordly_league_weeks.wins + excluded.wins,
        games = public.wordly_league_weeks.games + 1;
  if t is not null then perform wordly_private.wordly_league_seat(p_player); end if;
  return pts;
end $$;

create or replace function wordly_private.wordly_session_json(sess public.wordly_daily_sessions, w public.wordly_daily_words) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'date', sess.challenge_date,
    'number', (sess.challenge_date - public.wordly_epoch()) + 1,
    'length', char_length(w.word),
    'max_attempts', 6,
    'guesses', to_jsonb(sess.guesses),
    'patterns', to_jsonb(sess.patterns),
    'status', sess.status,
    'hard', sess.hard,
    'archive', sess.challenge_date < public.wordly_today(),
    'answer', case when sess.status <> 'PLAYING' then public.wordly_answer_json(w) || jsonb_build_object('root', w.root) end
  )
$$;

create or replace function wordly_private.wordly_open(p_player uuid, p_lang text, p_date date) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  sess public.wordly_daily_sessions;
begin
  if p_player is null or p_lang not in ('ar', 'en') then raise exception 'invalid request'; end if;
  if p_date is null or p_date < public.wordly_epoch() or p_date > public.wordly_today() then raise exception 'invalid date'; end if;
  insert into public.wordly_daily_sessions (player_id, lang, challenge_date)
  values (p_player, p_lang, p_date) on conflict do nothing;
  select * into sess from public.wordly_daily_sessions where player_id = p_player and lang = p_lang and challenge_date = p_date;
  return wordly_private.wordly_session_json(sess, public.wordly_word_for(p_lang, p_date));
end $$;

-- One guess for any daily date (today or archive). Row-locked; league points only for today.
create or replace function wordly_private.wordly_play(p_player uuid, p_lang text, p_date date, p_guess text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  sess public.wordly_daily_sessions;
  w public.wordly_daily_words;
  pattern text;
  new_status text;
  attempt int;
  pts int := null;
begin
  if p_player is null or p_lang not in ('ar', 'en') then raise exception 'invalid request'; end if;
  if p_date is null or p_date < public.wordly_epoch() or p_date > public.wordly_today() then raise exception 'invalid date'; end if;
  if (p_lang = 'en' and p_guess !~ '^[a-z]{5}$')
     or (p_lang = 'ar' and p_guess !~ '^[ءؤئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي]{5}$') then
    raise exception 'invalid guess';
  end if;
  select * into sess from public.wordly_daily_sessions
   where player_id = p_player and lang = p_lang and challenge_date = p_date for update;
  if not found then raise exception 'session not started'; end if;
  if sess.status <> 'PLAYING' or coalesce(array_length(sess.guesses, 1), 0) >= 6 then raise exception 'game over'; end if;
  if sess.hard and wordly_private.wordly_hard_violation(sess.guesses, sess.patterns, p_guess) is not null then
    raise exception 'hard mode violation: %', wordly_private.wordly_hard_violation(sess.guesses, sess.patterns, p_guess);
  end if;
  w := public.wordly_word_for(p_lang, p_date);
  pattern := public.wordly_evaluate(w.word, p_guess);
  attempt := coalesce(array_length(sess.guesses, 1), 0) + 1;
  new_status := case when pattern = 'CCCCC' then 'WON' when attempt >= 6 then 'LOST' else 'PLAYING' end;
  update public.wordly_daily_sessions
     set guesses = guesses || p_guess, patterns = patterns || pattern, status = new_status, updated_at = now(),
         finished_at = case when new_status <> 'PLAYING' then now() end
   where player_id = p_player and lang = p_lang and challenge_date = p_date;
  if new_status <> 'PLAYING' and p_date = public.wordly_today() then
    pts := wordly_private.wordly_league_award(p_player, p_date, new_status = 'WON', attempt, sess.hard);
  end if;
  return jsonb_build_object(
    'pattern', pattern,
    'status', new_status,
    'attempt', attempt,
    'hard', sess.hard,
    'points', pts,
    'answer', case when new_status <> 'PLAYING' then public.wordly_answer_json(w) || jsonb_build_object('root', w.root) end
  );
end $$;

create or replace function wordly_private.wordly_new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.wordly_groups where code = c);
  end loop;
  return c;
end $$;

create or replace function wordly_private.wordly_member_json(m public.wordly_league_members) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('handle', m.handle, 'name', m.name, 'avatar', m.avatar, 'color', m.color, 'tier', m.tier)
$$;

-- ───────── public API: daily + archive ─────────
create or replace function public.wordly_daily_state(p_player uuid, p_lang text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return wordly_private.wordly_open(p_player, p_lang, public.wordly_today());
end $$;

create or replace function public.wordly_daily_guess(p_player uuid, p_lang text, p_guess text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return wordly_private.wordly_play(p_player, p_lang, public.wordly_today(), p_guess);
end $$;

create or replace function public.wordly_archive_state(p_player uuid, p_lang text, p_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_date >= public.wordly_today() then raise exception 'invalid date'; end if;
  return wordly_private.wordly_open(p_player, p_lang, p_date);
end $$;

create or replace function public.wordly_archive_guess(p_player uuid, p_lang text, p_date date, p_guess text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_date >= public.wordly_today() then raise exception 'invalid date'; end if;
  return wordly_private.wordly_play(p_player, p_lang, p_date, p_guess);
end $$;

-- Every past challenge with this player's result (newest first).
create or replace function public.wordly_archive_list(p_player uuid, p_lang text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_player is null or p_lang not in ('ar', 'en') then raise exception 'invalid request'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'date', d::date,
             'number', (d::date - public.wordly_epoch()) + 1,
             'status', coalesce(s.status, 'NEW'),
             'attempts', coalesce(array_length(s.guesses, 1), 0),
             'hard', coalesce(s.hard, false)) order by d desc)
      from generate_series(public.wordly_epoch(), public.wordly_today() - 1, interval '1 day') d
      left join public.wordly_daily_sessions s
        on s.player_id = p_player and s.lang = p_lang and s.challenge_date = d::date
  ), '[]'::jsonb);
end $$;

-- Hard mode can only change before the first guess.
create or replace function public.wordly_daily_set_hard(p_player uuid, p_lang text, p_date date, p_hard boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sess public.wordly_daily_sessions;
begin
  perform wordly_private.wordly_open(p_player, p_lang, p_date);
  select * into sess from public.wordly_daily_sessions
   where player_id = p_player and lang = p_lang and challenge_date = p_date for update;
  if coalesce(array_length(sess.guesses, 1), 0) > 0 or sess.status <> 'PLAYING' then raise exception 'hard mode locked'; end if;
  update public.wordly_daily_sessions set hard = coalesce(p_hard, false), updated_at = now()
   where player_id = p_player and lang = p_lang and challenge_date = p_date
  returning * into sess;
  return wordly_private.wordly_session_json(sess, public.wordly_word_for(p_lang, p_date));
end $$;

-- How everyone who finished that challenge did. Only for a player who finished it too.
create or replace function public.wordly_daily_stats(p_player uuid, p_lang text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  mine public.wordly_daily_sessions;
begin
  select * into mine from public.wordly_daily_sessions where player_id = p_player and lang = p_lang and challenge_date = p_date;
  if not found or mine.status = 'PLAYING' then raise exception 'not finished'; end if;
  return (
    select jsonb_build_object(
      'total', count(*),
      'lost', count(*) filter (where status = 'LOST'),
      'dist', jsonb_build_object(
        '1', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 1),
        '2', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 2),
        '3', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 3),
        '4', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 4),
        '5', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 5),
        '6', count(*) filter (where status = 'WON' and array_length(guesses, 1) = 6)))
      from public.wordly_daily_sessions
     where lang = p_lang and challenge_date = p_date and status <> 'PLAYING'
  );
end $$;

-- ───────── public API: league ─────────
create or replace function public.wordly_league_join(p_player uuid, p_name text, p_avatar text, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  nm text := wordly_private.wordly_clean_name(p_name);
  h text;
begin
  if p_player is null then raise exception 'invalid request'; end if;
  if char_length(nm) < 1 then raise exception 'name required'; end if;
  if char_length(coalesce(p_avatar, '')) not between 1 and 8 or coalesce(p_color, '') !~ '^[a-z]{3,10}$' then raise exception 'invalid profile'; end if;
  if exists (select 1 from public.wordly_league_members where player_id = p_player) then
    update public.wordly_league_members set name = nm, avatar = p_avatar, color = p_color, updated_at = now() where player_id = p_player;
  else
    loop
      h := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
      exit when not exists (select 1 from public.wordly_league_members where handle = h);
    end loop;
    insert into public.wordly_league_members (player_id, handle, name, avatar, color) values (p_player, h, nm, p_avatar, p_color);
  end if;
  return public.wordly_league_state(p_player);
end $$;

create or replace function public.wordly_league_state(p_player uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cur date := wordly_private.wordly_week_of(public.wordly_today());
  m public.wordly_league_members;
  w public.wordly_league_weeks;
  last public.wordly_league_weeks;
  board jsonb;
  pending int;
begin
  if p_player is null then raise exception 'invalid request'; end if;
  select * into m from public.wordly_league_members where player_id = p_player;
  if not found then
    select points into pending from public.wordly_league_weeks where player_id = p_player and week_start = cur;
    return jsonb_build_object('member', false, 'week_start', cur, 'week_end', cur + 7, 'points', coalesce(pending, 0));
  end if;
  w := wordly_private.wordly_league_seat(p_player);
  select * into m from public.wordly_league_members where player_id = p_player;
  select coalesce(jsonb_agg(x.row order by x.rnk, x.seated_at), '[]'::jsonb) into board from (
    select rank() over (order by lw.points desc, lw.wins desc, lw.seated_at asc) as rnk, lw.seated_at,
           jsonb_build_object('rank', rank() over (order by lw.points desc, lw.wins desc, lw.seated_at asc),
                              'handle', lm.handle, 'name', lm.name, 'avatar', lm.avatar, 'color', lm.color,
                              'points', lw.points, 'wins', lw.wins, 'games', lw.games, 'me', lw.player_id = p_player) as row
      from public.wordly_league_weeks lw
      join public.wordly_league_members lm on lm.player_id = lw.player_id
     where lw.week_start = cur and lw.tier = w.tier and lw.cohort = w.cohort
  ) x;
  select * into last from public.wordly_league_weeks
   where player_id = p_player and week_start < cur and outcome is not null and cohort is not null
   order by week_start desc limit 1;
  return jsonb_build_object(
    'member', true,
    'me', wordly_private.wordly_member_json(m),
    'week_start', cur,
    'week_end', cur + 7,
    'tier', w.tier,
    'points', w.points,
    'board', board,
    'last', case when last.player_id is null then null else jsonb_build_object(
      'week_start', last.week_start, 'tier', last.tier, 'rank', last.final_rank, 'outcome', last.outcome,
      'points', last.points, 'reward', last.final_rank <= 3 and last.points > 0, 'claimed', last.reward_claimed) end
  );
end $$;

-- Marks last week's top-3 reward as received (once). The client grants the shield/coins on success.
create or replace function public.wordly_league_claim(p_player uuid, p_week date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform wordly_private.wordly_league_settle(p_player);
  update public.wordly_league_weeks set reward_claimed = true
   where player_id = p_player and week_start = p_week and final_rank <= 3 and points > 0 and not reward_claimed;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;

-- ───────── public API: private groups ─────────
create or replace function public.wordly_group_create(p_player uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  nm text := wordly_private.wordly_clean_name(p_name);
  g public.wordly_groups;
begin
  if not exists (select 1 from public.wordly_league_members where player_id = p_player) then raise exception 'join league first'; end if;
  if char_length(nm) < 2 then raise exception 'invalid name'; end if;
  if (select count(*) from public.wordly_groups where owner = p_player and created_at > now() - interval '1 day') >= 5 then raise exception 'too many groups today'; end if;
  if (select count(*) from public.wordly_group_members where player_id = p_player and active) >= 10 then raise exception 'too many groups'; end if;
  insert into public.wordly_groups (code, name, owner) values (wordly_private.wordly_new_code(), nm, p_player) returning * into g;
  insert into public.wordly_group_members (group_id, player_id) values (g.id, p_player);
  return public.wordly_group_board(p_player, g.code);
end $$;

create or replace function public.wordly_group_join(p_player uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.wordly_groups;
begin
  if not exists (select 1 from public.wordly_league_members where player_id = p_player) then raise exception 'join league first'; end if;
  select * into g from public.wordly_groups where code = upper(btrim(p_code));
  if not found then raise exception 'group not found'; end if;
  if not exists (select 1 from public.wordly_group_members where group_id = g.id and player_id = p_player and active) then
    if (select count(*) from public.wordly_group_members where group_id = g.id and active) >= 50 then raise exception 'group full'; end if;
    if (select count(*) from public.wordly_group_members where player_id = p_player and active) >= 10 then raise exception 'too many groups'; end if;
    insert into public.wordly_group_members (group_id, player_id) values (g.id, p_player)
    on conflict (group_id, player_id) do update set active = true, joined_at = now();
  end if;
  return public.wordly_group_board(p_player, g.code);
end $$;

create or replace function public.wordly_group_leave(p_player uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.wordly_group_members gm set active = false
    from public.wordly_groups g
   where g.code = upper(btrim(p_code)) and gm.group_id = g.id and gm.player_id = p_player;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wordly_group_board(p_player uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cur date := wordly_private.wordly_week_of(public.wordly_today());
  g public.wordly_groups;
  board jsonb;
begin
  select * into g from public.wordly_groups where code = upper(btrim(p_code));
  if not found then raise exception 'group not found'; end if;
  if not exists (select 1 from public.wordly_group_members where group_id = g.id and player_id = p_player and active) then raise exception 'not a member'; end if;
  select coalesce(jsonb_agg(x.row order by x.pts desc, x.wins desc, x.joined_at), '[]'::jsonb) into board from (
    select coalesce(lw.points, 0) as pts, coalesce(lw.wins, 0) as wins, gm.joined_at,
           jsonb_build_object('rank', rank() over (order by coalesce(lw.points, 0) desc, coalesce(lw.wins, 0) desc),
                              'handle', lm.handle, 'name', lm.name, 'avatar', lm.avatar, 'color', lm.color, 'tier', lm.tier,
                              'points', coalesce(lw.points, 0), 'wins', coalesce(lw.wins, 0), 'me', gm.player_id = p_player) as row
      from public.wordly_group_members gm
      join public.wordly_league_members lm on lm.player_id = gm.player_id
      left join public.wordly_league_weeks lw on lw.player_id = gm.player_id and lw.week_start = cur
     where gm.group_id = g.id and gm.active
  ) x;
  return jsonb_build_object('code', g.code, 'name', g.name, 'owner', g.owner = p_player, 'week_start', cur, 'week_end', cur + 7, 'board', board);
end $$;

create or replace function public.wordly_groups_mine(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name,
             'members', (select count(*) from public.wordly_group_members x where x.group_id = g.id and x.active)) order by gm.joined_at)
      from public.wordly_group_members gm join public.wordly_groups g on g.id = gm.group_id
     where gm.player_id = p_player and gm.active
  ), '[]'::jsonb);
end $$;

-- ───────── public API: anonymous metrics ─────────
create or replace function public.wordly_track(p_event text, p_dim text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dim text := left(lower(coalesce(p_dim, '')), 24);
begin
  if p_event not in ('app_open', 'game_start', 'game_end', 'share', 'league_join', 'group_create', 'group_join',
                     'tutorial_done', 'archive_play', 'speed_run', 'pack_play', 'hard_on') then
    return;
  end if;
  if v_dim !~ '^[a-z0-9_:-]*$' then v_dim := ''; end if;
  insert into public.wordly_metrics (day, event, dim, n) values (public.wordly_today(), p_event, v_dim, 1)
  on conflict (day, event, dim) do update set n = public.wordly_metrics.n + 1;
end $$;
