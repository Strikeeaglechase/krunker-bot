const Discord = require('discord.js');
const dotevn = require('dotenv').config();
const msgpack = require("msgpack-lite");
const WebSocket = require('ws');
const fs = require('fs');

const DISCORD_API_TOKEN = dotevn.parsed.DISCORD_API_TOKEN;

const client = new Discord.Client();
const prefix = '>';
const {
	Krunker: Api,
	OrderBy,
	UserNotFoundError
} = require("@fasetto/krunker.io")
const Krunker = new Api();
const rateOpts = {
	kdr: 1.75,
	kpg: 10,
	spk: 105,
	wl: 0.5,
	acc: 0.25
}
var userIdx = 0;
var lookups = [];
const maxToAuto = 5;

var data = {
	users: [],
	clanMessages: [],
	guildOpts: {}
}

function whois(id) {
	var user = data.users.find(user => user.id == id);
	if (user) {
		return user.krunkerName;
	}
	return undefined;
}

var msgHandler = {
	setname: {
		description: 'Sets a user\'s krunker name, can be used like >setname name or >setname @user name',
		run: function(msg) {
			var args = msg.content.split(' ');
			var kName = args[1];
			var user = msg.author;
			var existUser = data.users.find(user => user.id == msg.author.id);
			if (existUser) {
				existUser.krunkerName = kName;
			} else {
				var userData = {
					username: msg.author.username,
					rating: 1,
					id: msg.author.id,
					krunkerName: kName
				};
				data.users.push(userData);
				console.log('New user');
			}
			save();
			msg.channel.send('Set your krunker username as ' + kName);
		}
	},
	lookup: {
		description: 'Displays a users krunker stats, can be used like >lookup name or >lookup @user',
		run: function(msg) {
			var mentUsers = msg.mentions.users.map(t => t);
			var args = msg.content.split(' ');
			var name = args[1];
			if (mentUsers.length > 0) {
				name = whois(mentUsers[0].id);
			}
			if (!name) {
				msg.reply('Could not find that user');
			} else {
				msg.channel.send('Looking up...');
				kLooup(name, msg);
			}
		}
	},
	whois: {
		description: 'Checks a members set Krunker name',
		run: function(msg) {
			var user = msg.mentions.users.first();
			if (!user) {
				msg.reply('Invalid user');
				return;
			}
			var name = whois(user.id);
			if (name) {
				msg.channel.send(name);
			} else {
				msg.reply('No user account found');
			}
		}
	},
	rate: {
		description: 'Gets a user\'s rating, can be used like >rate name or >rate @user',
		run: async function(msg) {
			var mentUsers = msg.mentions.users.map(t => t);
			var args = msg.content.split(' ');
			var name = args[1];
			if (mentUsers.length > 0) {
				name = whois(mentUsers[0].id);
			}
			msg.channel.send('Looking up...');
			var rating = await kRate(name, msg);
			if (rating) {
				data.users.find(user => user.krunkerName == name).rating = rating;
				msg.channel.send(name + ' has a overall rating of: ' + rating);
			}
		}
	},
	leaderboard: {
		description: 'Displays the rating leaderboard',
		run: function(msg) {
			displayBoard(msg, data.users);
		}
	},
	clanadd: {
		description: 'Add clan info message, usage: clanadd [clanName]',
		run: async function(msg) {
			var args = msg.content.split(' ');
			if (args[1]) {
				var emb = new Discord.RichEmbed();
				var sentMsg = await msg.channel.send(emb);
				data.clanMessages.push({
					messageId: sentMsg.id,
					channelId: msg.channel.id,
					guildId: msg.guild.id,
					clanName: args[1]
				});
			}
		}
	},
	help: {
		description: 'I mean, your reading it',
		run: function(msg) {
			var emb = new Discord.RichEmbed();
			emb.setTitle('Help');
			for (var i in msgHandler) {
				emb.addField(i, msgHandler[i].description);
			}
			msg.channel.send(emb);
		}
	},
};

client.on('ready', () => {
	console.log('Logged in as %s', client.user.tag);
	read();
});
client.on('message', msg => {
	if (!msg.content.startsWith(prefix) || msg.author.bot) {
		return;
	}
	handleCommand(msg);
});

async function handleCommand(msg) {
	var txt = msg.content.substring(1, msg.content.length);
	var command = txt.split(' ')[0].toLowerCase();
	if (typeof msgHandler[command] == 'object') {
		await msgHandler[command].run(msg);
	} else {
		msg.reply('Unknown command');
	}
}

function save() {
	fs.writeFileSync('data.json', JSON.stringify(data));
}

function read() {
	data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
}

