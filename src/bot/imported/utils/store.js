/**
 * Shared Message Store — Nebula Bot by Dark Neon
 * Module centralisé pour éviter que handler.js ne dépende de index.js
 * Utilisé par : index.js (bind), handler.js (handleAntiDelete)
 */

'use strict';

const store = {
  messages: new Map(),
  maxPerChat: 20,

  /**
   * Bind les events Baileys pour remplir le store automatiquement
   * @param {EventEmitter} ev — sock.ev
   */
  bind(ev) {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;
        const jid = msg.key.remoteJid;
        if (!store.messages.has(jid)) store.messages.set(jid, new Map());

        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);

        // FIFO — garder seulement maxPerChat messages par chat
        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },

  /**
   * Charger un message par JID + ID
   */
  async loadMessage(jid, id) {
    return store.messages.get(jid)?.get(id) || null;
  }
};

module.exports = store;
