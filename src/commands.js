const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Send or manage the Novex Support panel')
    .addSubcommand(s => s.setName('send').setDescription('Send the Novex Support panel'))
    .addSubcommand(s => s.setName('edit').setDescription('Update the existing Novex Support panel')),
  new SlashCommandBuilder().setName('ticketclaim').setDescription('Claim the current ticket'),
  new SlashCommandBuilder().setName('ticketadd').setDescription('Add a member to the current ticket')
    .addUserOption(o => o.setName('user').setDescription('Member to add').setRequired(true)),
  new SlashCommandBuilder().setName('ticketclose').setDescription('Close the current ticket')
    .addStringOption(o => o.setName('reason').setDescription('Optional closure reason').setMaxLength(500)),
  new SlashCommandBuilder().setName('ticketremind').setDescription('Send a reply reminder in the current ticket'),
  new SlashCommandBuilder().setName('ticketrename').setDescription('Rename the current ticket')
    .addStringOption(o => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)),
  new SlashCommandBuilder().setName('mytickets').setDescription('View your Novex ticket history and download past transcripts'),
  new SlashCommandBuilder().setName('transcriptlookup').setDescription('Find a customer\'s previous tickets')
    .addStringOption(o => o.setName('user_id').setDescription('Discord user ID of the ticket creator').setRequired(true))
].map(c => c.toJSON());
module.exports = { commands };
