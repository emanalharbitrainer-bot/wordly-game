-- WORDLY — Daily Challenge backend (Supabase / Postgres)
-- Hosted in the existing "tahsili-planner" project; every object is prefixed with wordly_.
--
-- Security model
--  * Tables have RLS enabled and NO policies → anon/authenticated cannot read or write them directly.
--  * The browser only calls two SECURITY DEFINER functions: wordly_daily_state / wordly_daily_guess.
--  * The secret word never leaves the database until the player's daily game is over.
--  * The server decides "today" (Asia/Riyadh), so a client cannot request future words.
--  * One session per (player, language, date) → the same daily cannot be replayed for new results.

create table if not exists public.wordly_daily_words (
  id            bigserial primary key,
  lang          text not null check (lang in ('ar', 'en')),
  word          text not null,
  display       text not null,
  category      text not null,
  meaning       text not null,
  translation   text,
  pronunciation text,
  example       text,
  created_at    timestamptz not null default now(),
  unique (lang, word)
);

create table if not exists public.wordly_daily_sessions (
  player_id      uuid not null,
  lang           text not null check (lang in ('ar', 'en')),
  challenge_date date not null,
  guesses        text[] not null default '{}',
  patterns       text[] not null default '{}',
  status         text not null default 'PLAYING' check (status in ('PLAYING', 'WON', 'LOST')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (player_id, lang, challenge_date)
);

alter table public.wordly_daily_words enable row level security;
alter table public.wordly_daily_sessions enable row level security;
revoke all on public.wordly_daily_words from anon, authenticated;
revoke all on public.wordly_daily_sessions from anon, authenticated;

-- Fixed epoch: challenge #1 is 2026-11-03 (launch day).
create or replace function public.wordly_epoch() returns date
language sql immutable set search_path = '' as $$ select date '2026-11-03' $$;

create or replace function public.wordly_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- Deterministic word for a language/date: words are put in a fixed pseudo-random order
-- (md5 of lang+word) and walked one per day, so there are no repeats within a cycle.
create or replace function public.wordly_word_for(p_lang text, p_date date)
returns public.wordly_daily_words
language plpgsql stable security definer set search_path = '' as $$
declare
  n int;
  idx int;
  w public.wordly_daily_words;
begin
  select count(*) into n from public.wordly_daily_words where lang = p_lang;
  if n = 0 then raise exception 'no daily words for %', p_lang; end if;
  idx := (((p_date - public.wordly_epoch()) % n) + n) % n;
  select * into w from public.wordly_daily_words
   where lang = p_lang order by md5(lang || ':' || word) offset idx limit 1;
  return w;
end $$;

-- Two-pass evaluation (identical to src/core/game/letter-evaluator.ts).
-- Returns one char per letter: C = correct, P = present, A = absent.
create or replace function public.wordly_evaluate(p_secret text, p_guess text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  s text[] := regexp_split_to_array(p_secret, '');
  g text[] := regexp_split_to_array(p_guess, '');
  res text[] := array_fill('A'::text, array[array_length(g, 1)]);
  remaining jsonb := '{}'::jsonb;
  i int;
  left_count int;
begin
  for i in 1..array_length(s, 1) loop
    if g[i] = s[i] then
      res[i] := 'C';
    else
      remaining := jsonb_set(remaining, array[s[i]], to_jsonb(coalesce((remaining ->> s[i])::int, 0) + 1));
    end if;
  end loop;
  for i in 1..array_length(g, 1) loop
    continue when res[i] = 'C';
    left_count := coalesce((remaining ->> g[i])::int, 0);
    if left_count > 0 then
      res[i] := 'P';
      remaining := jsonb_set(remaining, array[g[i]], to_jsonb(left_count - 1));
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

create or replace function public.wordly_answer_json(w public.wordly_daily_words)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('word', w.word, 'display', w.display, 'category', w.category, 'meaning', w.meaning,
                            'translation', w.translation, 'pronunciation', w.pronunciation, 'example', w.example)
$$;

-- Returns (and lazily creates) today's session for this player.
create or replace function public.wordly_daily_state(p_player uuid, p_lang text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d date := public.wordly_today();
  sess public.wordly_daily_sessions;
  w public.wordly_daily_words;
begin
  if p_player is null or p_lang not in ('ar', 'en') then raise exception 'invalid request'; end if;
  insert into public.wordly_daily_sessions (player_id, lang, challenge_date)
  values (p_player, p_lang, d) on conflict do nothing;
  select * into sess from public.wordly_daily_sessions where player_id = p_player and lang = p_lang and challenge_date = d;
  w := public.wordly_word_for(p_lang, d);
  return jsonb_build_object(
    'date', d,
    'number', (d - public.wordly_epoch()) + 1,
    'length', char_length(w.word),
    'max_attempts', 6,
    'guesses', to_jsonb(sess.guesses),
    'patterns', to_jsonb(sess.patterns),
    'status', sess.status,
    'answer', case when sess.status <> 'PLAYING' then public.wordly_answer_json(w) end
  );
end $$;

-- Submits one guess. Row-locked, so concurrent / duplicate requests cannot double-count.
create or replace function public.wordly_daily_guess(p_player uuid, p_lang text, p_guess text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d date := public.wordly_today();
  sess public.wordly_daily_sessions;
  w public.wordly_daily_words;
  pattern text;
  new_status text;
begin
  if p_player is null or p_lang not in ('ar', 'en') then raise exception 'invalid request'; end if;
  if (p_lang = 'en' and p_guess !~ '^[a-z]{5}$')
     or (p_lang = 'ar' and p_guess !~ '^[ءؤئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي]{5}$') then
    raise exception 'invalid guess';
  end if;
  select * into sess from public.wordly_daily_sessions
   where player_id = p_player and lang = p_lang and challenge_date = d for update;
  if not found then raise exception 'session not started'; end if;
  if sess.status <> 'PLAYING' or coalesce(array_length(sess.guesses, 1), 0) >= 6 then
    raise exception 'game over';
  end if;
  w := public.wordly_word_for(p_lang, d);
  pattern := public.wordly_evaluate(w.word, p_guess);
  new_status := case when pattern = 'CCCCC' then 'WON'
                     when coalesce(array_length(sess.guesses, 1), 0) + 1 >= 6 then 'LOST'
                     else 'PLAYING' end;
  update public.wordly_daily_sessions
     set guesses = guesses || p_guess, patterns = patterns || pattern, status = new_status, updated_at = now()
   where player_id = p_player and lang = p_lang and challenge_date = d;
  return jsonb_build_object(
    'pattern', pattern,
    'status', new_status,
    'attempt', coalesce(array_length(sess.guesses, 1), 0) + 1,
    'answer', case when new_status <> 'PLAYING' then public.wordly_answer_json(w) end
  );
end $$;

revoke all on function public.wordly_word_for(text, date) from public, anon, authenticated;
revoke all on function public.wordly_evaluate(text, text) from public, anon, authenticated;
revoke all on function public.wordly_answer_json(public.wordly_daily_words) from public, anon, authenticated;
revoke all on function public.wordly_daily_state(uuid, text) from public;
revoke all on function public.wordly_daily_guess(uuid, text, text) from public;
grant execute on function public.wordly_daily_state(uuid, text) to anon, authenticated;
grant execute on function public.wordly_daily_guess(uuid, text, text) to anon, authenticated;
