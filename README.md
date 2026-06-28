# OmneRealms Discord Automation

Standalone Discord bot that bridges community reports to GitHub issues.

## What it does

| Channel        | Condition                          | Action                                      |
|----------------|------------------------------------|---------------------------------------------|
| `#bugs`        | Any message posted                 | Creates GitHub issue: `bug`, `discord-report` |
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
| `GITHUB_TOKEN`       | GitHub token with `repo` scope                   |
| `BUGS_CHANNEL_ID`    | Discord channel ID for #bugs                     |
| `SUGGESTIONS_CHANNEL_ID` | Discord channel ID for #suggestions          |
| `SUPPORT_CHANNEL_ID` | Discord channel ID for #support (reserved)       |
| `REACTION_THRESHOLD` | Number of ✅ reactions to trigger a suggestion issue (default: 5) |

## Running with PM2

```bash
npm install -g pm2
pm2 start index.js --name discord-automation
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

## Updating the GitHub token

The `GITHUB_TOKEN` in `.env` is an OAuth token tied to your `gh` CLI session. If it ever stops working:

```bash
gh auth token   # prints the current token
# update DISCORD_TOKEN in .env, then:
pm2 restart discord-automation
```

## GitHub labels

On first start the bot ensures these labels exist in OmneRealms/network:

- `bug` — standard bug label
- `discord-report` — added to every bug from Discord
- `suggestion` — community suggestion
- `pending-review` — waiting for owner review
- `auto-implement` — reserved: add this to trigger Claude auto-implementation (Stage 3)
