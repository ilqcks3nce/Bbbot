require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const mongoose = require("mongoose");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ================= DATABASE =================

mongoose.connect(process.env.MONGO_URI);

const playerSchema = new mongoose.Schema({
  userId: String,
  username: String,
  hohWins: { type: Number, default: 0 },
  povWins: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  powerUsed: { type: Boolean, default: false }
});

const voteSchema = new mongoose.Schema({
  voterId: String,
  targetId: String
});

const archiveSchema = new mongoose.Schema({
  seasonNumber: Number,
  winnerId: String
});

const Player = mongoose.model("Player", playerSchema);
const Vote = mongoose.model("Vote", voteSchema);
const Archive = mongoose.model("Archive", archiveSchema);

// ================= GAME STATE =================

let gameState = "OFF";
let nominations = [];
let hoh = null;
let activeGame = null;
let gameScores = {};
let gameTimer = null;
let seasonNumber = 1;

// ================= HELPERS =================

function isProduction(member) {
  return member.roles.cache.some(r => r.name === "Production");
}

async function updateLiveStats(guild) {
  const players = await Player.find().sort({ totalPoints: -1 });

  let text = "📊 LIVE SEASON STATS\n\n";
  players.forEach((p, i) => {
    text += `${i + 1}. ${p.username}\nHOH: ${p.hohWins}\nPOV: ${p.povWins}\nPoints: ${p.totalPoints}\n\n`;
  });

  const channel = guild.channels.cache.find(c => c.name === "live-stats");
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 10 });
  await channel.bulkDelete(messages);
  channel.send(text);
}

// ================= BOT READY =================

client.once("ready", () => {
  console.log(`Bot Online: ${client.user.tag}`);
});

// ================= MESSAGE HANDLER =================

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const args = message.content.split(" ");
  const command = args[0];

  // ================= REGISTER =================

  if (command === "!register") {
    const exists = await Player.findOne({ userId: message.author.id });
    if (exists) return message.reply("Already registered.");

    await Player.create({
      userId: message.author.id,
      username: message.author.username
    });

    message.reply("You are now a Houseguest.");
  }

  // ================= START SEASON =================

  if (command === "!start_season") {
    if (!isProduction(message.member)) return;
    gameState = "HOH";
    nominations = [];
    await Vote.deleteMany({});
    message.channel.send(`🎬 Season ${seasonNumber} has begun! HOH Competition starting.`);
  }

  // ================= SET HOH =================

  if (command === "!set_hoh") {
    if (!isProduction(message.member)) return;

    const member = message.mentions.members.first();
    if (!member) return;

    hoh = member.id;
    await Player.updateOne({ userId: hoh }, { $inc: { hohWins: 1 } });

    message.channel.send(`👑 ${member} is the new HOH!`);
    await updateLiveStats(message.guild);
  }

  // ================= NOMINATE =================

  if (command === "!nominate") {
    if (message.author.id !== hoh) return;

    const target = message.mentions.members.first();
    if (!target) return;

    nominations.push(target.id);
    message.channel.send(`${target} has been nominated.`);
  }

  // ================= START VOTING =================

  if (command === "!start_voting") {
    if (!isProduction(message.member)) return;
    gameState = "VOTING";
    await Vote.deleteMany({});
    message.channel.send("🗳 Voting is open! DM the bot: !vote @player");
  }

  // ================= VOTE (DM ONLY) =================

  if (command === "!vote" && !message.guild) {
    const target = message.mentions.users.first();
    if (!target) return;

    await Vote.deleteOne({ voterId: message.author.id });
    await Vote.create({
      voterId: message.author.id,
      targetId: target.id
    });

    message.reply("Your vote has been cast.");
  }

  // ================= REVEAL VOTES =================

  if (command === "!reveal_votes") {
    if (!isProduction(message.member)) return;

    const results = await Vote.aggregate([
      { $group: { _id: "$targetId", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    if (!results.length) return message.channel.send("No votes cast.");

    const evicted = results[0]._id;

    message.channel.send("After counting the votes...");
    setTimeout(async () => {
      message.channel.send(`🚪 <@${evicted}> has been evicted.`);
      await updateLiveStats(message.guild);
    }, 5000);
  }

  // ================= TRIVIA COMP =================

  if (command === "!start_trivia") {
    if (!isProduction(message.member)) return;

    activeGame = "TRIVIA";
    gameScores = {};
    message.channel.send("🎮 Trivia started! Answer with !answer yourAnswer");

    gameTimer = setTimeout(async () => {
      activeGame = null;

      const winner = Object.keys(gameScores)
        .sort((a, b) => gameScores[b] - gameScores[a])[0];

      if (winner) {
        await Player.updateOne({ userId: winner }, { $inc: { totalPoints: 5 } });
        message.channel.send(`🏆 Trivia Winner: <@${winner}>`);
      } else {
        message.channel.send("No winner.");
      }

      await updateLiveStats(message.guild);
    }, 60000);
  }

  if (command === "!answer" && activeGame === "TRIVIA") {
    const answer = args.slice(1).join(" ").toLowerCase();

    if (answer === "paris") {
      gameScores[message.author.id] =
        (gameScores[message.author.id] || 0) + 1;

      message.reply("Correct!");
    }
  }

  // ================= SECRET POWER =================

  if (command === "!use_power" && !message.guild) {
    const player = await Player.findOne({ userId: message.author.id });
    if (!player || player.powerUsed)
      return message.reply("No usable power.");

    await Vote.deleteOne({ voterId: message.author.id });

    player.powerUsed = true;
    await player.save();

    message.reply("Your secret power has been activated.");
  }

  // ================= FINALE =================

  if (command === "!start_finale") {
    if (!isProduction(message.member)) return;
    message.channel.send("🎤 Finalists, please state your case.");
  }

  if (command === "!jury_question") {
    if (!isProduction(message.member)) return;

    const mentioned = message.mentions.members.first();
    const question = args.slice(2).join(" ");

    message.channel.send(`❓ Jury Question to ${mentioned}: ${question}`);
  }

  if (command === "!finale_reveal") {
    if (!isProduction(message.member)) return;

    const results = await Vote.aggregate([
      { $group: { _id: "$targetId", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    if (!results.length) return;

    message.channel.send("After counting the jury votes...");
    setTimeout(async () => {
      message.channel.send(`🎉 The Winner Is... <@${results[0]._id}>`);
      await Archive.create({
        seasonNumber,
        winnerId: results[0]._id
      });
      seasonNumber++;
    }, 6000);
  }

  // ================= SEASON HISTORY =================

  if (command === "!season_history") {
    const seasons = await Archive.find().sort({ seasonNumber: -1 });

    let text = "📜 SEASON HISTORY\n\n";
    seasons.forEach(s => {
      text += `Season ${s.seasonNumber} Winner: <@${s.winnerId}>\n`;
    });

    message.channel.send(text);
  }

});

client.login(process.env.TOKEN);
