# OmneRealms Discord Automation

Standalone Discord bot that bridges community reports to GitHub issues.

## What it does

| Channel        | Condition                          | Action                                      |
|----------------|------------------------------------|---------------------------------------------|
| `#bugs`        | Any text or attachment-based report | Creates or tallies a GitHub issue: `bug`, `discord-report` |
| `#suggestions` | Message reaches `REACTION_THRESHOLD` ✅ reactions | Creates GitHub issue: `suggestion`, `pending-review` |
| `#support`     | (wired in .env, not automated yet) | Reserved for future auto-reply              |

All issues open in [OmneRealms/network](https://github.com/OmneRealms/network/issues).

## Setup

```bash
cp .env.example .env
# fill in .env — see Environment Variables below
npm install
npm start
```

## Environment Variables

| Variable             | Description                                      |
|----------------------|--------------------------------------------------|
| `DISCORD_TOKEN`      | Bot token from Discord Developer Portal          |
| `GITHUB_TOKEN`       | Fine-grained GitHub PAT limited to the target repository and required Issues permissions |
| `GITHUB_OWNER`       | Target GitHub organization/user (default: `OmneRealms`) |
| `GITHUB_REPO`        | Target GitHub repository (default: `network`)    |
| `BUGS_CHANNEL_ID`    | Discord channel ID for #bugs                     |
| `SUGGESTIONS_CHANNEL_ID` | Discord channel ID for #suggestions          |
| `SUPPORT_CHANNEL_ID` | Discord channel ID for #support (reserved)       |
| `REACTION_THRESHOLD` | Number of ✅ reactions to trigger a suggestion issue (default: 5) |
| `BUG_COOLDOWN_MS`    | Per-user bug-report rate-limit window in milliseconds (default: 60000) |
| `BUG_MAX_PER_WINDOW` | Maximum bug reports per user in a rate-limit window (default: 3) |
| `DUPLICATE_THRESHOLD` | Keyword-overlap threshold for duplicate detection (default: 0.35) |

## Running with PM2

```bash
npm install -g pm2
pm2 start index.js --name discord-automation
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

## GitHub token

Use a fine-grained personal access token (or a GitHub App installation token) restricted to the target repository. Grant only the repository permissions the bot needs to search/read issues, create issues and comments, and manage the labels it creates. Avoid using a broad personal `gh` CLI OAuth session token for an always-on bot.

After rotating the token:

```bash
# update GITHUB_TOKEN in .env, then:
pm2 restart discord-automation
```

> Rotating the production credential itself is an operational step and is not performed by this repository change.

## GitHub labels

On first start the bot ensures these labels exist in the configured target repository:

- `bug` — standard bug label
- `discord-report` — added to every bug from Discord
- `suggestion` — community suggestion
- `pending-review` — waiting for owner review
- `auto-implement` — reserved: add this to trigger Claude auto-implementation (Stage 3)
