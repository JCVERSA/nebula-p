/**
 * Input Validation Framework for Nebula Bot
 * Provides centralized validation for commands with clear error messages
 *
 * Usage:
 *   const { validators, ValidationError } = require('../../utils/validation');
 *   validators.positiveInt(args[0], 1, 1000000);  // Throws if invalid
 *   validators.currency(args[0], 100, 10000000);  // Special case for money
 *   validators.jid(args[0]);  // Validate WhatsApp JID
 */

'use strict';

/**
 * Custom error for validation failures
 * Caught by command handlers to send user-friendly messages
 */
class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/**
 * Validation functions collection
 * Each throws ValidationError on failure, returns validated value on success
 */
const validators = {
  /**
   * Validate positive integer within range
   * @param {*} value - Value to validate
   * @param {number} min - Minimum value (default: 0)
   * @param {number} max - Maximum value (default: Number.MAX_SAFE_INTEGER)
   * @returns {number} Validated integer
   * @throws {ValidationError} If invalid
   */
  positiveInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === undefined || value === '') {
      throw new ValidationError('This argument is required');
    }

    const num = parseInt(String(value).trim(), 10);

    if (isNaN(num)) {
      throw new ValidationError(`Expected a number, got: ${value}`);
    }

    if (num < min) {
      throw new ValidationError(`Value must be at least ${min}, got: ${num}`);
    }

    if (num > max) {
      throw new ValidationError(`Value cannot exceed ${max}, got: ${num}`);
    }

    return num;
  },

  /**
   * Validate currency amount (special case of positiveInt)
   * @param {*} value - Amount in currency
   * @param {number} min - Minimum amount (default: 0)
   * @param {number} max - Maximum amount (default: 999,999,999)
   * @returns {number} Validated amount
   * @throws {ValidationError} If invalid
   */
  currency(value, min = 0, max = 999999999) {
    const amount = validators.positiveInt(value, min, max);
    return amount;
  },

  /**
   * Validate percentage (0-100)
   * @param {*} value - Percentage value
   * @returns {number} Validated percentage
   * @throws {ValidationError} If invalid
   */
  percentage(value) {
    return validators.positiveInt(value, 0, 100);
  },

  /**
   * Validate WhatsApp JID format
   * Accepts: user@s.whatsapp.net or groupid@g.us
   * @param {string} jid - WhatsApp JID to validate
   * @returns {string} Validated JID
   * @throws {ValidationError} If invalid
   */
  jid(jid) {
    if (!jid || typeof jid !== 'string') {
      throw new ValidationError('Invalid JID format');
    }

    const trimmed = jid.trim();

    if (!trimmed.includes('@')) {
      throw new ValidationError(`Invalid JID format: ${jid}`);
    }

    const [localPart, domain] = trimmed.split('@');
    if (!localPart || !domain) {
      throw new ValidationError(`Invalid JID format: ${jid}`);
    }

    // Accept both s.whatsapp.net (user) and g.us (group)
    if (!['s.whatsapp.net', 'g.us'].includes(domain)) {
      throw new ValidationError(`Invalid JID domain: ${domain}`);
    }

    return trimmed;
  },

  /**
   * Validate group JID specifically
   * @param {string} jid - WhatsApp group JID
   * @returns {string} Validated group JID
   * @throws {ValidationError} If not a group
   */
  groupJid(jid) {
    const validated = validators.jid(jid);

    if (!validated.endsWith('@g.us')) {
      throw new ValidationError(`Expected a group, got: ${jid}`);
    }

    return validated;
  },

  /**
   * Validate user JID specifically
   * @param {string} jid - WhatsApp user JID
   * @returns {string} Validated user JID
   * @throws {ValidationError} If not a user
   */
  userJid(jid) {
    const validated = validators.jid(jid);

    if (!validated.endsWith('@s.whatsapp.net')) {
      throw new ValidationError(`Expected a user JID, got: ${jid}`);
    }

    return validated;
  },

  /**
   * Validate string within length constraints
   * @param {*} value - String to validate
   * @param {number} minLength - Minimum length (default: 1)
   * @param {number} maxLength - Maximum length (default: 1000)
   * @returns {string} Validated string
   * @throws {ValidationError} If invalid
   */
  string(value, minLength = 1, maxLength = 1000) {
    if (value === null || value === undefined) {
      throw new ValidationError('This argument is required');
    }

    const str = String(value).trim();

    if (str.length < minLength) {
      throw new ValidationError(
        `Text must be at least ${minLength} character${minLength === 1 ? '' : 's'}`
      );
    }

    if (str.length > maxLength) {
      throw new ValidationError(
        `Text cannot exceed ${maxLength} character${maxLength === 1 ? '' : 's'}`
      );
    }

    return str;
  },

  /**
   * Validate that minimum number of arguments provided
   * @param {string[]} args - Command arguments
   * @param {number} count - Minimum required arguments
   * @returns {string[]} Validated arguments
   * @throws {ValidationError} If not enough args
   */
  required(args, count) {
    if (!Array.isArray(args) || args.length < count) {
      throw new ValidationError(
        `This command requires at least ${count} argument${count === 1 ? '' : 's'}`
      );
    }

    return args;
  },

  /**
   * Validate choice from allowed list
   * @param {string} value - Value to check
   * @param {string[]} choices - Allowed values
   * @param {string} fieldName - Name of field for error message
   * @returns {string} Validated choice
   * @throws {ValidationError} If not in choices
   */
  choice(value, choices, fieldName = 'value') {
    if (!choices.includes(value)) {
      throw new ValidationError(
        `Invalid ${fieldName}. Must be one of: ${choices.join(', ')}`
      );
    }

    return value;
  }
};

/**
 * Validate multiple arguments against schema
 *
 * Usage:
 *   const schema = {
 *     targetJid: { type: 'jid' },
 *     amount: { type: 'currency', min: 100, max: 10000000 },
 *     message: { type: 'string', minLength: 1, maxLength: 500 }
 *   };
 *   validateSchema(args, schema);
 */
function validateSchema(args, schema) {
  const validated = {};
  let argIndex = 0;

  for (const [fieldName, fieldSpec] of Object.entries(schema)) {
    if (argIndex >= args.length) {
      throw new ValidationError(`Missing argument: ${fieldName}`);
    }

    const value = args[argIndex];
    const { type, min, max, minLength, maxLength, choices } = fieldSpec;

    try {
      switch (type) {
        case 'int':
        case 'positiveInt':
          validated[fieldName] = validators.positiveInt(value, min, max);
          break;
        case 'currency':
          validated[fieldName] = validators.currency(value, min, max);
          break;
        case 'percentage':
          validated[fieldName] = validators.percentage(value);
          break;
        case 'jid':
          validated[fieldName] = validators.jid(value);
          break;
        case 'groupJid':
          validated[fieldName] = validators.groupJid(value);
          break;
        case 'userJid':
          validated[fieldName] = validators.userJid(value);
          break;
        case 'string':
          validated[fieldName] = validators.string(value, minLength, maxLength);
          break;
        case 'choice':
          validated[fieldName] = validators.choice(value, choices, fieldName);
          break;
        default:
          throw new ValidationError(`Unknown validator type: ${type}`);
      }
    } catch (error) {
      throw new ValidationError(`${fieldName}: ${error.message}`);
    }

    argIndex++;
  }

  return validated;
}

module.exports = {
  ValidationError,
  validators,
  validateSchema
};
