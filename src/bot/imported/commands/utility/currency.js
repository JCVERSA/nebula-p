// Nebula Bot by Dark Neon
/**
 * Currency Command — Conversion de devises en temps réel
 * Utilise l'API exchangerate-api.com (open, sans clé pour les taux de base)
 * Fallback : frankfurter.app (gratuit, BCE, sans clé)
 */

const axios = require('axios');

// Cache des taux: { base: { rates: {}, fetchedAt: ts } }
const ratesCache = new Map();
const CACHE_TTL  = 10 * 60 * 1000; // 10 minutes

// Noms complets des devises les plus courantes
const CURRENCY_NAMES = {
  USD: '🇺🇸 Dollar américain',   EUR: '🇪🇺 Euro',
  GBP: '🇬🇧 Livre sterling',     JPY: '🇯🇵 Yen japonais',
  CAD: '🇨🇦 Dollar canadien',    AUD: '🇦🇺 Dollar australien',
  CHF: '🇨🇭 Franc suisse',       CNY: '🇨🇳 Yuan chinois',
  INR: '🇮🇳 Roupie indienne',    BRL: '🇧🇷 Real brésilien',
  MXN: '🇲🇽 Peso mexicain',      ZAR: '🇿🇦 Rand sud-africain',
  NGN: '🇳🇬 Naira nigérian',     GHS: '🇬🇭 Cedi ghanéen',
  KES: '🇰🇪 Shilling kényan',    TZS: '🇹🇿 Shilling tanzanien',
  MAD: '🇲🇦 Dirham marocain',    DZD: '🇩🇿 Dinar algérien',
  TND: '🇹🇳 Dinar tunisien',     CFA: '🌍 Franc CFA',
  XOF: '🌍 Franc CFA (UEMOA)',   XAF: '🌍 Franc CFA (CEMAC)',
  CDF: '🇨🇩 Franc congolais',    ETB: '🇪🇹 Birr éthiopien',
  EGP: '🇪🇬 Livre égyptienne',   SAR: '🇸🇦 Riyal saoudien',
  AED: '🇦🇪 Dirham émirati',     KWD: '🇰🇼 Dinar koweïtien',
  RUB: '🇷🇺 Rouble russe',       KRW: '🇰🇷 Won coréen',
  SGD: '🇸🇬 Dollar singapourien',HKD: '🇭🇰 Dollar hongkongais',
  NOK: '🇳🇴 Couronne norvégienne',SEK: '🇸🇪 Couronne suédoise',
  DKK: '🇩🇰 Couronne danoise',   PLN: '🇵🇱 Zloty polonais',
  TRY: '🇹🇷 Livre turque',       IDR: '🇮🇩 Roupie indonésienne',
  PHP: '🇵🇭 Peso philippin',     THB: '🇹🇭 Baht thaïlandais',
  MYR: '🇲🇾 Ringgit malaisien',  PKR: '🇵🇰 Roupie pakistanaise',
  BTC: '₿ Bitcoin',               ETH: '⟠ Ethereum',
};

async function getRates(base) {
  const cached = ratesCache.get(base);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.rates;

  // Essai 1 : exchangerate-api (open endpoint)
  try {
    const { data } = await axios.get(
      `https://open.er-api.com/v6/latest/${base}`,
      { timeout: 8000 }
    );
    if (data?.result === 'success' && data.rates) {
      ratesCache.set(base, { rates: data.rates, fetchedAt: Date.now() });
      return data.rates;
    }
  } catch {}

  // Essai 2 : frankfurter.app (BCE, fiable)
  const { data } = await axios.get(
    `https://api.frankfurter.app/latest?from=${base}`,
    { timeout: 8000 }
  );
  if (data?.rates) {
    // frankfurter ne retourne pas la devise de base elle-même
    const rates = { ...data.rates, [base]: 1 };
    ratesCache.set(base, { rates, fetchedAt: Date.now() });
    return rates;
  }

  throw new Error('Impossible de récupérer les taux de change');
}

function formatAmount(n) {
  if (n >= 1_000_000) return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  if (n >= 1)         return n.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 8 });
}

