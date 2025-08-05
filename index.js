async function resetGuild(interaction, guildId) {
    try {
        // Double-check admin permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
                content: '❌ You need Administrator permissions to use this command.', 
                flags: 64 // MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: 64 }); // MessageFlags.Ephemeral

        const settings = guildSettings.get(guildId);
        
        // Clear all messages from word channel if it exists
        if (settings?.wordChannelId) {
            try {
                const wordChannel = client.channels.cache.get(settings.wordChannelId);
                if (wordChannel) {
                    console.log(`Clearing messages from word channel ${settings.wordChannelId}`);
                    // Fetch and delete messages in batches (Discord API limit)
                    let fetched;
                    do {
                        fetched = await wordChannel.messages.fetch({ limit: 100 });
                        if (fetched.size > 0) {
                            await wordChannel.bulkDelete(fetched);
                        }
                    } while (fetched.size >= 2);
                }
            } catch (error) {
                console.error('Error clearing word channel messages:', error);
            }
        }

        // Clear all messages from story channel if it exists
        if (settings?.storyChannelId) {
            try {
                const storyChannel = client.channels.cache.get(settings.storyChannelId);
                if (storyChannel) {
                    console.log(`Clearing messages from story channel ${settings.storyChannelId}`);
                    // Fetch and delete messages in batches
                    let fetched;
                    do {
                        fetched = await storyChannel.messages.fetch({ limit: 100 });
                        if (fetched.size > 0) {
                            await storyChannel.bulkDelete(fetched);
                        }
                    } while (fetched.size >= 2);
                }
            } catch (error) {
                console.error('Error clearing story channel messages:', error);
            }
        }

        // Delete all data from Supabase for this guild
        const deletePromises = [
            supabase.from('guild_channels').delete().eq('guild_id', guildId),
            supabase.from('used_words').delete().eq('guild_id', guildId),
            supabase.from('user_words').delete().eq('guild_id', guildId),
            supabase.from('stories').delete().eq('guild_id', guildId)
        ];

        await Promise.all(deletePromises);

        // Clear from local cache
        guildSettings.delete(guildId);
        if (settings?.wordChannelId) {
            lastMessageAuthor.delete(settings.wordChannelId);
        }

        console.log(`Guild ${guildId} has been completely reset`);
        
        await interaction.editReply({ 
            content: '🗑️ **Server Reset Complete!**\n\n' +
                    '✅ All word and story channels cleared\n' +
                    '✅ All messages deleted from channels\n' +
                    '✅ All user data and leaderboard reset\n' +
                    '✅ All used words forgotten\n\n' +
                    '*You can now set up new channels with `/setwordchannel` and `/setstorychannel`*'
        });

    } catch (error) {
        console.error('Error resetting guild:', error);
        // Check if interaction is still valid before replying
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
                content: '❌ Failed to reset server data. Please try again.',
                flags: 64
            });
        } else {
            await interaction.editReply({ 
                content: '❌ Failed to reset server data. Please try again.' 
            });
        }
    }
}const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// Express server for 24/7 uptime
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Discord Word Bot is running! 🤖');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Check required environment variables
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is required');
    process.exit(1);
}

if (!process.env.SUPABASE_URL) {
    console.error('❌ SUPABASE_URL environment variable is required');
    process.exit(1);
}

if (!process.env.SUPABASE_ANON_KEY) {
    console.error('❌ SUPABASE_ANON_KEY environment variable is required');
    process.exit(1);
}

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Bad words filter (expand as needed)
const badWords = ['spam', 'test123', 'badword'];

// Track last message author per channel to prevent consecutive messages
const lastMessageAuthor = new Map();

// Cache for guild settings
const guildSettings = new Map();

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
    await loadGuildSettings();
    await registerCommands();
});

