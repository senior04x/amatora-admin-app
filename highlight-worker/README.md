# AMATORA highlight worker

The mobile app sends only organization ID, the Top 5/10 size and ordered goal event IDs. The worker verifies the Supabase session and the organization owner, reads the clips from Supabase under the caller's RLS rules, and returns a single H.264/AAC MP4. The video includes the rank, player portrait or initials, name, team, shirt number and goal minute when those are available. The worker writes nothing to Supabase. Output is held temporarily for 15 minutes. Only one render runs at a time per replica.

Deploy this directory as an isolated Docker service. Set:

- `SUPABASE_URL`: the Amatora Supabase project HTTPS origin.
- `SUPABASE_ANON_KEY`: the public Supabase key (not the service role).
- `HIGHLIGHT_OWNERS`: JSON map of organization ID to independently verified owner Auth UUID, sourced from a protected binding. Refresh it after authorized owner changes. Do not derive it from a browser-supplied org or a mutable profile.
- `PORT`: host provided, defaults to 8080.
- Set `EXPO_PUBLIC_HIGHLIGHT_WORKER_URL` to the HTTPS worker origin when exporting the mobile app. The worker's SDK 54 playback page is restricted to public replay storage URLs.

`GET /health` reports whether any owner bindings are configured. For offline tests, use `node --test highlight-worker/render.test.mjs` from the app repository with FFmpeg/FFprobe and DejaVu Sans Bold available; `FFMPEG`, `FFPROBE`, and `HIGHLIGHT_FONT` can override local paths.
