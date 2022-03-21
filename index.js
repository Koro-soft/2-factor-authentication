'use strict';
const express = require('express');
const Discord = require('discord.js');
const fetch = require('node-fetch');
const Mongo = require('mongodb');
const crypto = require('crypto');
const hash = function (value) { return crypto.createHash('sha512').update(value).digest('hex'); }
const app = express();
const client = new Discord.Client({
    intents: [Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MEMBERS]
});
client.on('guildMemberAdd', function (member) {
    const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
    dbclient.connect().then(function (mongoclient) {
        const setting = mongoclient.db('2auth').collection('setting');
        const authing = mongoclient.db('2auth').collection('authing');
        const authed = mongoclient.db('2auth').collection('authed');
        setting.findOne({ guild: member.guild.id }).then(function (hitsetting) {
            let authend = true;
            try {
                authed.findOne({ id: hash(member.id) }).then(function (id) {
                    if (hitsetting.canold == 1 && id != null) {
                        member.roles.add(hitsetting.roleid);
                        authend = false
                    }
                });
            } catch { } finally {
                if (authend) {
                    member.createDM().then(function (dm) {
                        const code = Math.floor(Math.random() * 1000000);
                        authing.insertOne({ id: member.id, guild: member.guild.id, code: code }).then(function () {
                            dm.send('Please open this url to complete the authentication. https://twofactorauthenticationservice.herokuapp.com/?start=0 And enter the code');
                            dm.send(String(code)).then(function (vaule) { dm.messages.pin(vaule); });
                            dbclient.close();
                        });
                    });
                }
            }
        });
    });
});

client.on('ready', function () {
    console.log('client is ready');
    const data = [{
        name: 'twofa',
        description: 'Set up two-factor authentication',
        options: [{
            type: 'ROLE',
            name: 'verifiedrole',
            description: 'Roles given to authenticated members. If you specify @everyone, disable authentication',
            required: true
        }, {
            type: 'BOOLEAN',
            name: 'canuseoldauthdata',
            description: '(Default: true) Whether or not data that has been authenticated in the past can be used',
            required: false
        }]
    }]
    client.application.commands.set(data);
});
client.on('interactionCreate', function (interaction) {
    if (!interaction.isCommand()) {
        return;
    }
    if (interaction.commandName === 'twofa') {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            interaction.reply({ content: 'Administrator rights are required to run this command', ephemeral: true });
            return
        }
        let oldauthdata = interaction.options.getBoolean('canuseoldauthdata');
        if (oldauthdata == null) {
            oldauthdata = true
        }
        const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
        dbclient.connect().then(function (mongoclient) {
            const setting = mongoclient.db('2auth').collection('setting');
            if (interaction.options.getRole('verifiedrole').id == interaction.guild.roles.everyone.id) {
                setting.findOne({ guild: interaction.guild.id }).then(function () {
                    dbclient.close();
                });
            } else {
                setting.findOne({ guild: interaction.guild.id }).then(function (hit) {
                    if (hit) {
                        setting.findOneAndUpdate({ guild: interaction.guild.id }, { guild: interaction.guild.id, canold: oldauthdata, role: interaction.options.getRole('verifiedrole').id });
                    } else {
                        setting.insertOne({ guild: interaction.guild.id, canold: oldauthdata, role: interaction.options.getRole('verifiedrole').id });
                    }
                    dbclient.close();
                });
            }
        });
        interaction.reply({ content: 'Updating settings', ephemeral: true });
    }
});
client.login();
app.get('/', function (request, response) {
    if (request.query.code) {
        fetch('https://discordapp.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&grant_type=authorization_code&code=${request.query.code}&redirect_uri=https://twofactorauthenticationservice.herokuapp.com/`
        }).then(function (res) {
            res.json().then(function (json) {
                const access_token = json.access_token
                fetch('https://discordapp.com/api/users/@me', {
                    headers: {
                        'Authorization': `Bearer ${access_token}`
                    }
                }).then(function (res) {
                    res.json().then(function (json) {
                        return response.redirect(`/?id=${json.id}`);
                    });
                });
            });
        });
    } else if (request.query.number && request.query.id && request.query.savehash) {
        const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
        dbclient.connect().then(function (mongoclient) {
            const setting = mongoclient.db('2auth').collection('setting');
            const authing = mongoclient.db('2auth').collection('authing');
            const authed = mongoclient.db('2auth').collection('authed');
            authing.findOne({ id: request.query.id }).then(function (hit) {
                if (hit.code == request.query.number) {
                    response.send('<h1>Authentication successful! <a href="#" onclick="window.close();return false">You can close this window</a></h1>');
                    setting.findOne({ guild: hit.guild }).then(function (hitsetting) {
                        try {
                            authed.findOne({ id: hash(request.query.id) }).then(function (hitauthed) {
                                if (hitsetting.canold == 1 && request.query.savehash == 'on' && !hitauthed) {
                                    authed.insertOne({ id: hash(request.query.id) });
                                }
                            });
                        } catch { }
                        client.guilds.fetch(hit.guild).then(function (guildserver) {
                            guildserver.members.fetch(request.query.id).then(function (member) {
                                member.roles.add(hitsetting.role).then(function () {
                                    authing.findOneAndDelete({ id: request.query.id }).then(function () {
                                        dbclient.close();
                                    });
                                });
                            });
                        });
                    });
                } else {
                    response.send('Authentication failed. <a href="/?start=0">Try again</a>');
                }
            });
        });
    } else if (request.query.redir) {
        if (request.query.redir.startsWith('https://discord.gg')) {
            response.redirect(request.query.redir);
        } else {
            response.send('To redirect, specify an invitation link to discord that begins with https://discord.gg/.');
        }
    } else {
        return response.sendFile('index.html', { root: '.' });
    }
});
app.listen(process.env.PORT, function () {
    console.log('HTTP server is listening');
});