module.exports = {
  name: 'currency',
  aliases: ['conv', 'convert', 'taux', 'exchange', 'cur'],
  category: 'utility',
  description: 'Convertit une devise en une autre en temps réel',
  usage: '.currency <montant> <de> <vers>\n.currency 100 USD EUR',

  async execute(sock, msg, args, extra) {
    try {
      // ── Afficher les devises supportées ──────────────────────────────────
      if (args[0]?.toLowerCase() === 'list' || args[0]?.toLowerCase() === 'liste') {
        const list = Object.entries(CURRENCY_NAMES)
          .map(([code, name]) => `  ${code} — ${name}`)
          .join('\n');
        return extra.reply(
          `💱 *Devises supportées:*\n\n${list}\n\n` +
          `💡 Usage: *.currency 100 USD EUR*`
        );
      }

      // ── Parser les arguments ──────────────────────────────────────────────
      // Formats acceptés: .currency 100 USD EUR | .currency USD EUR | .currency 100 usd en eur
      let amount = 1, from = '', to = '';

      // Enlever les mots parasites
      const cleanArgs = args.filter(a => !['en', 'in', 'to', 'vers', 'à'].includes(a.toLowerCase()));

      if (!cleanArgs.length) {
        return extra.reply(
          `💱 *Currency Converter*\n\n` +
          `Usage: *.currency <montant> <de> <vers>*\n\n` +
          `Exemples:\n` +
          `  .currency 100 USD EUR\n` +
          `  .currency 50000 XAF EUR\n` +
          `  .currency 1 BTC USD\n` +
          `  .currency 1000 EUR USD GBP JPY  ← multi-conversion\n\n` +
          `📋 *.currency liste* — voir toutes les devises`
        );
      }

      // Détecter si le premier arg est un nombre
      const firstNum = parseFloat(cleanArgs[0]);
      if (!isNaN(firstNum)) {
        amount = firstNum;
        from   = cleanArgs[1]?.toUpperCase();
        // Tout le reste = devises cibles
        const targets = cleanArgs.slice(2).map(a => a.toUpperCase());
        to = targets[0];
      } else {
        amount = 1;
        from   = cleanArgs[0]?.toUpperCase();
        const targets = cleanArgs.slice(1).map(a => a.toUpperCase());
        to = targets[0];
      }

      if (!from) return extra.reply('❌ Précise une devise source.\nEx: *.currency 100 USD EUR*');
      if (!to)   return extra.reply('❌ Précise une devise cible.\nEx: *.currency 100 USD EUR*');

      if (amount <= 0)          return extra.reply('❌ Le montant doit être positif.');
      if (amount > 1_000_000_000) return extra.reply('❌ Montant trop élevé (max 1 milliard).');

      // Devises cibles multiples: .currency 100 EUR USD GBP JPY
      const allTargets = args
        .filter(a => !['en', 'in', 'to', 'vers', 'à'].includes(a.toLowerCase()))
        .slice(!isNaN(parseFloat(args[0])) ? 2 : 1)
        .map(a => a.toUpperCase())
        .filter(a => /^[A-Z]{3}$/.test(a));

      if (!allTargets.length) allTargets.push(to);

      await extra.reply(`💱 Récupération des taux pour *${from}*...`);

      const rates = await getRates(from);

      // Vérifier la devise source
      if (from !== 'EUR' && !rates[from] && rates[from] !== 1) {
        // Essayer comme devise base
      }

      const results = [];
      for (const target of allTargets) {
        if (!rates[target]) {
          results.push(`❌ *${target}* — devise non supportée`);
          continue;
        }
        const converted = amount * rates[target];
        const rate1     = rates[target];
        const rateInv   = 1 / rate1;
        const fromName  = CURRENCY_NAMES[from] || from;
        const toName    = CURRENCY_NAMES[target] || target;

        results.push(
          `${toName || target}\n` +
          `   *${formatAmount(amount)} ${from} = ${formatAmount(converted)} ${target}*\n` +
          `   📊 1 ${from} = ${formatAmount(rate1)} ${target}\n` +
          `   📊 1 ${target} = ${formatAmount(rateInv)} ${from}`
        );
      }

      const fromLabel = CURRENCY_NAMES[from] || from;
      const cacheAge  = Math.round((Date.now() - (ratesCache.get(from)?.fetchedAt || Date.now())) / 60000);
      const freshness = cacheAge === 0 ? 'à l\'instant' : `il y a ${cacheAge} min`;

      await extra.reply(
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 💱 *CURRENCY CONVERTER*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `💵 *${formatAmount(amount)} ${from}* — ${fromLabel}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        results.join('\n\n') + '\n\n' +
        `🕐 *Taux mis à jour:* ${freshness}\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
      );

    } catch (error) {
      console.error('[CURRENCY] Error:', error.message);
      if (error.message?.includes('récupérer')) {
        await extra.reply('❌ Service de taux de change indisponible. Réessaie dans quelques secondes.');
      } else {
        await extra.reply('❌ Erreur lors de la conversion. Vérifie les codes de devises (ex: USD, EUR, XAF).');
      }
    }
  }
};
