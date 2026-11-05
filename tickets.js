const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
  ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');
const { getState, persist } = require('./store');

const BRAND = 0x00CFFF;
const state = getState;
const transcriptDir = path.resolve(process.env.TRANSCRIPT_DIR || './data/transcripts');
const hours = n => n * 60 * 60 * 1000;
const isStaff = (member, client) => {
  const ids = [process.env.ADMIN_ROLE_ID, process.env.SENIOR_STAFF_ROLE_ID, process.env.SUPPORT_ROLE_ID].filter(Boolean);
  return member.permissions?.has(PermissionFlagsBits.Administrator) || ids.some(id => member.roles?.cache?.has(id));
};
const isAdmin = member => member.permissions?.has(PermissionFlagsBits.Administrator) || (process.env.ADMIN_ROLE_ID && member.roles?.cache?.has(process.env.ADMIN_ROLE_ID));
const isSenior = member => isAdmin(member) || (process.env.SENIOR_STAFF_ROLE_ID && member.roles?.cache?.has(process.env.SENIOR_STAFF_ROLE_ID));
function ticketForChannel(channelId) { return Object.values(state().tickets).find(t => t.channelId === channelId && t.status === 'open'); }
function panelEmbed() {
  return new EmbedBuilder().setColor(BRAND).setTitle('Novex Support').setThumbnail('attachment://novex-icon.jpeg')
    .setDescription('Welcome to **Novex Market Support**.\n\nSelect a category below to open a private ticket. Please provide accurate information so our team can help you as quickly as possible.')
    .addFields({ name: 'Purchase', value: 'Questions about products, services and orders.', inline: true }, { name: 'Support', value: 'Technical help and general assistance.', inline: true })
    .setFooter({ text: 'Novex Market • Support Centre' }).setTimestamp();
}
function panelComponents() {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('novex:category').setPlaceholder('Choose Purchase or Support').addOptions(
    { label: 'Purchase', value: 'purchase', description: 'Enquire about buying a product or service', emoji: '🛒' },
    { label: 'Support', value: 'support', description: 'Get help with a product, service or order', emoji: '🛠️' }
  ))];
}
function ticketEmbed(ticket) {
  const fields = [
    { name: 'Ticket creator', value: `<@${ticket.creatorId}>`, inline: true },
    { name: 'Ticket number', value: `#${ticket.number}`, inline: true },
    { name: 'Category', value: ticket.category, inline: true },
    { name: 'Product / Service', value: ticket.product || 'Not provided', inline: false },
    { name: ticket.category === 'Purchase' ? 'Payment method requested' : 'Issue description', value: ticket.category === 'Purchase' ? (ticket.payment || 'Not provided') : (ticket.issue || 'Not provided'), inline: false },
    { name: 'Additional information', value: ticket.additional || 'None provided', inline: false },
    { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
    { name: 'Status', value: 'Open • Manual handling', inline: true }
  ];
  return new EmbedBuilder().setColor(BRAND).setTitle(`Novex Support • Ticket #${ticket.number}`).addFields(fields).setFooter({ text: 'Novex Market Support' }).setTimestamp(new Date(ticket.createdAt));
}
function staffRoleOverwrites(guild) {
  return [process.env.ADMIN_ROLE_ID, process.env.SENIOR_STAFF_ROLE_ID, process.env.SUPPORT_ROLE_ID].filter(Boolean).filter(id => guild.roles.cache.has(id)).map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }));
}
async function createTicket(interaction, category, answers) {
  const guild = interaction.guild;
  const active = Object.values(state().tickets).filter(t => t.creatorId === interaction.user.id && t.status === 'open').length;
  const limit = Math.max(1, Number(process.env.TICKET_LIMIT_PER_USER || 3));
  if (active >= limit) return interaction.reply({ content: `You already have ${active} open ticket(s). Please use an existing ticket before opening another.`, ephemeral: true });
  const db = state(); db.counters.ticket = (db.counters.ticket || 0) + 1;
  const number = db.counters.ticket;
  const name = `ticket-${String(number).padStart(4, '0')}`;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    ...staffRoleOverwrites(guild)
  ];
  const parentId = category === 'purchase' ? process.env.PURCHASE_TICKET_CATEGORY_ID : process.env.SUPPORT_TICKET_CATEGORY_ID;
  const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId || undefined, permissionOverwrites: overwrites, topic: `Novex ticket #${number} | creator:${interaction.user.id} | category:${category}` });
  const ticket = { number, channelId: channel.id, guildId: guild.id, creatorId: interaction.user.id, category: category === 'purchase' ? 'Purchase' : 'Support', product: answers.product, payment: answers.payment || '', issue: answers.issue || '', additional: answers.additional, createdAt: Date.now(), lastCustomerMessageAt: Date.now(), claimedBy: null, status: 'open', reminderSentAt: null, transcriptPath: null };
  db.tickets[String(number)] = ticket; await persist();
  const intro = new EmbedBuilder().setColor(BRAND).setDescription(`<@${interaction.user.id}> your ticket has been created. A member of the Novex team will assist you shortly.`).setFooter({ text: 'Novex Market • Ticket created' });
  await channel.send({ content: `<@${interaction.user.id}> ${staffRoleMentions(guild)}`, embeds: [intro, ticketEmbed(ticket)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('novex:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('novex:claim').setLabel('Claim ticket').setStyle(ButtonStyle.Primary))] });
  await interaction.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
  await log(guild, `🎫 Ticket **#${number}** opened by <@${interaction.user.id}> (${ticket.category}).`);
}
function staffRoleMentions() { return [process.env.ADMIN_ROLE_ID, process.env.SENIOR_STAFF_ROLE_ID, process.env.SUPPORT_ROLE_ID].filter(Boolean).map(id => `<@&${id}>`).join(' '); }
async function log(guild, message, file) {
  if (!process.env.TICKET_LOG_CHANNEL_ID) return;
  const channel = guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID) || await guild.channels.fetch(process.env.TICKET_LOG_CHANNEL_ID).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ content: message, files: file ? [file] : [] }).catch(err => console.error('Log send failed:', err.message));
}
async function generateTranscript(channel, ticket) {
  await fs.promises.mkdir(transcriptDir, { recursive: true });
  let messages = [], before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values()); before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = [`NOVEX MARKET — TICKET #${ticket.number}`, `Creator: ${ticket.creatorId}`, `Category: ${ticket.category}`, `Created: ${new Date(ticket.createdAt).toISOString()}`, ''];
  for (const m of messages) {
    const body = m.content || '';
    const files = [...m.attachments.values()].map(a => a.url).join(' ');
    lines.push(`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag} (${m.author.id}): ${body}${files ? ` [Attachments: ${files}]` : ''}`);
  }
  const filePath = path.join(transcriptDir, `ticket-${ticket.number}.txt`);
  await fs.promises.writeFile(filePath, lines.join('\n'), 'utf8');
  ticket.transcriptPath = filePath;
  return new AttachmentBuilder(filePath, { name: `novex-ticket-${ticket.number}-transcript.txt` });
}
async function closeTicket(interaction, ticket, reason = 'No reason provided.') {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const channel = interaction.channel;
  const attachment = await generateTranscript(channel, ticket);
  const db = state(); ticket.status = 'closed'; ticket.closedAt = Date.now(); ticket.closedBy = interaction.user.id; ticket.closeReason = reason;
  await persist();
  const creator = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
  if (creator) await creator.send({ content: `Your Novex Market ticket **#${ticket.number}** has been closed. Reason: ${reason}`, files: [attachment] }).catch(() => {});
  await log(interaction.guild, `🔒 Ticket **#${ticket.number}** closed by <@${interaction.user.id}>. Reason: ${reason}`, attachment);
  await interaction.editReply({ content: 'Ticket closed. The transcript has been saved and sent where possible.' }).catch(() => {});
  setTimeout(() => channel.delete('Novex ticket closed').catch(() => {}), 10_000).unref?.();
}
function buildTicketModal(category) {
  const modal = new ModalBuilder().setCustomId(`novex:open:${category}`).setTitle(category === 'purchase' ? 'Open a Purchase Ticket' : 'Open a Support Ticket');
  const product = new TextInputBuilder().setCustomId('product').setLabel(category === 'purchase' ? 'Which product / service?' : 'Which product / service needs support?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  const second = new TextInputBuilder().setCustomId(category === 'purchase' ? 'payment' : 'issue').setLabel(category === 'purchase' ? 'Which payment method?' : 'Explain your situation in detail').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
  const additional = new TextInputBuilder().setCustomId('additional').setLabel('Any additional information?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
  return modal.addComponents(new ActionRowBuilder().addComponents(product), new ActionRowBuilder().addComponents(second), new ActionRowBuilder().addComponents(additional));
}
async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'novex:category') return interaction.showModal(buildTicketModal(interaction.values[0]));
  if (interaction.isModalSubmit() && interaction.customId.startsWith('novex:open:')) {
    const category = interaction.customId.split(':').pop();
    const answers = { product: interaction.fields.getTextInputValue('product'), additional: interaction.fields.getTextInputValue('additional') };
    if (category === 'purchase') answers.payment = interaction.fields.getTextInputValue('payment'); else answers.issue = interaction.fields.getTextInputValue('issue');
    return createTicket(interaction, category, answers);
  }
  if (interaction.isButton() && interaction.customId === 'novex:claim') {
    const ticket = ticketForChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'This is not an open Novex ticket.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Only authorised staff can claim tickets.', ephemeral: true });
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !isAdmin(interaction.member)) return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    ticket.claimedBy = interaction.user.id;
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: false });
    for (const roleId of [process.env.SUPPORT_ROLE_ID, process.env.SENIOR_STAFF_ROLE_ID].filter(Boolean)) await interaction.channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    await interaction.channel.permissionOverwrites.edit(ticket.creatorId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    await persist();
    return interaction.reply({ content: `Ticket #${ticket.number} claimed by <@${interaction.user.id}>. Only the claimant and ticket creator can send messages (administrators retain access).` });
  }
  if (interaction.isButton() && interaction.customId === 'novex:close') {
    const ticket = ticketForChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'This is not an open Novex ticket.', ephemeral: true });
    if (interaction.user.id !== ticket.creatorId && !isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Only the ticket creator or authorised staff can close this ticket.', ephemeral: true });
    return closeTicket(interaction, ticket, 'Closed using the ticket button.');
  }
}
async function handleCommand(interaction) {
  const name = interaction.commandName;
  if (name === 'ticketpanel') {
    if (!isAdmin(interaction.member)) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;
    if (sub === 'edit') {
      const db = state(); const messageId = db.settings.panelMessageId;
      if (messageId) {
        const old = await channel.messages.fetch(messageId).catch(() => null);
        if (old) { await old.edit({ embeds: [panelEmbed()], components: panelComponents(), files: [path.resolve(__dirname, '../assets/novex-icon.jpeg')] }); return interaction.reply({ content: 'Existing Novex Support panel updated.', ephemeral: true }); }
      }
    }
    const msg = await channel.send({ embeds: [panelEmbed()], components: panelComponents(), files: [path.resolve(__dirname, '../assets/novex-icon.jpeg')] });
    state().settings.panelMessageId = msg.id; state().settings.panelChannelId = channel.id; await persist();
    return interaction.reply({ content: 'Novex Support panel sent.', ephemeral: true });
  }
  const ticket = ticketForChannel(interaction.channelId);
  if (name === 'ticketclaim') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open ticket.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !isAdmin(interaction.member)) return interaction.reply({ content: `Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    ticket.claimedBy = interaction.user.id;
    for (const id of [process.env.SUPPORT_ROLE_ID, process.env.SENIOR_STAFF_ROLE_ID].filter(Boolean)) await interaction.channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    await persist(); return interaction.reply(`Ticket #${ticket.number} claimed by <@${interaction.user.id}>.`);
  }
  if (name === 'ticketadd') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open ticket.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    const user = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return interaction.reply({ content: `${user} has been added to this ticket.` });
  }
  if (name === 'ticketclose') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open ticket.', ephemeral: true });
    if (interaction.user.id !== ticket.creatorId && !isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Only the ticket creator or authorised staff can close this ticket.', ephemeral: true });
    return closeTicket(interaction, ticket, interaction.options.getString('reason') || 'No reason provided.');
  }
  if (name === 'ticketremind') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open ticket.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    const user = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
    const msg = `Reminder: please reply to your Novex Market ticket **#${ticket.number}** when you can. It may close automatically if there is no response.`;
    if (user) await user.send(msg).catch(() => {});
    await interaction.channel.send(`<@${ticket.creatorId}> ${msg}`);
    return interaction.reply({ content: 'Reminder sent where possible.', ephemeral: true });
  }
  if (name === 'ticketrename') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open ticket.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    const clean = interaction.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 90);
    await interaction.channel.setName(clean || `ticket-${ticket.number}`); return interaction.reply({ content: `Ticket renamed to **${clean}**.`, ephemeral: true });
  }
  if (name === 'transcriptlookup') {
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    const userId = interaction.options.getString('user_id');
    const found = Object.values(state().tickets).filter(t => t.creatorId === userId).sort((a, b) => b.createdAt - a.createdAt);
    if (!found.length) return interaction.reply({ content: `No tickets found for user ID ${userId}.`, ephemeral: true });
    const embed = new EmbedBuilder().setColor(BRAND).setTitle(`Ticket history • ${userId}`).setDescription(found.slice(0, 15).map(t => `**#${t.number}** • ${t.category} • ${t.status} • <t:${Math.floor(t.createdAt / 1000)}:R>${t.transcriptPath ? ` • [Transcript](attachment://${path.basename(t.transcriptPath)})` : ''}`).join('\n')).setFooter({ text: `${found.length} ticket(s) found` });
    const files = found.slice(0, 5).filter(t => t.transcriptPath && fs.existsSync(t.transcriptPath)).map(t => new AttachmentBuilder(t.transcriptPath, { name: path.basename(t.transcriptPath) }));
    return interaction.reply({ embeds: [embed], files, ephemeral: true });
  }
}
async function onMessage(message) {
  if (message.author.bot || !message.guild) return;
  const ticket = ticketForChannel(message.channelId);
  if (!ticket) return;
  if (message.author.id === ticket.creatorId) { ticket.lastCustomerMessageAt = Date.now(); ticket.reminderSentAt = null; await persist(); }
}
async function inactivitySweep(client) {
  const reminderMs = hours(Number(process.env.REMINDER_HOURS || 6));
  const closeMs = hours(Number(process.env.AUTO_CLOSE_HOURS || 6));
  for (const ticket of Object.values(state().tickets).filter(t => t.status === 'open')) {
    const guild = client.guilds.cache.get(ticket.guildId); if (!guild) continue;
    const channel = guild.channels.cache.get(ticket.channelId); if (!channel) continue;
    const idle = Date.now() - (ticket.lastCustomerMessageAt || ticket.createdAt);
    if (!ticket.reminderSentAt && idle >= reminderMs) {
      const user = await client.users.fetch(ticket.creatorId).catch(() => null);
      const msg = `You have not replied to Novex Market ticket **#${ticket.number}** for ${process.env.REMINDER_HOURS || 6} hours. Please reply within the next ${process.env.AUTO_CLOSE_HOURS || 6} hours or the ticket will close automatically.`;
      await channel.send(`<@${ticket.creatorId}> ${msg}`).catch(() => {});
      if (user) await user.send(msg).catch(() => {});
      ticket.reminderSentAt = Date.now(); await persist();
    } else if (ticket.reminderSentAt && Date.now() - ticket.reminderSentAt >= closeMs) {
      const fake = { channel, guild, client, user: client.user, deferReply: async () => {}, editReply: async () => {} };
      const attachment = await generateTranscript(channel, ticket);
      ticket.status = 'closed'; ticket.closedAt = Date.now(); ticket.closedBy = client.user.id; ticket.closeReason = 'Automatically closed after inactivity.'; await persist();
      const user = await client.users.fetch(ticket.creatorId).catch(() => null);
      if (user) await user.send({ content: `Your Novex Market ticket **#${ticket.number}** was automatically closed after inactivity.`, files: [attachment] }).catch(() => {});
      await log(guild, `⏰ Ticket **#${ticket.number}** automatically closed after inactivity.`, attachment);
      setTimeout(() => channel.delete('Novex ticket automatically closed').catch(() => {}), 10_000).unref?.();
    }
  }
}
module.exports = { handleInteraction, handleCommand, onMessage, inactivitySweep, panelEmbed, panelComponents };
