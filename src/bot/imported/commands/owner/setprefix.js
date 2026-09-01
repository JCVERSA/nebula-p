/**
 * Set Prefix Command - Change bot command prefix
 */

const config = require('../../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'setprefix',
  aliases: ['prefix'],
  category: 'owner',
  description: 'Change bot command prefix',
  usage: '.setprefix <prefix1,prefix2,...>',
  ownerOnly: true,
  
  async execute(sock, msg, args, extra) {
    try {
      const currentPrefix = Array.isArray(config.prefix) ? config.prefix.join(', ') : config.prefix;
      if (args.length === 0) {
        return extra.reply(`📌 Current prefixes: ${currentPrefix}\n\nUsage: .setprefix <prefix1,prefix2,...>\nExample: .setprefix .,/,!,#`);
      }
      
      // Parse new prefixes
      const newPrefixes = args.join('').split(',').map(p => p.trim()).filter(p => p.length > 0);
      
      if (newPrefixes.length === 0) {
        return extra.reply('❌ Please provide at least one valid prefix!');
      }

      for (const p of newPrefixes) {
        if (p.length > 3) {
          return extra.reply(`❌ Prefix '${p}' is too long! (Max 3 characters)`);
        }
      }
      
      // Update memory config
      config.prefix = newPrefixes;
      
      // Update config file
      const configPath = path.join(__dirname, '../../config.js');
      let configContent = fs.readFileSync(configPath, 'utf-8');
      
      const prefixStr = newPrefixes.map(p => `'${p}'`).join(', ');
      
      // Try to replace array or string
      if (configContent.includes('prefix: [')) {
        configContent = configContent.replace(/prefix: \[.*?\]/, `prefix: [${prefixStr}]`);
      } else {
        configContent = configContent.replace(/prefix: '.*?'/, `prefix: [${prefixStr}]`);
      }
      
      fs.writeFileSync(configPath, configContent);
      
      await extra.reply(`✅ Prefixes updated to: ${newPrefixes.join(', ')}\n\nYou can now use any of these to trigger commands.`);
      
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
