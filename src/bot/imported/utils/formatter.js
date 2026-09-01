/**
 * Nebula Bot — Message Formatter
 * Provides consistent styling for all bot responses
 */

const config = require('../config');

/**
 * Creates a styled message with a header and footer
 * @param {string} title - The title of the message
 * @param {string} content - The main content
 * @param {object} options - Optional styling overrides
 */
const formatMessage = (title, content, options = {}) => {
  const headerSymbol = options.headerSymbol || '🌌';
  const borderSymbol = options.borderSymbol || '━';
  const footerText = options.footer || `ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName}`;
  
  const titleLine = `${headerSymbol} *${title.toUpperCase()}* ${headerSymbol}`;
  const border = borderSymbol.repeat(titleLine.length - 8); // Estimate border length

  return `${titleLine}\n` +
         `╭${border}╮\n` +
         `${content}\n` +
         `╰${border}╯\n\n` +
         `> ${footerText}`;
};

/**
 * Creates a compact styled message
 */
const compact = (title, content) => {
  return `*${title}:* ${content}\n\n_Powered by ${config.botName}_`;
};

/**
 * Creates a list style message
 */
const formatList = (title, items, options = {}) => {
  const symbol = options.symbol || '•';
  const listContent = items.map(item => ` ${symbol} ${item}`).join('\n');
  return formatMessage(title, listContent, options);
};

module.exports = {
  formatMessage,
  compact,
  formatList
};
