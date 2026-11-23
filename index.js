const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const express = require('express');

// --- Renderスリープ防止・ポートバインド用Webサーバー ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// --- Discord Bot 設定 ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ボタンのコンポーネント配列を再構築するヘルパー関数
function buildActionRows(buttonsData) {
  const rows = [];
  for (let i = 0; i < buttonsData.length; i += 5) {
    const row = new ActionRowBuilder();
    const chunk = buttonsData.slice(i, i + 5);
    for (const btn of chunk) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`role_${btn.roleId}`)
          .setLabel(btn.label)
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }
  return rows;
}

// 起動時にスラッシュコマンドを自動登録する関数
async function registerCommands() {
  const commandBuilder = new SlashCommandBuilder()
    .setName('role_panel')
    .setDescription('ロール付与パネルを作成します（最大10個のロールを同時設定可能）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option =>
      option.setName('title').setDescription('パネルのタイトル').setRequired(true));

  // 1. 必須であるロール1〜10を先にすべて追加
  for (let i = 1; i <= 10; i++) {
    commandBuilder.addRoleOption(option =>
      option.setName(`role${i}`).setDescription(`${i}つ目のロール${i === 1 ? '（必須）' : '（任意）'}`).setRequired(i === 1));
  }

  // 2. 任意のオプション（ラベル1〜10、カラー、説明文）を後ろに配置
  for (let i = 1; i <= 10; i++) {
    commandBuilder.addStringOption(option =>
      option.setName(`label${i}`).setDescription(`${i}つ目のボタンの表示名（省略時はロール名）`).setRequired(false));
  }

  commandBuilder.addStringOption(option =>
    option.setName('color')
      .setDescription('パネルの色（プリセットまたはカラーコード #5865F2 等）')
      .setRequired(false)
      .addChoices(
        { name: 'ブルー (Blue)', value: '#5865F2' },
        { name: 'グリーン (Green)', value: '#57F287' },
        { name: 'イエロー (Yellow)', value: '#FEE75C' },
        { name: 'レッド (Red)', value: '#ED4245' },
        { name: 'パープル (Purple)', value: '#9B59B6' }
      ))
    .addStringOption(option =>
      option.setName('description').setDescription('パネルの説明文').setRequired(false));

  const editCommand = new SlashCommandBuilder()
    .setName('role_edit')
    .setDescription('既存のロールパネルにロールを追加・削除します（最大20個まで）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option =>
      option.setName('message_id').setDescription('編集するパネルのメッセージID').setRequired(true))
    .addStringOption(option =>
      option.setName('action')
        .setDescription('操作を選択')
        .setRequired(true)
        .addChoices(
          { name: '追加 (add)', value: 'add' },
          { name: '削除 (remove)', value: 'remove' }
        ))
    .addRoleOption(option =>
      option.setName('role').setDescription('対象のロール').setRequired(true))
    .addStringOption(option =>
      option.setName('label').setDescription('ボタンの表示名（追加時のみ有効）').setRequired(false));

  const commands = [commandBuilder.toJSON(), editCommand.toJSON()];
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('スラッシュコマンドの登録を開始します...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('スラッシュコマンドの登録が完了しました！');
  } catch (error) {
    console.error(error);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'role_panel') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description') || '下のボタンを押してロールを取得・解除できます。';
      const colorInput = interaction.options.getString('color') || '#5865F2';

      const buttonsData = [];

      for (let i = 1; i <= 10; i++) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) {
          const label = interaction.options.getString(`label${i}`) || role.name;
          buttonsData.push({ roleId: role.id, label });
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(colorInput);

      const rows = buildActionRows(buttonsData);

      await interaction.reply({ content: 'パネルを作成しました。', ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: rows });
    }

    if (commandName === 'role_edit') {
      const messageId = interaction.options.getString('message_id');
      const action = interaction.options.getString('action');
      const role = interaction.options.getRole('role');
      const label = interaction.options.getString('label') || role.name;

      try {
        const targetMessage = await interaction.channel.messages.fetch(messageId);
        if (targetMessage.author.id !== client.user.id) {
          return interaction.reply({ content: 'このBotが作成したパネルではありません。', ephemeral: true });
        }

        let currentButtons = [];
        for (const row of targetMessage.components) {
          for (const comp of row.components) {
            if (comp.customId && comp.customId.startsWith('role_')) {
              currentButtons.push({
                roleId: comp.customId.replace('role_', ''),
                label: comp.label
              });
            }
          }
        }

        if (action === 'add') {
          if (currentButtons.some(b => b.roleId === role.id)) {
            return interaction.reply({ content: 'そのロールは既にパネルに追加されています。', ephemeral: true });
          }
          if (currentButtons.length >= 20) {
            return interaction.reply({ content: '1つのパネルに設定できるロールは最大20個までです。', ephemeral: true });
          }
          currentButtons.push({ roleId: role.id, label });
        } else if (action === 'remove') {
          const initialLength = currentButtons.length;
          currentButtons = currentButtons.filter(b => b.roleId !== role.id);
          if (currentButtons.length === initialLength) {
            return interaction.reply({ content: '指定されたロールはパネル内に見つかりませんでした。', ephemeral: true });
          }
          if (currentButtons.length === 0) {
            return interaction.reply({ content: 'ボタンを0個にすることはできません。パネル自体を削除してください。', ephemeral: true });
          }
        }

        const newRows = buildActionRows(currentButtons);
        await targetMessage.edit({ components: newRows });
        await interaction.reply({ content: 'パネルを更新しました！', ephemeral: true });

      } catch (err) {
        console.error(err);
        await interaction.reply({ content: 'メッセージが見つかりませんでした。パネルと同じチャンネルで実行し、正しいメッセージIDを指定してください。', ephemeral: true });
      }
    }
  }

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('role_')) return;

    const roleId = interaction.customId.replace('role_', '');
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
      return interaction.reply({ content: 'このロールは既に削除されています。', ephemeral: true });
    }

    const member = interaction.member;
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
        await interaction.reply({ content: `**${role.name}** を解除しました。`, ephemeral: true });
      } else {
        await member.roles.add(role);
        await interaction.reply({ content: `**${role.name}** を付与しました！`, ephemeral: true });
      }
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'ロールの操作に失敗しました。Botのロールが対象ロールより上位にあるか確認してください。',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
