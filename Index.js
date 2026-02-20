// =========================
// Big Brother Bot - Crash Proof
// =========================
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

// ---------------- DATABASE ----------------------
mongoose.connect(process.env.MONGO_URI)
  .then(()=>console.log("✅ MongoDB connected"))
  .catch(err=>console.log(err));

// ---------------- SCHEMAS -----------------------
const playerSchema = new mongoose.Schema({
  userId: String,
  username: String,
  hohWins: {type:Number,default:0},
  povWins: {type:Number,default:0},
  totalPoints: {type:Number,default:0},
  evicted: {type:Boolean,default:false},
  jury: {type:Boolean,default:false},
  powerUsed: {type:Boolean,default:false}
});
const voteSchema = new mongoose.Schema({
  voterId:String,
  targetId:String,
  week:Number
});
const weekSchema = new mongoose.Schema({currentWeek:{type:Number,default:1}});
const archiveSchema = new mongoose.Schema({winnerId:String, seasonNumber:Number, date:Date});
const Player = mongoose.model("Player", playerSchema);
const Vote = mongoose.model("Vote", voteSchema);
const Week = mongoose.model("Week", weekSchema);
const Archive = mongoose.model("Archive", archiveSchema);

// ---------------- CLIENT ------------------------
const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------------- GAME STATE --------------------
let gameState = "IDLE";
let nominees = [];
let doubleEviction = false;

// ---------------- HELPERS -----------------------
function isProduction(member){return member.roles.cache.some(r=>r.name==="Production");}
async function updateLiveStats(guild){
  try{
    const players = await Player.find().sort({totalPoints:-1});
    let text="📊 LIVE SEASON STATS\n\n";
    players.forEach((p,i)=>{text+=`${i+1}. ${p.username} | HOH:${p.hohWins} POV:${p.povWins} Points:${p.totalPoints}\n`});
    const channel = guild.channels.cache.find(c=>c.name==="live-stats");
    if(channel){
      try{
        const messages = await channel.messages.fetch({limit:10});
        await channel.bulkDelete(messages);
      }catch(e){console.log("Live stats bulk delete skipped:",e);}
      channel.send(text);
    }
  }catch(e){console.log("Error updating live stats:",e);}
}

// ---------------- READY -------------------------
client.once('ready', async()=>{
  console.log(`✅ Bot online as ${client.user.tag}`);
  if(!(await Week.findOne())) await Week.create({});
});

// ---------------- COMMANDS ----------------------
client.on('messageCreate', async message=>{
  if(message.author.bot) return;
  const args = message.content.split(" ");
  const command = args[0];

  try{
    // ---- REGISTER ----
    if(command==="!register"){
      if(await Player.findOne({userId:message.author.id})) return message.reply("Already registered.");
      await Player.create({userId:message.author.id, username:message.author.username});
      return message.reply("✅ Registered for the season!");
    }

    // ---- HOH ----
    if(command==="!assign_hoh"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      const member = message.mentions.members.first();
      if(!member) return message.reply("Mention a player.");
      let role = message.guild.roles.cache.find(r=>r.name==="HOH");
      if(!role) role = await message.guild.roles.create({name:"HOH", color:"Gold"});
      await Player.updateOne({userId:member.id},{$inc:{hohWins:1}});
      await member.roles.add(role);
      message.channel.send(`👑 ${member} is HOH!`);
      await updateLiveStats(message.guild);
    }

    // ---- POV ----
    if(command==="!assign_pov"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      const member = message.mentions.members.first();
      if(!member) return message.reply("Mention a player.");
      let role = message.guild.roles.cache.find(r=>r.name==="POV");
      if(!role) role = await message.guild.roles.create({name:"POV", color:"Blue"});
      await Player.updateOne({userId:member.id},{$inc:{povWins:1}});
      await member.roles.add(role);
      message.channel.send(`🏅 ${member} wins POV!`);
      await updateLiveStats(message.guild);
    }

    // ---- NOMINATIONS ----
    if(command==="!start_nominations"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      gameState="NOMINATION"; nominees=[];
      message.channel.send("👑 HOH must DM: !nominate @Player (max 2)");
    }
    if(command==="!nominate" && !message.guild && gameState==="NOMINATION"){
      const mentioned = message.mentions.users.first();
      if(!mentioned) return message.reply("Mention a player.");
      if(nominees.includes(mentioned.id)) return message.reply("Already nominated.");
      if(nominees.length>=2) return message.reply("Already nominated 2 players.");
      nominees.push(mentioned.id);
      message.reply(`Nominee ${mentioned.username} locked.`);
      if(nominees.length===2) gameState="VETO";
    }

    // ---- VETO ----
    if(command==="!use_veto" && !message.guild && gameState==="VETO"){
      const mentioned = message.mentions.users.first();
      if(!mentioned) return message.reply("Mention nominee to remove.");
      nominees = nominees.filter(id=>id!==mentioned.id);
      gameState="NOMINATION";
      message.reply("Veto used. HOH, select replacement.");
    }

    // ---- START VOTE ----
    if(command==="!start_vote"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      message.channel.send("🗳️ Voting started. Players DM: !vote @Player");
    }
    if(command==="!vote" && !message.guild){
      const mentioned = message.mentions.users.first();
      if(!mentioned) return message.reply("Mention a player.");
      const week = (await Week.findOne()).currentWeek;
      if(await Vote.findOne({voterId:message.author.id, week})) return message.reply("You already voted.");
      await Vote.create({voterId:message.author.id, targetId:mentioned.id, week});
      message.reply("✅ Vote recorded.");
    }

    // ---- END VOTE ----
    if(command==="!end_vote"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      const week = (await Week.findOne()).currentWeek;
      const results = await Vote.aggregate([
        {$match:{week}},
        {$group:{_id:"$targetId",count:{$sum:1}}},
        {$sort:{count:-1}}
      ]);
      if(!results.length) return message.reply("No votes.");
      const loser = results[0]._id;
      await Player.updateOne({userId:loser},{evicted:true,jury:true});
      message.channel.send(`🚪 Evicted: <@${loser}>`);
      gameState = doubleEviction ? "NOMINATION" : "IDLE";
      if(!doubleEviction){
        const weekDoc = await Week.findOne();
        weekDoc.currentWeek+=1; await weekDoc.save();
        message.channel.send(`📅 Week ${weekDoc.currentWeek} begins!`);
      } else {
        doubleEviction=false;
        message.channel.send("⚡ Double eviction cycle starts.");
      }
      await updateLiveStats(message.guild);
    }

    // ---- SCOREBOARD ----
    if(command==="!scoreboard"){
      const players = await Player.find().sort({totalPoints:-1});
      let board="📊 LIVE SCOREBOARD\n\n";
      players.forEach((p,i)=>{board+=`${i+1}. ${p.username} - ${p.totalPoints} pts\n`;});
      message.channel.send(board);
    }

    // ---- END SEASON ----
    if(command==="!end_season"){
      if(!isProduction(message.member)) return message.reply("Production only.");
      const winner = await Player.findOne({evicted:false});
      if(!winner) return message.reply("No winner found.");
      await Archive.create({winnerId:winner.userId, seasonNumber:1, date:new Date()});
      message.channel.send(`🎉 SEASON WINNER: <@${winner.userId}>`);
    }

  } catch(err){
    console.log("Command error:", err);
    message.reply("❌ Error executing command, check console.");
  }

});

client.login(process.env.TOKEN);
