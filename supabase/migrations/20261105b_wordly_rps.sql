
-- ───────── Rock-Paper-Scissors starter (server-decided, persisted) ─────────
alter table public.wordly_matches add column if not exists rps jsonb;

-- 0 = rock, 1 = paper, 2 = scissors. Unbiased secure randomness (rejection sampling on random bytes).
create or replace function wordly_private.wordly_rps_pick() returns int
language plpgsql volatile set search_path = '' as $$
declare b int;
begin
  loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    exit when b < 255;
  end loop;
  return b % 3;
end $$;

-- Rounds until someone wins (ties replay; capped so it always terminates). (c1 - c2 + 3) % 3 = 1 → seat 1 wins.
create or replace function wordly_private.wordly_rps() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare rounds jsonb := '[]'::jsonb; a int; b int; i int := 0;
begin
  loop
    i := i + 1;
    a := wordly_private.wordly_rps_pick();
    b := wordly_private.wordly_rps_pick();
    if i >= 6 and a = b then b := (a + 1 + floor(random() * 2)::int) % 3; end if;
    rounds := rounds || jsonb_build_array(jsonb_build_array(a, b));
    exit when a <> b;
  end loop;
  return jsonb_build_object('rounds', rounds, 'winner', case when (a - b + 3) % 3 = 1 then 1 else 2 end);
end $$;

create or replace function wordly_private.wordly_match_json(m public.wordly_matches, p_seat int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'lang', m.lang, 'length', m.length, 'maxAttempts', m.max_attempts, 'difficulty', m.difficulty,
    'status', m.status, 'firstSeat', m.first_seat, 'turn', m.turn, 'rows', m.rows, 'winner', m.winner, 'result', m.result,
    'reactions', m.reactions, 'series', m.series, 'rematchId', m.rematch_id, 'version', m.version, 'mySeat', p_seat, 'rps', m.rps,
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'avatar', s.avatar, 'color', s.color,
              'online', s.last_seen > now() - interval '20 seconds') order by s.seat) from public.wordly_match_seats s where s.match_id = m.id), '[]'::jsonb),
    'answer', case when m.status = 'finished' then jsonb_build_object('w', m.secret, 'd', coalesce(m.display, m.secret), 'c', coalesce(m.category, ''), 'm', coalesce(m.meaning, ''),
              't', m.translation, 'p', m.pronunciation, 'e', m.example) else null end)
$$;

create or replace function public.wordly_match_join(p_id text, p_name text, p_avatar text, p_color text, p_account_token text default null, p_seat_token text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare m public.wordly_matches; s int := wordly_private.wordly_match_seat(p_id, p_seat_token); t text; r jsonb;
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
  r := wordly_private.wordly_rps();
  update public.wordly_matches set status = 'playing', rps = r, first_seat = (r->>'winner')::int, turn = (r->>'winner')::int,
    version = version + 1, updated_at = now() where id = m.id returning * into m;
  return jsonb_build_object('seat', 2, 'token', t, 'state', wordly_private.wordly_match_json(m, 2));
end $$;

create or replace function public.wordly_match_create_internal(p_cfg jsonb, p_word jsonb, p_prev text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text; i int; t text := wordly_private.wordly_new_token(); me uuid; inv uuid; first int; prev public.wordly_matches; m public.wordly_matches; r jsonb;
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
    r := wordly_private.wordly_rps();
    first := (r->>'winner')::int;
    insert into public.wordly_matches(id, lang, length, max_attempts, difficulty, secret, display, category, meaning, translation, pronunciation, example, status, first_seat, turn, series, rps)
    values (code, prev.lang, prev.length, prev.max_attempts, prev.difficulty, p_word->>'word', p_word->>'display', p_word->>'category', p_word->>'meaning', p_word->>'translation', p_word->>'pronunciation', p_word->>'example',
            'playing', first, first, prev.series, r) returning * into m;
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
