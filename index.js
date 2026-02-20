const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// Diary Room Request
if (message.content === "!dr_request") {
  const player = message.member;
  const guild = message.guild;

  // Find Production role
  const productionRole = guild.roles.cache.find(r => r.name === "Production");

  if (!productionRole) {
    return message.reply("Production role not found. Create a 'Production' role first.");
  }

  const threadName = `dr-${player.user.username}-${Date.now()}`;

  const channel = await guild.channels.create({
    name: threadName,
    type: 0, // Text channel
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: ["ViewChannel"]
      },
      {
        id: player.id,
        allow: ["ViewChannel", "SendMessages"]
      },
      {
        id: productionRole.id,
        allow: ["ViewChannel", "SendMessages"]
      }
    ]
  });

  channel.send(`🎥 Diary Room session started for ${player}. Production has been notified.`);
}

  // Assign HOH
  if (message.content.startsWith('!assign_hoh')) {
    const member = message.mentions.members.first();
    if (!member) return message.reply("Mention a player.");

    let role = message.guild.roles.cache.find(r => r.name === "HOH");
    if (!role) {
      role = await message.guild.roles.create({
        name: "HOH",
        color: "Gold"
      });
    }

    const oldHOH = message.guild.members.cache.filter(m => m.roles.cache.has(role.id));
    oldHOH.forEach(m => m.roles.remove(role));

    await member.roles.add(role);
    message.channel.send(`${member} is the new HOH!`);
  }

  // Create Alliance
  if (message.content.startsWith('!create_alliance')) {
    const args = message.content.split(' ');
    const name = args[1];
    const members = message.mentions.members;

    if (!name || members.size === 0)
      return message.reply("Usage: !create_alliance name @Player1 @Player2");

    const channel = await message.guild.channels.create({
      name: `alliance-${name}`,
      type: 0,
      permissionOverwrites: [
        {
          id: message.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        ...members.map(m => ({
          id: m.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        }))
      ]
    });

    message.channel.send(`Alliance channel created: ${channel}`);
  }
});

client.login(process.env.TOKEN);
