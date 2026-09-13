-- DaBound — "did the schema land?" check
--
-- Paste this into the same Supabase window you used for supabase_schema.sql
-- (Dashboard → SQL Editor → New query → Run). It returns rows, so you get a real
-- result table instead of "No rows returned".
--
-- Expected result: three rows — destinations (4 columns), jeepneys (6), routes (4).

select table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema = t.table_schema and c.table_name = t.table_name) as columns
from information_schema.tables t
where table_schema = 'public'
  and table_name in ('routes', 'jeepneys', 'destinations')
order by table_name;

-- Optional: prove row-level security is on for all three (rls_enabled = true).
-- With no policies attached, only the service_role key can touch the tables.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('routes', 'jeepneys', 'destinations')
order by relname;

-- Optional: the tables start empty. After the app runs once against this project,
-- destinations will hold the 16 suggestions while routes/jeepneys stay empty until
-- you (the admin) create them.
select 'routes' as table_name, count(*) from public.routes
union all select 'jeepneys', count(*) from public.jeepneys
union all select 'destinations', count(*) from public.destinations;
