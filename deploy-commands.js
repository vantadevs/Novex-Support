require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');
const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'].filter(k => !process.env[k]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log(`Registered ${commands.length} Novex Support slash commands.`);
})().catch(error => { console.error(error); process.exit(1); });
