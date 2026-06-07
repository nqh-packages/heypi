---
name: bird
description: X/Twitter CLI for reading, searching, posting, and engagement via cookies.
author: nqh-packages
version: 1.1.0
homepage: https://bird.fast
metadata: {"clawdbot":{"emoji":"🐦","requires":{"bins":["bird"]},"install":[{"id":"brew","kind":"brew","formula":"steipete/tap/bird","bins":["bird"],"label":"Install bird (brew)"},{"id":"npm","kind":"node","package":"@steipete/bird","bins":["bird"],"label":"Install bird (npm)"}]}}
---

# bird 🐦 v1.1.0

Fast X/Twitter CLI using GraphQL + cookie auth.

## Install

```bash
# npm/pnpm/bun
npm install -g @steipete/bird

# Homebrew (macOS, prebuilt binary)
brew install steipete/tap/bird

# One-shot (no install)
bunx @steipete/bird whoami
```

## Authentication

`bird` uses cookie-based auth.

Use `--auth-token` / `--ct0` to pass cookies directly, or `--cookie-source` for browser cookies.

Huy uses Helium instead of Chrome. Helium stores cookies in a Chromium-compatible profile at:

```bash
/Users/huy/Library/Application Support/net.imput.helium/Default
```

Do not rely on `--chrome-profile-dir` alone for Helium on macOS. Helium encrypts cookies with the Keychain service `Helium Storage Key`, while `bird`/`sweet-cookie` currently tries Chrome-compatible safe-storage services.

Use the skill helper so credentials stay in-memory and are passed to `bird` through `AUTH_TOKEN` / `CT0`:

```bash
node /Users/huy/.agents/skills/bird/scripts/bird-helium.mjs check
node /Users/huy/.agents/skills/bird/scripts/bird-helium.mjs whoami
node /Users/huy/.agents/skills/bird/scripts/bird-helium.mjs read <tweet-url-or-id>
```

Run the helper's `check` command to verify credentials. If Helium has no X cookies yet, open Helium, log into `x.com`, then run the check again.

## Commands

### Account & Auth

```bash
bird whoami                    # Show logged-in account
bird check                     # Show credential sources
bird query-ids --fresh         # Refresh GraphQL query ID cache
```

### Reading Tweets

```bash
bird read <url-or-id>          # Read a single tweet
bird <url-or-id>               # Shorthand for read
bird thread <url-or-id>        # Full conversation thread
bird replies <url-or-id>       # List replies to a tweet
```

### Timelines

```bash
bird home                      # Home timeline (For You)
bird home --following          # Following timeline
bird user-tweets @handle -n 20 # User's profile timeline
bird mentions                  # Tweets mentioning you
bird mentions --user @handle   # Mentions of another user
```

### Search

```bash
bird search "query" -n 10
bird search "from:steipete" --all --max-pages 3
```

### News & Trending

```bash
bird news -n 10                # AI-curated from Explore tabs
bird news --ai-only            # Filter to AI-curated only
bird news --sports             # Sports tab
bird news --with-tweets        # Include related tweets
bird trending                  # Alias for news
```

### Lists

```bash
bird lists                     # Your lists
bird lists --member-of         # Lists you're a member of
bird list-timeline <id> -n 20  # Tweets from a list
```

### Bookmarks & Likes

```bash
bird bookmarks -n 10
bird bookmarks --folder-id <id>           # Specific folder
bird bookmarks --include-parent           # Include parent tweet
bird bookmarks --author-chain             # Author's self-reply chain
bird bookmarks --full-chain-only          # Full reply chain
bird unbookmark <url-or-id>
bird likes -n 10
```

### Social Graph

```bash
bird following -n 20           # Users you follow
bird followers -n 20           # Users following you
bird following --user <id>     # Another user's following
bird about @handle             # Account origin/location info
```

### Engagement Actions

```bash
bird follow @handle            # Follow a user
bird unfollow @handle          # Unfollow a user
```

### Posting

```bash
bird tweet "hello world"
bird reply <url-or-id> "nice thread!"
bird tweet "check this out" --media image.png --alt "description"
```

**⚠️ Posting risks**: Posting is more likely to be rate limited; if blocked, use the browser tool instead.

## Media Uploads

```bash
bird tweet "hi" --media img.png --alt "description"
bird tweet "pics" --media a.jpg --media b.jpg  # Up to 4 images
bird tweet "video" --media clip.mp4            # Or 1 video
```

## Pagination

Commands supporting pagination: `replies`, `thread`, `search`, `bookmarks`, `likes`, `list-timeline`, `following`, `followers`, `user-tweets`

```bash
bird bookmarks --all                    # Fetch all pages
bird bookmarks --max-pages 3            # Limit pages
bird bookmarks --cursor <cursor>        # Resume from cursor
bird replies <id> --all --delay 1000    # Delay between pages (ms)
```

## Output Options

```bash
--json          # JSON output
--json-full     # JSON with raw API response
--plain         # No emoji, no color (script-friendly)
--no-emoji      # Disable emoji
--no-color      # Disable ANSI colors (or set NO_COLOR=1)
--quote-depth n # Max quoted tweet depth in JSON (default: 1)
```

## Global Options

```bash
--auth-token <token>       # Set auth_token cookie
--ct0 <token>              # Set ct0 cookie
--cookie-source <source>   # Cookie source for browser cookies (repeatable)
--chrome-profile <name>    # Chrome profile name
--chrome-profile-dir <path> # Chrome/Chromium-compatible profile dir or cookie DB path
--firefox-profile <name>   # Firefox profile
--timeout <ms>             # Request timeout
--cookie-timeout <ms>      # Cookie extraction timeout
```

## Config File

`~/.config/bird/config.json5` (global) or `./.birdrc.json5` (project):

```json5
{
  cookieSource: ["chrome"],
  chromeProfileDir: "/Users/huy/Library/Application Support/net.imput.helium/Default",
  timeoutMs: 20000,
  quoteDepth: 1
}
```

Environment variables: `BIRD_TIMEOUT_MS`, `BIRD_COOKIE_TIMEOUT_MS`, `BIRD_QUOTE_DEPTH`

## Troubleshooting

### Query IDs stale (404 errors)

```bash
bird query-ids --fresh
```

### Cookie extraction fails

- Check Helium is logged into `x.com`
- Use `node /Users/huy/.agents/skills/bird/scripts/bird-helium.mjs check`
- If `bird check` still reports missing `auth_token` or `ct0`, pass them directly with `--auth-token` / `--ct0`

---

**TL;DR**: Read/search/engage with CLI. Post carefully or use browser. 🐦
