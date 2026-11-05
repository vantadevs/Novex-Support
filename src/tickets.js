const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
  ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');
const { getState, persist } = require('./store');

const BRAND = 0x00CFFF;
const SERVER_CONFIG = {
  adminRoleId: process.env.ADMIN_ROLE_ID || '1567671315400237206',
  seniorRoleId: process.env.SENIOR_STAFF_ROLE_ID || '1567671312158032033',
  supportRoleId: process.env.SUPPORT_ROLE_ID || '1567671313827364934',
  supportCategoryId: process.env.SUPPORT_TICKET_CATEGORY_ID || '1568010393899765841',
  purchaseCategoryId: process.env.PURCHASE_TICKET_CATEGORY_ID || '1568010447083409459',
  logChannelId: process.env.TICKET_LOG_CHANNEL_ID || '1567671395649855579'
};
const ASSET_DIR = path.resolve(__dirname, '../assets');
const ICON_PATH = path.join(ASSET_DIR, 'novex-icon.jpeg');
const BANNER_PATH = path.join(ASSET_DIR, 'novex-banner.jpeg');
const state = getState;
const transcriptDir = path.resolve(process.env.TRANSCRIPT_DIR || './data/transcripts');
const hours = n => n * 60 * 60 * 1000;
const isStaff = (member, client) => {
  const ids = [SERVER_CONFIG.adminRoleId, SERVER_CONFIG.seniorRoleId, SERVER_CONFIG.supportRoleId].filter(Boolean);
  return member.permissions?.has(PermissionFlagsBits.Administrator) || ids.some(id => member.roles?.cache?.has(id));
};
const isAdmin = member => member.permissions?.has(PermissionFlagsBits.Administrator) || (SERVER_CONFIG.adminRoleId && member.roles?.cache?.has(SERVER_CONFIG.adminRoleId));
const isSenior = member => isAdmin(member) || (SERVER_CONFIG.seniorRoleId && member.roles?.cache?.has(SERVER_CONFIG.seniorRoleId));
function ticketForChannel(channelId) { return Object.values(state().tickets).find(t => t.channelId === channelId && t.status === 'open'); }
function panelEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setAuthor({ name: 'NOVEX MARKET  •  CUSTOMER SUPPORT' })
    .setTitle('How can we help you today?')
    .setDescription([
      'Welcome to **Novex Market Support**.',
      '',
      'Choose the department that best matches your enquiry using the menu below. A private channel will be created and our team will be notified.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '**🛒  PURCHASE ENQUIRIES**',
      'Products, orders, payments and pre-purchase questions.',
      '',
      '**🛠️  CUSTOMER SUPPORT**',
      'Technical issues, account help and assistance with an existing service.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '*Please provide clear and accurate information so we can help you faster.*'
    ].join('\n'))
    .setThumbnail('attachment://novex-icon.jpeg')
    .setImage('attachment://novex-banner.jpeg')
    .setFooter({ text: 'NOVEX MARKET  •  SUPPORT CENTRE' })
    .setTimestamp();
}
function panelComponents() {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('novex:category').setPlaceholder('Choose Purchase or Support').addOptions(
    { label: 'Purchase', value: 'purchase', description: 'Enquire about buying a product or service', emoji: '🛒' },
    { label: 'Support', value: 'support', description: 'Get help with a product, service or order', emoji: '🛠️' }
  ))];
}
function ticketEmbed(ticket) {
  const details = ticket.category === 'Purchase'
    ? [
        { name: '🛍️  Product / service', value: ticket.product || 'Not provided', inline: false },
        { name: '💳  Payment method', value: ticket.payment || 'Not provided', inline: true }
      ]
    : [
        { name: '🛍️  Product / service', value: ticket.product || 'Not provided', inline: false },
        { name: '📝  Issue description', value: ticket.issue || 'Not provided', inline: false }
      ];
  return new EmbedBuilder()
    .setColor(BRAND)
    .setAuthor({ name: 'NOVEX MARKET  •  SUPPORT DESK' })
    .setTitle(`${ticket.category.toUpperCase()} REQUEST`)
    .setDescription('Your request is now with the Novex team. Review the details below and keep all updates in this private channel.')
    .addFields(
      { name: '👤  Customer', value: `<@${ticket.creatorId}>`, inline: true },
      { name: '📂  Department', value: ticket.category, inline: true },
      { name: '📌  Assigned staff', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Awaiting assignment', inline: true },
      ...details,
      { name: '➕  Additional information', value: ticket.additional || 'None provided', inline: false }
    )
    .setThumbnail('attachment://novex-icon.jpeg')
    .setFooter({ text: `NOVEX MARKET  •  Reference NVX-${String(ticket.number).padStart(5, '0')}` })
    .setTimestamp(new Date(ticket.createdAt));
}
function ticketControls(ticket) {
  const claim = new ButtonBuilder()
    .setCustomId('novex:claim')
    .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim')
    .setEmoji(ticket.claimedBy ? '✓' : '✋')
    .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(ticket.claimedBy));
  const close = new ButtonBuilder()
    .setCustomId('novex:close')
    .setLabel('Close request')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(claim, close)];
}
async function refreshTicketControls(channel, ticket) {
  if (!ticket.controlMessageId) return;
  const message = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
  if (!message) return;
  const embeds = [...message.embeds];
  if (embeds.length > 1) embeds[1] = ticketEmbed(ticket);
  await message.edit({ embeds, components: ticketControls(ticket) }).catch(err => console.error('Ticket controls update failed:', err.message));
}
async function applyClaim(interaction, ticket) {
  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !isAdmin(interaction.member)) {
    return interaction.reply({ content: `This request is already assigned to <@${ticket.claimedBy}>.`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  ticket.claimedBy = interaction.user.id;
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: false });
  for (const roleId of [SERVER_CONFIG.supportRoleId, SERVER_CONFIG.seniorRoleId].filter(Boolean)) {
    await interaction.channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
  }
  await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  await interaction.channel.permissionOverwrites.edit(ticket.creatorId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  await persist();
  await refreshTicketControls(interaction.channel, ticket);
  return interaction.editReply({ content: `Request assigned to <@${interaction.user.id}>.` });
}
function staffRoleOverwrites(guild) {
  return [SERVER_CONFIG.adminRoleId, SERVER_CONFIG.seniorRoleId, SERVER_CONFIG.supportRoleId].filter(Boolean).filter(id => guild.roles.cache.has(id)).map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }));
}
async function createTicket(interaction, category, answers) {
  const guild = interaction.guild;
  await guild.roles.fetch().catch(() => {});
  const active = Object.values(state().tickets).filter(t => t.creatorId === interaction.user.id && t.status === 'open').length;
  const limit = Math.max(1, Number(process.env.TICKET_LIMIT_PER_USER || 3));
  if (active >= limit) return interaction.reply({ content: `You already have ${active} open ticket(s). Please use an existing ticket before opening another.`, ephemeral: true });
  const db = state(); db.counters.ticket = (db.counters.ticket || 0) + 1;
  const number = db.counters.ticket;
  const username = (interaction.user.username || 'customer').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 75) || 'customer';
  const prefix = category === 'purchase' ? 'purchase' : 'support';
  const name = `${prefix}-${username}`.slice(0, 100);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    ...staffRoleOverwrites(guild)
  ];
  const parentId = category === 'purchase' ? SERVER_CONFIG.purchaseCategoryId : SERVER_CONFIG.supportCategoryId;
  const parentChannel = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;
  const parent = parentChannel?.type === ChannelType.GuildCategory ? parentChannel.id : undefined;
  if (parentId && !parent) console.error(`Configured ticket category ${parentId} was not found or is not a category in guild ${guild.id}; creating ticket without a parent category.`);
  const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent, permissionOverwrites: overwrites, topic: `Novex reference NVX-${String(number).padStart(5, '0')} | creator:${interaction.user.id} | category:${category}` });
  const ticket = { number, channelId: channel.id, guildId: guild.id, creatorId: interaction.user.id, category: category === 'purchase' ? 'Purchase' : 'Support', product: answers.product, payment: answers.payment || '', issue: answers.issue || '', additional: answers.additional, createdAt: Date.now(), lastCustomerMessageAt: Date.now(), claimedBy: null, status: 'open', reminderSentAt: null, transcriptHtml: null };
  db.tickets[String(number)] = ticket; await persist();
  const intro = new EmbedBuilder().setColor(BRAND).setAuthor({ name: 'NOVEX MARKET  •  REQUEST RECEIVED' }).setDescription(`Welcome <@${interaction.user.id}>.\n\nYour **${ticket.category.toLowerCase()} request** has been received. The Novex team has been notified. A team member will review your details and reply here.\n\nPlease keep purchase details, key-delivery questions and support updates in this channel so they remain part of your ticket history.`).setThumbnail('attachment://novex-icon.jpeg').setFooter({ text: `NOVEX MARKET  •  Reference NVX-${String(ticket.number).padStart(5, '0')}` }).setTimestamp();
  const roleMentions = staffRoleMentions(guild);
  const controlMessage = await channel.send({
    content: `<@${interaction.user.id}>${roleMentions ? ` ${roleMentions}` : ''}`,
    allowedMentions: { users: [interaction.user.id], roles: staffRoleIds(guild) },
    embeds: [intro, ticketEmbed(ticket)],
    files: fs.existsSync(ICON_PATH) ? [ICON_PATH] : [],
    components: ticketControls(ticket)
  });
  ticket.controlMessageId = controlMessage.id;
  await persist();
  await interaction.reply({ content: `Your ${ticket.category.toLowerCase()} request is ready: ${channel}`, ephemeral: true });
  const opened = new EmbedBuilder().setColor(BRAND).setTitle(`${ticket.category.toUpperCase()} REQUEST OPENED`)
    .setDescription(`A new Novex support request has been created.`)
    .addFields(
      { name: 'Customer', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Reference', value: `NVX-${String(number).padStart(5, '0')}`, inline: true },
      { name: 'Channel', value: `${channel}`, inline: true }
    ).setTimestamp();
  await log(guild, null, null, opened);
}
function staffRoleIds(guild) { return [SERVER_CONFIG.supportRoleId, SERVER_CONFIG.seniorRoleId, SERVER_CONFIG.adminRoleId].filter(id => id && guild.roles.cache.has(id)); }
function staffRoleMentions(guild) { return staffRoleIds(guild).map(id => `<@&${id}>`).join(' '); }
async function log(guild, message, file, embed) {
  if (!SERVER_CONFIG.logChannelId) return null;
  const channel = guild.channels.cache.get(SERVER_CONFIG.logChannelId) || await guild.channels.fetch(SERVER_CONFIG.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const payload = {};
  if (message) payload.content = message;
  if (file) payload.files = [file];
  if (embed) payload.embeds = [embed];
  return channel.send(payload).catch(err => { console.error('Log send failed:', err.message); return null; });
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function safeUrl(value = '') {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '#';
  } catch { return '#'; }
}
function transcriptHtml(ticket, messages) {
  const reference = `NVX-${String(ticket.number).padStart(5, '0')}`;
  const rows = messages.map(message => {
    const author = escapeHtml(message.author?.tag || message.author?.username || 'Unknown user');
    const avatar = message.author?.displayAvatarURL?.({ extension: 'png', size: 64 }) || '';
    const time = new Date(message.createdTimestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
    const content = escapeHtml(message.content || '').replace(/\n/g, '<br>');
    const attachments = [...(message.attachments?.values?.() || [])].map(file =>
      `<a class="attachment" href="${safeUrl(file.url)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(file.name || 'Attachment')}</a>`
    ).join('');
    const embeds = (message.embeds || []).map(embed => {
      const title = embed.title ? `<strong>${escapeHtml(embed.title)}</strong>` : '';
      const description = embed.description ? `<div>${escapeHtml(embed.description).replace(/\n/g, '<br>')}</div>` : '';
      const fields = (embed.fields || []).map(field => `<div class="embed-field"><b>${escapeHtml(field.name)}</b><span>${escapeHtml(field.value).replace(/\n/g, '<br>')}</span></div>`).join('');
      return `<div class="discord-embed">${title}${description}${fields}</div>`;
    }).join('');
    const isBot = Boolean(message.author?.bot);
    return `<article class="message ${isBot ? 'bot' : ''}">
      <img class="avatar" src="${safeUrl(avatar)}" alt="">
      <div class="message-main"><div class="message-meta"><strong>${author}</strong>${isBot ? '<span class="tag">BOT</span>' : ''}<time>${escapeHtml(time)}</time></div>
      ${content ? `<div class="message-content">${content}</div>` : ''}
      ${attachments ? `<div class="attachments">${attachments}</div>` : ''}${embeds}</div>
    </article>`;
  }).join('\n');
  const details = [
    ['Reference', reference],
    ['Ticket type', ticket.category],
    ['Customer ID', ticket.creatorId],
    ['Created', new Date(ticket.createdAt).toISOString().replace('T', ' ').replace('Z', ' UTC')],
    ['Closed', ticket.closedAt ? new Date(ticket.closedAt).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Not closed'],
    ['Handled by', ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unassigned'],
    ['Closed by', ticket.closedBy ? ticket.closedBy : '—'],
    ['Closure reason', ticket.closeReason || '—']
  ];
  const detailHtml = details.map(([label, value]) => `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Novex Market · ${reference} transcript</title>
<style>
:root{color-scheme:dark;--bg:#090d14;--panel:#111927;--panel2:#0d1420;--line:#253348;--text:#e8eef8;--muted:#91a0b5;--cyan:#32c9e8}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% -15%,#123044 0,transparent 48%),var(--bg);color:var(--text);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:38px 22px 70px}.top{display:flex;align-items:center;gap:14px;padding-bottom:24px;border-bottom:1px solid var(--line)}
.mark{width:48px;height:48px;border-radius:15px;background:linear-gradient(135deg,#21b6db,#1760a4);display:grid;place-items:center;font-weight:900;font-size:20px;color:white;box-shadow:0 8px 30px #16b8df35}
.brand{font-weight:800;letter-spacing:.12em;font-size:13px}.sub{color:var(--muted);font-size:12px}
h1{font-size:clamp(24px,4vw,34px);line-height:1.15;margin:28px 0 8px}.lead{color:var(--muted);margin:0 0 24px}
.badge{display:inline-block;border:1px solid #1d7792;color:#7ee7fa;background:#0c2b39;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;letter-spacing:.08em}
.details{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin:22px 0 30px}
.detail{min-width:0}.detail span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.detail strong{display:block;overflow-wrap:anywhere;font-size:13px;margin-top:3px}
.section-title{display:flex;align-items:center;gap:12px;margin:30px 0 14px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#aebbd0}.section-title:after{content:"";height:1px;background:var(--line);flex:1}
.messages{display:flex;flex-direction:column;gap:2px}.message{display:flex;gap:13px;padding:15px 13px;border:1px solid transparent;border-radius:12px}.message:hover{background:#111a27;border-color:#1c2a3d}.avatar{width:36px;height:36px;border-radius:50%;background:#26364a;object-fit:cover;flex:none}.message-main{min-width:0;flex:1}.message-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.message-meta strong{font-size:14px}.message-meta time{color:var(--muted);font-size:11px}.tag{font-size:9px;padding:1px 5px;border-radius:4px;background:#203a58;color:#9ed5ff}.message-content{white-space:normal;overflow-wrap:anywhere;margin-top:4px}.attachments{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.attachment{display:inline-block;background:#172438;border:1px solid #2a3b54;color:#9bdff1;text-decoration:none;border-radius:8px;padding:6px 9px;font-size:12px}.discord-embed{margin-top:8px;padding:10px 12px;border-left:3px solid var(--cyan);background:#101d2b;border-radius:0 8px 8px 0;color:#d1dbea}.embed-field{margin-top:8px}.embed-field b,.embed-field span{display:block}.embed-field b{font-size:12px}.embed-field span{font-size:13px;color:#b9c6d8}
.footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:560px){.wrap{padding:24px 14px 45px}.details{grid-template-columns:1fr 1fr}.message{padding:12px 5px;gap:9px}.avatar{width:30px;height:30px}}
@media print{body{background:#fff;color:#111}.details,.message,.discord-embed{background:#f5f7fa;border-color:#ddd;color:#111}.detail span,.message-meta time,.footer{color:#555}.attachment{color:#07536a}}
</style></head><body><main class="wrap">
<header class="top"><div class="mark">N</div><div><div class="brand">NOVEX MARKET</div><div class="sub">CUSTOMER SUPPORT · TICKET ARCHIVE</div></div></header>
<h1>${escapeHtml(ticket.category)} request transcript</h1><p class="lead">A complete conversation record for your Novex Market support request.</p><span class="badge">ARCHIVED · ${reference}</span>
<section class="details">${detailHtml}</section>
<div class="section-title">Conversation history</div><section class="messages">${rows || '<p>No messages were recorded in this ticket.</p>'}</section>
<footer class="footer"><span>Novex Market · Support archive</span><span>Keep this file safe for your records.</span></footer>
</main></body></html>`;
}
async function generateTranscript(channel, ticket) {
  let messages = [], before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values()); before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const html = transcriptHtml(ticket, messages);
  ticket.transcriptHtml = html;
  ticket.transcriptFileName = `novex-${ticket.category.toLowerCase()}-${String(ticket.number).padStart(5, '0')}.html`;
  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: ticket.transcriptFileName });
}
async function closeTicket(interaction, ticket, reason = 'No reason provided.') {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const channel = interaction.channel;
  ticket.status = 'closed'; ticket.closedAt = Date.now(); ticket.closedBy = interaction.user.id; ticket.closeReason = reason;
  const attachment = await generateTranscript(channel, ticket);
  await persist();
  const creator = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
  if (creator) await creator.send({ content: `Your Novex Market ${ticket.category.toLowerCase()} request (reference **NVX-${String(ticket.number).padStart(5, '0')}**) has been closed. Reason: ${reason}`, files: [attachment] }).catch(() => {});
  await log(interaction.guild, `🔒 **${ticket.category.toUpperCase()} REQUEST CLOSED** · NVX-${String(ticket.number).padStart(5, '0')} · Closed by <@${interaction.user.id}>. Reason: ${reason}`, attachment);
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
    if (!ticket) return interaction.reply({ content: 'This request is no longer open.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    return applyClaim(interaction, ticket);
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
        if (old) { await old.edit({ embeds: [panelEmbed()], components: panelComponents(), files: [ICON_PATH, BANNER_PATH].filter(file => fs.existsSync(file)) }); return interaction.reply({ content: 'Existing Novex Support panel updated.', ephemeral: true }); }
      }
    }
    const msg = await channel.send({ embeds: [panelEmbed()], components: panelComponents(), files: [ICON_PATH, BANNER_PATH].filter(file => fs.existsSync(file)) });
    state().settings.panelMessageId = msg.id; state().settings.panelChannelId = channel.id; await persist();
    return interaction.reply({ content: 'Novex Support panel sent.', ephemeral: true });
  }
  const ticket = ticketForChannel(interaction.channelId);
  if (name === 'ticketclaim') {
    if (!ticket) return interaction.reply({ content: 'Use this command inside an open request.', ephemeral: true });
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    return applyClaim(interaction, ticket);
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
    const msg = `Reminder: please reply to your Novex Market request (NVX-${String(ticket.number).padStart(5, '0')}) when you can. It may close automatically if there is no response.`;
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
  if (name === 'mytickets') {
    const found = Object.values(state().tickets).filter(t => t.creatorId === interaction.user.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (!found.length) return interaction.reply({ content: 'You do not have any Novex support history yet.', ephemeral: true });
    const embed = new EmbedBuilder().setColor(BRAND).setTitle('YOUR NOVEX MARKET HISTORY')
      .setDescription(found.slice(0, 10).map(t => {
        const ref = `NVX-${String(t.number).padStart(5, '0')}`;
        return `**${ref}** · ${t.category} · ${t.status.toUpperCase()} · <t:${Math.floor(t.createdAt / 1000)}:d>${t.transcriptHtml ? ' · HTML transcript attached' : ' · Transcript will be available after closure'}`;
      }).join('\n'))
      .setFooter({ text: 'Your private ticket history · Latest 10 requests' });
    const files = found.filter(t => t.transcriptHtml).slice(0, 5).map(t =>
      new AttachmentBuilder(Buffer.from(t.transcriptHtml, 'utf8'), { name: t.transcriptFileName || `novex-ticket-${t.number}.html` })
    );
    return interaction.reply({ embeds: [embed], files, ephemeral: true });
  }
  if (name === 'transcriptlookup') {
    if (!isStaff(interaction.member, interaction.client)) return interaction.reply({ content: 'Authorised staff only.', ephemeral: true });
    const userId = interaction.options.getString('user_id');
    const found = Object.values(state().tickets).filter(t => t.creatorId === userId).sort((a, b) => b.createdAt - a.createdAt);
    if (!found.length) return interaction.reply({ content: `No Novex ticket history found for user ID ${userId}.`, ephemeral: true });
    const embed = new EmbedBuilder().setColor(BRAND).setTitle('NOVEX MARKET  •  CUSTOMER HISTORY')
      .setDescription(found.slice(0, 15).map(t => {
        const ref = `NVX-${String(t.number).padStart(5, '0')}`;
        return `**${ref}** · ${t.category} · ${t.status.toUpperCase()} · <t:${Math.floor(t.createdAt / 1000)}:R>${t.transcriptHtml ? ' · HTML available below' : ' · Transcript unavailable'}`;
      }).join('\n'))
      .setFooter({ text: `${found.length} request(s) found · Showing latest 15` });
    const files = found.filter(t => t.transcriptHtml).slice(0, 5).map(t =>
      new AttachmentBuilder(Buffer.from(t.transcriptHtml, 'utf8'), { name: t.transcriptFileName || `novex-ticket-${t.number}.html` })
    );
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
      const msg = `You have not replied to your Novex Market ${ticket.category.toLowerCase()} request (NVX-${String(ticket.number).padStart(5, '0')}) for ${process.env.REMINDER_HOURS || 6} hours. Please reply within the next ${process.env.AUTO_CLOSE_HOURS || 6} hours or the ticket will close automatically.`;
      await channel.send(`<@${ticket.creatorId}> ${msg}`).catch(() => {});
      if (user) await user.send(msg).catch(() => {});
      ticket.reminderSentAt = Date.now(); await persist();
    } else if (ticket.reminderSentAt && Date.now() - ticket.reminderSentAt >= closeMs) {
      const fake = { channel, guild, client, user: client.user, deferReply: async () => {}, editReply: async () => {} };
      ticket.status = 'closed'; ticket.closedAt = Date.now(); ticket.closedBy = client.user.id; ticket.closeReason = 'Automatically closed after inactivity.';
      const attachment = await generateTranscript(channel, ticket);
      await persist();
      const user = await client.users.fetch(ticket.creatorId).catch(() => null);
      if (user) await user.send({ content: `Your Novex Market ${ticket.category.toLowerCase()} request (reference **NVX-${String(ticket.number).padStart(5, '0')}**) was automatically closed after inactivity.`, files: [attachment] }).catch(() => {});
      await log(guild, `⏰ **${ticket.category.toUpperCase()} REQUEST AUTO-CLOSED** · NVX-${String(ticket.number).padStart(5, '0')} · No customer response.`, attachment);
      setTimeout(() => channel.delete('Novex ticket automatically closed').catch(() => {}), 10_000).unref?.();
    }
  }
}
module.exports = { handleInteraction, handleCommand, onMessage, inactivitySweep, panelEmbed, panelComponents };
