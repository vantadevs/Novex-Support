# Novex Support

A Novex Market Discord ticket bot built with Node.js, Discord.js v14 and Express. AI and payment integrations are intentionally not required; purchase tickets are handled manually until those modules are added later.

## Features

- `/ticketpanel send` and `/ticketpanel edit`
- Purchase and Support dropdowns with required modal questions
- Private ticket channels, ticket claims, add-member, rename and close commands
- Transcript generation, creator DM and log-channel delivery
- `/transcriptlookup user_id:<ID>` for staff ticket history
- Six-hour inactivity reminder followed by automatic closure after another six hours (configurable)
- Health endpoint for Render
- Local JSON storage by default; PostgreSQL storage when `DATABASE_URL` is configured

## Requirements

- Node.js 20.11+
- Discord application/bot and a server where you can invite it

## Local setup

1. Clone/download this repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`.
4. Add the relevant role and channel IDs. IDs can be left blank, but staff role access then needs to be granted through Discord administrator permissions.
5. Enable **Server Members Intent** only if needed; enable **Message Content Intent** in the Discord Developer Portal because the bot tracks customer replies.
6. Run `npm run register` to register the server slash commands.
7. Run `npm start`.

## Discord bot permissions

Invite the bot with the `bot` and `applications.commands` scopes. Grant at least View Channels, Send Messages, Read Message History, Manage Channels, Manage Roles, Attach Files and Embed Links. The bot's highest role must be above the configured staff roles if it needs to manage their channel overwrites.

## Render deployment

1. Push this folder to a GitHub repository.
2. In Render, create a **Web Service** connected to the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Health check path: `/health`
6. Add the environment variables from `.env.example` in Render.
7. Run `npm run register` locally once with the same Discord application credentials (or use Render Shell if available) to register slash commands.

### Storage warning

Without `DATABASE_URL`, the bot uses `./data/database.json`. This is convenient for local testing but Render's free service filesystem is ephemeral, so data can be lost on redeploy/restart. For persistent storage, configure a PostgreSQL database and set `DATABASE_URL`. Render's free database offering has its own expiry/usage limitations; check current Render terms before relying on it for production.

## Optional configuration

- `TICKET_LIMIT_PER_USER` (default `3`)
- `REMINDER_HOURS` (default `6`)
- `AUTO_CLOSE_HOURS` (default `6`)
- `TRANSCRIPT_DIR` (default `./data/transcripts`)
- `DATA_FILE` (default `./data/database.json`)

## Important limitations in this first version

- AI and payment processing are not included or required.
- Purchase fulfilment is manual.
- Transcript lookup currently attaches up to five saved transcripts per search and lists up to fifteen ticket records in the embed.
- Ticket panel edit updates the last panel created by the bot when invoked in the same channel; otherwise it sends a new panel.
- For privacy and reliability, test role/channel permission overwrites in a private test server before launch.


## Novex Market server configuration

The supplied `.env.example` is prefilled with the Novex Market server, role, ticket category and log-channel IDs. Add your Discord bot token and application/client ID before deployment. Never commit `.env` or share your bot token.

- Support tickets are created under `SUPPORT_TICKET_CATEGORY_ID`.
- Purchase tickets are created under `PURCHASE_TICKET_CATEGORY_ID`.
- Staff access uses the Staff, Senior Staff and Management role IDs.
- Ticket transcripts and event logs are sent to `TICKET_LOG_CHANNEL_ID`.
- `assets/novex-icon.jpeg` is used as the ticket panel thumbnail; `assets/novex-banner.jpeg` is included as the supplied brand reference.

The current build is a baseline ticket-bot implementation. Before production use, test it in a private Discord server and configure persistent PostgreSQL storage. Render free instances may sleep, and local files are not durable across all redeployments.
