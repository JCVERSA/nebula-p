/**
 * Command Loader - Separate module to avoid circular dependencies
 * Fixed: logs conflicts instead of silently overwriting
 */

const fs = require('fs');
const path = require('path');

// Load all commands
const loadCommands = () => {
  const commands = new Map();
  const commandsPath = path.join(__dirname, '..', 'commands');

  if (!fs.existsSync(commandsPath)) {
    console.log('Commands directory not found');
    return commands;
  }

  const categories = fs.readdirSync(commandsPath).sort();
  let loaded = 0;
  let skipped = 0;

  categories.forEach(category => {
    const categoryPath = path.join(commandsPath, category);
    if (!fs.statSync(categoryPath).isDirectory()) return;

    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

    files.forEach(file => {
      try {
        const command = require(path.join(categoryPath, file));
        if (!command.name) return;

        // Warn on name conflict
        if (commands.has(command.name)) {
          console.warn(`[CommandLoader] ⚠️  Conflict: "${command.name}" already registered — skipping ${category}/${file}`);
          skipped++;
          return;
        }

        commands.set(command.name, command);
        loaded++;

        if (command.aliases) {
          command.aliases.forEach(alias => {
            if (commands.has(alias)) {
              console.warn(`[CommandLoader] ⚠️  Alias conflict: "${alias}" (from ${category}/${file}) already taken`);
            } else {
              commands.set(alias, command);
            }
          });
        }
      } catch (error) {
        console.error(`[CommandLoader] ❌ Error loading ${category}/${file}:`, error.message);
      }
    });
  });

  console.log(`[CommandLoader] ✅ Loaded ${loaded} commands (${skipped} skipped due to conflicts)`);
  return commands;
};

module.exports = { loadCommands };