async function getClanData(clanName) {
	var socket = new WebSocket('wss://krunker_social.krunker.io/ws', {
		handshakeTimeout: 5000,
	});
	socket.onopen = () => {
		const data = msgpack.encode(['r', ["clan", clanName, null, null, null, "0"]]);
		socket.send(data.buffer);
	}
	return new Promise(resolve => {
		socket.onmessage = buff => {
			const data = msgpack.decode(new Uint8Array(buff.data));
			if (data[0] != 'pi') {
				resolve(data[1][2]);
			}
		}
	});
}

async function updateClanData(idx) {
	if (idx >= data.clanMessages.length) {
		idx = 0;
	}
	// console.log(data.clanMessages);
	if (data.clanMessages.length > 0) {
		var clanData = await getClanData(data.clanMessages[idx].clanName);
		if (clanData) {
			var emb = new Discord.RichEmbed();
			emb.setTitle(clanData.clan_name);
			// emb.setAuthor(clanData.creatorname);
			emb.setDescription('Score: ' + clanData.clan_score);
			emb.setFooter(clanData.members.length + ' members');
			emb.addField('Members', clanData.members.map(memb => memb.player_name).join('\n'));
			try {
				var guild = client.guilds.get(data.clanMessages[idx].guildId);
				if (guild) {
					var channel = guild.channels.get(data.clanMessages[idx].channelId);
					if (channel) {
						var msg;
						try {
							msg = await channel.fetchMessage(data.clanMessages[idx].messageId);
						} catch (e) {}
						if (!msg || msg.deleted) {
							data.clanMessages.splice(idx, 1);
							console.log('Deleted clan message');
						} else {
							msg.edit(emb);
						}
					}
				}
			} catch (e) {
				console.log(e);
			}
		}
	}
	setTimeout(updateClanData, 5000, idx + 1);
}

async function runRates() {
	if (lookups.length > maxToAuto) {
		console.log('Bot under load');
		return;
	}
	userIdx++;
	if (userIdx > data.users.length) {
		userIdx = 0;
	}
	var user = data.users[userIdx];
	if (user) {
		var rating = await kRate(user.krunkerName);
		if (rating) {
			user.rating = rating;
		} else {
			// console.log('Rating faild for %s', user.username);
		}
	}
	setTimeout(runRates, 5000);
}

function prepData(data) {
	var str = '```';
	for (var i in data) {
		str += i + ': ' + data[i] + '\n';
	}
	return str + '```';
}

async function runLookups() {
	var lookup = lookups.shift();
	if (lookup) {
		try {
			var data = await Krunker.GetProfile(lookup.name);
			lookup.onFinish(data);
		} catch (e) {
			lookup.onError(e);
		}
	}
	setTimeout(runLookups);
}

function getProfile(name) {
	return new Promise(function(resolve, reject) {
		lookups.push({
			name: name,
			onFinish: resolve,
			onError: reject
		});
	});
}

async function kLooup(name, msg) {
	try {
		const user = await getProfile(name);
		if (msg) {
			msg.channel.send(prepData(user));
		}
		return user;
	} catch (e) {
		if (e instanceof UserNotFoundError) {
			msg.channel.send('User could not be found');
		} else {
			msg.channel.send('Misc API error');
			console.log(name, e);
		}
	}
}

async function kRate(name, msg) {
	try {
		// const user = await Krunker.GetProfile(name);
		const user = await getProfile(name);
		var ratings = {
			kdr: Math.pow(user.kdr / rateOpts.kdr, 2),
			kpg: Math.pow(user.kpg / rateOpts.kpg, 2),
			spk: Math.pow(user.spk / rateOpts.spk, 2),
			wl: Math.pow(user.wl / rateOpts.wl, 2),
			acc: Math.pow((user.hits / user.shots) / rateOpts.acc, 2),
		}
		var total = 0;
		var num = 0;
		for (var i in ratings) {
			total += ratings[i];
			num++;
		}
		var rating = (total / num).toFixed(3);
		return rating;
	} catch (e) {
		if (msg) {
			if (e instanceof UserNotFoundError) {
				msg.channel.send('User could not be found');
			} else {
				msg.channel.send('Misc API error');
				console.log(name, e);
			}
		}
	}
}

async function displayBoard(msg, userList) {
	msg.channel.send('Working... Please wait a moment');
	var data = [];
	for (var i in userList) {
		var user = userList[i].krunkerUser;
		var val = userList[i].rating;
		var username = userList[i].username;
		if (val && !isNaN(val) && val != Infinity) {
			var member = msg.guild.members.get(userList[i].id);
			data.push({
				val: val,
				user: username
			});
		}
	}
	data.sort((a, b) => b.val - a.val);
	var emb = new Discord.RichEmbed();
	var txt = '';
	data.forEach((obj, idx) => {
		txt += (idx + 1) + ' - ' + obj.user + ' (' + obj.val + ')\n';
	});
	emb.setTitle('Leaderboard');
	emb.addField('-', txt);
	msg.channel.send(emb);
}

client.login(DISCORD_API_TOKEN);
runLookups();
runRates();
updateClanData(0);
setInterval(save, 10000);