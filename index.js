require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { initStore, closeStore } = require('./store');
const { handleInteraction, handleCommand, onMessage, inactivitySweep } = require('./tickets');

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) { console.error(`Missing required environment variables: ${missing.join(', ')}`); process.exit(1); }

const app = express();
app.get('/', (_req, res) => res.status(200).send('Novex Support is running.'));
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'novex-support', timestamp: new Date().toISOString() }));
const server = app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(`Health server listening on ${process.env.PORT || 10000}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
client.once(Events.ClientReady, ready => {
  console.log(`Logged in as ${ready.user.tag}`);
  setInterval(() => inactivitySweep(client).catch(err => console.error('Inactivity sweep failed:', err)), 60_000);
});
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else await handleInteraction(interaction);
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: 'Something went wrong while processing that action. Please try again or contact staff.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});
client.on(Events.MessageCreate, message => onMessage(message).catch(err => console.error('Message handler error:', err)));

(async () => {
  try { await initStore(); await client.login(process.env.DISCORD_TOKEN); }
  catch (error) { console.error('Startup failed:', error); process.exit(1); }
})();

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  client.destroy(); server.close(); await closeStore().catch(() => {}); process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