async function loadGuildSettings() {
    try {
        const { data } = await supabase.from('guild_channels').select('*');
        if (data) {
            data.forEach(row => {
                const guildId = row.guild_id;
                if (!guildSettings.has(guildId)) guildSettings.set(guildId, {});
                const settings = guildSettings.get(guildId);
                
                if (row.channel_type === 'word') {
                    settings.wordChannelId = row.channel_id;
                } else if (row.channel_type === 'story') {
                    settings.storyChannelId = row.channel_id;
                    settings.storyMessageId = row.story_message_id;
                }
            });
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('setwordchannel')
            .setDescription('Set this channel for one-word messages only')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('setstorychannel')
            .setDescription('Set this channel to display the collaborative story')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Show the word count leaderboard'),
        
        new SlashCommandBuilder()
            .setName('reset')
            .setDescription('Reset all bot data for this server (deletes everything!)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('update')
            .setDescription('Refresh the story channel with all current words')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    try {
        await client.application.commands.set(commands);
        console.log('Commands registered successfully!');
    } catch (error) {
        console.error('Command registration error:', error);
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, guildId, channelId } = interaction;

        if (commandName === 'setwordchannel') {
            await setWordChannel(interaction, guildId, channelId);
        } else if (commandName === 'setstorychannel') {
            await setStoryChannel(interaction, guildId, channelId);
        } else if (commandName === 'leaderboard') {
            await showLeaderboard(interaction, guildId);
        } else if (commandName === 'reset') {
            await resetGuild(interaction, guildId);
        }
    } else if (interaction.isButton()) {
        const [action, direction, page] = interaction.customId.split('_');
        if (action === 'leaderboard') {
            await interaction.deferUpdate();
            await showLeaderboard(interaction, interaction.guildId, parseInt(page));
        }
    }
});

async function setWordChannel(interaction, guildId, channelId) {
    try {
        // Delete existing word channel entry for this guild
        await supabase.from('guild_channels')
            .delete()
            .eq('guild_id', guildId)
            .eq('channel_type', 'word');

        // Insert new word channel
        await supabase.from('guild_channels').insert({
            guild_id: guildId,
            channel_id: channelId,
            channel_type: 'word'
        });

        if (!guildSettings.has(guildId)) guildSettings.set(guildId, {});
        guildSettings.get(guildId).wordChannelId = channelId;

        console.log(`Word channel set for guild ${guildId}: ${channelId}`);
        await interaction.reply({ content: '✅ Word channel set! Users can now only send one word at a time here.', flags: 64 });
    } catch (error) {
        console.error('Error setting word channel:', error);
        await interaction.reply({ content: '❌ Failed to set word channel.', flags: 64 });
    }
}

async function setStoryChannel(interaction, guildId, channelId) {
    try {
        const embed = new EmbedBuilder()
            .setTitle('📖 Collaborative Story')
            .setDescription('*The story will appear here as words are added...*')
            .setColor(0x5865F2);

        const message = await interaction.channel.send({ embeds: [embed] });

        // Delete existing story channel entry for this guild
        await supabase.from('guild_channels')
            .delete()
            .eq('guild_id', guildId)
            .eq('channel_type', 'story');

        // Insert new story channel
        await supabase.from('guild_channels').insert({
            guild_id: guildId,
            channel_id: channelId,
            channel_type: 'story',
            story_message_id: message.id
        });

        // Ensure guild settings exist and update immediately
        if (!guildSettings.has(guildId)) guildSettings.set(guildId, {});
        const settings = guildSettings.get(guildId);
        settings.storyChannelId = channelId;
        settings.storyMessageId = message.id;

        console.log(`Story channel set for guild ${guildId}: ${channelId}, message: ${message.id}`);
        await interaction.reply({ content: '✅ Story channel set! The collaborative story will be displayed here.', flags: 64 });
    } catch (error) {
        console.error('Error setting story channel:', error);
        await interaction.reply({ content: '❌ Failed to set story channel.', flags: 64 });
    }
}

async function showLeaderboard(interaction, guildId, page = 0) {
    try {
        const itemsPerPage = 10;
        const offset = page * itemsPerPage;

        const { data: leaderboard, count } = await supabase
            .from('user_words')
            .select('user_id, word_count', { count: 'exact' })
            .eq('guild_id', guildId)
            .order('word_count', { ascending: false })
            .range(offset, offset + itemsPerPage - 1);

        if (!leaderboard?.length) {
            await interaction.reply({ content: '📊 No words have been sent yet! Start the story in your word channel.' });
            return;
        }

        const totalPages = Math.ceil(count / itemsPerPage);
        
        let description = '';
        leaderboard.forEach((user, i) => {
            const rank = offset + i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            description += `${medal} <@${user.user_id}> - **${user.word_count}** words\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle('🏆 Word Leaderboard')
            .setDescription(description)
            .setColor(0xFFD700)
            .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

        const row = new ActionRowBuilder();
        if (page > 0) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_prev_${page - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }
        if (page < totalPages - 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`leaderboard_next_${page + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        const options = { embeds: [embed] };
        if (row.components.length > 0) options.components = [row];

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(options);
        } else {
            await interaction.reply(options);
        }
    } catch (error) {
        console.error('Leaderboard error:', error);
        await interaction.reply({ content: '❌ Failed to load leaderboard.' });
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const { guildId, channelId, author, content } = message;
    const settings = guildSettings.get(guildId);
    
    if (!settings || settings.wordChannelId !== channelId) return;

    console.log(`Message in word channel from ${author.username}: "${content}"`);
    console.log(`Guild settings:`, settings);

    // If no story channel is set, delete message and don't process
    if (!settings.storyChannelId) {
        console.log(`No story channel set for guild ${guildId}, deleting message`);
        await message.delete();
        return;
    }

    // Check if user sent the last message
    const lastAuthor = lastMessageAuthor.get(channelId);
    if (lastAuthor === author.id) {
        await message.delete();
        // Send ephemeral-like warning by DMing the user
        try {
            await author.send(`❌ You can't send consecutive messages in the word channel! Wait for someone else to send a word.`);
        } catch (error) {
            // If DM fails, user has DMs disabled - silently ignore
        }
        return;
    }

    const word = content.trim().toLowerCase();

    // Check if single word
    if (content.trim().split(/\s+/).length > 1) {
        await message.delete();
        try {
            await author.send(`❌ Only one word at a time in the word channel!`);
        } catch (error) {
            // Silently ignore DM failures
        }
        return;
    }

    // Check bad words
    if (badWords.some(bad => word.includes(bad))) {
        await message.delete();
        try {
            await author.send(`❌ That word is not allowed in the word channel!`);
        } catch (error) {
            // Silently ignore DM failures
        }
        return;
    }

    // Check if word already used
    const { data: existing } = await supabase
        .from('used_words')
        .select('word')
        .eq('guild_id', guildId)
        .eq('word', word)
        .single();

    if (existing) {
        await message.delete();
        try {
            await author.send(`❌ "${word}" has already been used in the story!`);
        } catch (error) {
            // Silently ignore DM failures
        }
        return;
    }

    // Word is valid - save it and keep the original message
    try {
        // Add to used words with timestamp
        await supabase.from('used_words').insert({
            guild_id: guildId,
            word: content.trim(), // Use original casing for storage too
            user_id: author.id,
            created_at: new Date().toISOString()
        });

        // Update user count
        const { data: userWord } = await supabase
            .from('user_words')
            .select('word_count')
            .eq('guild_id', guildId)
            .eq('user_id', author.id)
            .single();

        await supabase.from('user_words').upsert({
            guild_id: guildId,
            user_id: author.id,
            word_count: (userWord?.word_count || 0) + 1
        });

        // React to the original message (don't delete and repost)
        await message.react('✅');

        // Update last message author
        lastMessageAuthor.set(channelId, author.id);

        // Update story using the original word casing
        await updateStory(guildId, settings, content.trim());

    } catch (error) {
        console.error('Error processing word:', error);
        await message.delete();
        try {
            await author.send('❌ Error processing your word. Please try again.');
        } catch (dmError) {
            // Silently ignore DM failures
        }
    }
});

async function updateStory(guildId, settings, newWord) {
    if (!settings.storyChannelId || !settings.storyMessageId) return;

    try {
        const storyChannel = client.channels.cache.get(settings.storyChannelId);
        if (!storyChannel) return;

        const storyMessage = await storyChannel.messages.fetch(settings.storyMessageId);
        if (!storyMessage) return;

        // Get ALL used words in chronological order to build the complete story
        const { data: allWords } = await supabase
            .from('used_words')
            .select('word, created_at')
            .eq('guild_id', guildId)
            .order('created_at', { ascending: true });

        if (!allWords || allWords.length === 0) {
            // Update the embed with empty story
            const embed = new EmbedBuilder()
                .setTitle('📖 Collaborative Story')
                .setDescription('*The story will appear here as words are added...*')
                .setColor(0x5865F2)
                .setFooter({ text: '0 words total' });

            await storyMessage.edit({ embeds: [embed] });
            return;
        }

        // Build the complete story from all words
        const completeStory = allWords.map(wordData => wordData.word).join(' ');

        // Update story in database
        await supabase.from('stories').upsert({
            guild_id: guildId,
            content: completeStory
        });

        // Update the embed with complete story
        const embed = new EmbedBuilder()
            .setTitle('📖 Collaborative Story')
            .setDescription(completeStory)
            .setColor(0x5865F2)
            .setFooter({ text: `${allWords.length} words total` });

        await storyMessage.edit({ embeds: [embed] });

    } catch (error) {
        console.error('Story update error:', error);
    }
}

client.login(process.env.DISCORD_TOKEN);
