# Paper board + Songbook API

Two pages on GitHub Pages share this one Worker and D1 database, so every device
sees the same data. Nothing is readable without the password.

- **Paper board** (`board/` → alighavam.com/board/): cards + cover images.
- **Songbook** (`songs/` → alighavam.com/songs/): guitar songs, one row per song.

```
Browser → board-api.alighavam.com (this Worker) → D1

Paper board
  POST /login          password → 180-day token (stored in the browser)
  GET  /board          all cards
  PUT  /cards/:id      create / update a card
  DELETE /cards/:id    delete a card (and its cover)
  POST /images         upload a cover → id
  GET  /images/:id     cover bytes

Songbook
  POST /songs/login    password → 180-day songs token
  GET  /songs          all songs, in order
  PUT  /songs/:id      create / update a song
  DELETE /songs/:id    delete a song
  PUT  /songs          replace every song (import, clear examples)
```

Tokens are scoped: a board token can't read songs, and a songs token can't read the board.
The Songbook uses `BOARD_PASSWORD` unless you give it its own `SONGS_PASSWORD`.

## One-time setup

```bash
cd cloudflare/board-worker

# 1. Create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create paper-board

# 2. Your board password (Wrangler prompts for it)
wrangler secret put BOARD_PASSWORD

# 3. Random key that signs login tokens
openssl rand -hex 32 | wrangler secret put SESSION_SECRET

# 4. Deploy (also creates the board-api.alighavam.com DNS record)
wrangler deploy
```

Then commit and push the `board/` folder; the board is at https://alighavam.com/board/.
Tables are created automatically on the first request.

## Everyday notes

- **Change password:** `wrangler secret put BOARD_PASSWORD`.
- **Separate Songbook password (optional):** `wrangler secret put SONGS_PASSWORD`.
  Remove it again with `wrangler secret delete SONGS_PASSWORD` to go back to sharing.
- **Sign out every device:** `openssl rand -hex 32 | wrangler secret put SESSION_SECRET`.
- **Rename or add stages:** edit `STAGES` at the top of `board/board.js`. Cards
  remember their stage by `id`, so keep ids stable when renaming.
- **Backup:** `wrangler d1 export paper-board --remote --output board-backup.sql`
  (includes the songs). The Songbook also has Export / Import buttons for a JSON copy.
- Login is limited to 8 wrong passwords per IP per 15 minutes.

## Local development

```bash
# cloudflare/board-worker/.dev.vars (gitignored)
BOARD_PASSWORD=local-test
SESSION_SECRET=anything

wrangler dev --local --port 8787          # API with a local database
python3 -m http.server 8000               # from the repo root → localhost:8000/board/ or /songs/
```

On `localhost` both pages talk to `localhost:8787` automatically.
