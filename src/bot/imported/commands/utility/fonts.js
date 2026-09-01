/**
 * Fonts Command — 100 Unicode font variants
 * Nebula Bot by Dark Neon
 */

// ── Conversion maps ────────────────────────────────────────────────────────────

const NORMAL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const FONTS = [
  // ── SERIF / MATH ──────────────────────────────────────────────────────────
  { id: 1,  name: '𝐁𝐨𝐥𝐝',               chars: '𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗' },
  { id: 2,  name: '𝐼𝑡𝑎𝑙𝑖𝑐',             chars: '𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧0123456789' },
  { id: 3,  name: '𝑩𝒐𝒍𝒅 𝑰𝒕𝒂𝒍𝒊𝒄',       chars: '𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛0123456789' },
  { id: 4,  name: '𝒞𝓊𝓇𝓈𝒾𝓋𝑒',           chars: '𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝒻𝓁𝓂𝒶𝓃𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃0123456789' },
  { id: 5,  name: '𝓑𝓸𝓵𝓭 𝓢𝓬𝓻𝓲𝓹𝓽',      chars: '𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃0123456789' },
  { id: 6,  name: '𝔉𝔯𝔞𝔨𝔱𝔲𝔯',           chars: '𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷0123456789' },
  { id: 7,  name: '𝕭𝖔𝖑𝖉 𝕱𝖗𝖆𝖐𝖙𝖚𝖗',    chars: '𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟0123456789' },
  { id: 8,  name: '𝕯𝖔𝖚𝖇𝖑𝖊-𝕾𝖙𝖗𝖚𝖐',   chars: '𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡' },
  { id: 9,  name: 'Sᴍᴀʟʟ Cᴀᴘs',         chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀsᴛᴜᴠᴡxʏᴢ0123456789' },
  { id: 10, name: 'Ｆｕｌｌｗｉｄｔｈ',      chars: 'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９' },

  // ── CIRCLED / BOXED ───────────────────────────────────────────────────────
  { id: 11, name: 'Ⓒⓘⓡⓒⓛⓔⓓ',          chars: 'ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ⓪①②③④⑤⑥⑦⑧⑨' },
  { id: 12, name: '🅱🅾🆇🅴🅳',            chars: '🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩0123456789' },
  { id: 13, name: '🆂🆀🆄🅰🆁🅴🅳',        chars: '🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉0123456789' },

  // ── SUPERSCRIPT / SUBSCRIPT ───────────────────────────────────────────────
  { id: 14, name: 'ˢᵘᵖᵉʳˢᶜʳⁱᵖᵗ',       chars: 'ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁᵛᵂˣʸᶻᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᵠʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹' },
  { id: 15, name: 'ₛᵤᵦₛ꜀ᵣᵢₚₜ',          chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZₐbcdₑfgₕᵢⱼₖₗₘₙₒₚqᵣₛₜᵤᵥwₓyz₀₁₂₃₄₅₆₇₈₉' },

  // ── FLIPPED / MIRRORED ────────────────────────────────────────────────────
  { id: 16, name: 'uʍop ǝpᴉsdn',        chars: '∀qƆpƎℲפHIſʞ˥WNOdQɹSʇnʌʍxʎZ,q,ǝɟɓɥᴉɾʞlɯuodᴉɹsʇn,ʍxʎz0123456789' },

  // ── STRIKETHROUGH / UNDERLINE ─────────────────────────────────────────────
  { id: 17, name: 'S̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶',  chars: null, transform: (t) => t.split('').map(c => c + '\u0336').join('') },
  { id: 18, name: 'U̲n̲d̲e̲r̲l̲i̲n̲e̲',         chars: null, transform: (t) => t.split('').map(c => c + '\u0332').join('') },
  { id: 19, name: 'D̳o̳u̳b̳l̳e̳ ̳U̳n̳d̳e̳r̳',    chars: null, transform: (t) => t.split('').map(c => c + '\u0333').join('') },
  { id: 20, name: 'Ȯ̈v̈ȅr̈l̈ä̈ÿ',           chars: null, transform: (t) => t.split('').map(c => c + '\u0308').join('') },

  // ── BUBBLE / NEGATIVE BUBBLE ──────────────────────────────────────────────
  { id: 21, name: '🅱🅾🅻🅳 🅱🆄🅱🅱🅻🅴',    chars: '🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩0123456789' },

  // ── UNICODE ALPHABET VARIANTS ─────────────────────────────────────────────
  { id: 22, name: 'Ａｅｓｔｈｅｔｉｃ',       chars: 'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９' },
  { id: 23, name: 'Ꭿꮭꮲꮒꭿ',              chars: 'ᎪᏴᏟᎠᎬᎦᎤᎻᏆᎫᎬᏟᎷᏁᎾᏢᎤᏒᏚᏆᏬᏉᏇᏛᏯᎽꭺꮟꮯꮷꮛꮁꮐꮒꮄꮰꮶꮮꮇꮑꮻꮘꮫꮹꮃꮅꮙꮓꮕꮦ0123456789' },
  { id: 24, name: 'Ｃｙｂｅｒ Ｇｌｉｔｃｈ',    chars: null, transform: (t) => t.split('').map((c,i) => i%3===0 ? c+'\u0300' : i%3===1 ? c+'\u0307' : c+'\u0323').join('') },
  { id: 25, name: 'Z̤͈̞a̞̩͕l̡͍͍͕g̶̝͖̠o̯͖',       chars: null, transform: (t) => {
    const above = ['\u030d','\u030e','\u0304','\u0305','\u033f','\u0311','\u0306','\u0310','\u0352','\u0357'];
    const below = ['\u0323','\u0324','\u0325','\u0326','\u0327','\u0328','\u0329','\u032a','\u032b','\u032c'];
    return t.split('').map(c => { if(c===' ')return c; let r=c; r+=above[Math.floor(Math.random()*above.length)]; r+=above[Math.floor(Math.random()*above.length)]; r+=below[Math.floor(Math.random()*below.length)]; return r; }).join('');
  }},

  // ── RUNIC / ANCIENT ───────────────────────────────────────────────────────
  { id: 26, name: 'ᚱᚢᚾᛁᚲ',              chars: 'ᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈᛩᚱᛊᛏᚢᚡᚹᛪᛇᛉᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈᛩᚱᛊᛏᚢᚡᚹᛪᛇᛉ0123456789' },
  { id: 27, name: 'Ꝏꞃ𝕔𝕒ꞅ',             chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' },

  // ── SPECIAL STYLE ─────────────────────────────────────────────────────────
  { id: 28, name: '꧁༺ Ｄｅｃｏ ༻꧂',       chars: null, transform: (t) => `꧁༺ ${t} ༻꧂` },
  { id: 29, name: '『 Ａｎｉｍｅ 』',       chars: null, transform: (t) => `『 ${t} 』` },
  { id: 30, name: '⟨ Ａｎｇｌｅ ⟩',       chars: null, transform: (t) => `⟨ ${t} ⟩` },
  { id: 31, name: '【 Ｌｏｏｐ 】',        chars: null, transform: (t) => `【 ${t} 】` },
  { id: 32, name: '⌜ Ｃｏｒｎｅｒ ⌟',     chars: null, transform: (t) => `⌜ ${t} ⌟` },
  { id: 33, name: '❝ Ｑｕｏｔｅ ❞',       chars: null, transform: (t) => `❝ ${t} ❞` },
  { id: 34, name: '✦ Ｓｔａｒ ✦',         chars: null, transform: (t) => t.split('').join(' ✦ ') },
  { id: 35, name: '• Ｄｏｔ •',            chars: null, transform: (t) => t.split('').join(' • ') },
  { id: 36, name: '꙰ Ｒｉｎｇ ꙰',         chars: null, transform: (t) => t.split('').join('꙰') },
  { id: 37, name: '░ Ｓｈａｄｏｗ ░',      chars: null, transform: (t) => `░▒▓ ${t} ▓▒░` },
  { id: 38, name: '▓█ Ｂｌｏｃｋ █▓',     chars: null, transform: (t) => `▓█ ${t} █▓` },
  { id: 39, name: '≋ Ｗａｖｅ ≋',         chars: null, transform: (t) => `≋ ${t} ≋` },
  { id: 40, name: '꩜ Ｓｐｉｒａｌ ꩜',     chars: null, transform: (t) => `꩜ ${t} ꩜` },

  // ── SPACED STYLES ─────────────────────────────────────────────────────────
  { id: 41, name: 'S p a c e d',         chars: null, transform: (t) => t.split('').join(' ') },
  { id: 42, name: 'S  p  a  c  e  d  +', chars: null, transform: (t) => t.split('').join('  ') },
  { id: 43, name: 'S-p-a-c-e-d-/-/',     chars: null, transform: (t) => t.split('').join('-') },
  { id: 44, name: 'S·p·a·c·e·d·•',       chars: null, transform: (t) => t.split('').join('·') },
  { id: 45, name: 'S｜p｜a｜c｜e｜d',    chars: null, transform: (t) => t.split('').join('｜') },
  { id: 46, name: 'S~p~a~c~e~d~~',       chars: null, transform: (t) => t.split('').join('~') },

  // ── EMOJI DECORATED ───────────────────────────────────────────────────────
  { id: 47, name: '🔥 Ｆｉｒｅ 🔥',       chars: null, transform: (t) => `🔥 ${t} 🔥` },
  { id: 48, name: '💀 Ｓｋｕｌｌ 💀',     chars: null, transform: (t) => `💀 ${t} 💀` },
  { id: 49, name: '⚡ Ｌｉｇｈｔ ⚡',     chars: null, transform: (t) => `⚡ ${t} ⚡` },
  { id: 50, name: '🌌 Ｇａｌａｘｙ 🌌',  chars: null, transform: (t) => `🌌 ${t} 🌌` },
  { id: 51, name: '💎 Ｄｉａ 💎',         chars: null, transform: (t) => `💎 ${t} 💎` },
  { id: 52, name: '🌸 Ｓａｋｕｒａ 🌸',  chars: null, transform: (t) => `🌸 ${t} 🌸` },
  { id: 53, name: '👑 Ｒｏｙａｌ 👑',    chars: null, transform: (t) => `👑 ${t} 👑` },
  { id: 54, name: '🐉 Ｄｒａｇｏｎ 🐉',  chars: null, transform: (t) => `🐉 ${t} 🐉` },
  { id: 55, name: '✨ Ｇｌｏｗ ✨',       chars: null, transform: (t) => `✨ ${t} ✨` },
  { id: 56, name: '🎭 Ｍａｓｋ 🎭',      chars: null, transform: (t) => `🎭 ${t} 🎭` },
  { id: 57, name: '🌊 Ｏｃｅａｎ 🌊',    chars: null, transform: (t) => `🌊 ${t} 🌊` },
  { id: 58, name: '❄️ Ｉｃｅ ❄️',        chars: null, transform: (t) => `❄️ ${t} ❄️` },
  { id: 59, name: '🎯 Ｔａｒｇｅｔ 🎯',  chars: null, transform: (t) => `🎯 ${t} 🎯` },
  { id: 60, name: '🔮 Ｍｙｓｔｉｃ 🔮',  chars: null, transform: (t) => `🔮 ${t} 🔮` },

  // ── MIXED UNICODE COOL ────────────────────────────────────────────────────
  { id: 61, name: 'ᴘʜᴏɴᴇᴛɪᴄ',           chars: 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ0123456789' },
  { id: 62, name: 'Ꭿncient',             chars: 'ꭺ꭮ꭸꭰꭼꮂꮆꮒꮄꮰꮲꮮꮇꮑꮽꮘꮫꮢꮥꮦꮜꮙꮃꮅꮄꮽꭺ꭮ꭸꭰꭼꮂꮆꮒꮄꮰꮲꮮꮇꮑꮻꮘꮫꮢꮥꮦꮜꮙꮃꮅꮄꮻ0123456789' },
  { id: 63, name: 'Ｃｙｒｉｌｌｉｃ',     chars: 'АВСДЕФГНІЈКЛМНОРQРСТУВWХYZавсдефгніјклмнорqрстуввwxyз0123456789' },
  { id: 64, name: 'Ｇｒｅｅｋ',          chars: 'αвcδεƒgнιjκʟмηoρqяsτυvωxψζαвcδεƒgнιjκʟмηoρqяsτυvωxψζ0123456789' },
  { id: 65, name: '卂丨ᗪ丂',             chars: '卂乃匚ᗪ乇千ᘜ卄丨ﾌҜㄥ爪几ㄖ卩Ҩ尺丂丅凵ᐯ山乂ㄚ乙卂乃匚ᗪ乇千ᘜ卄丨ﾌҜㄥ爪几ㄖ卩Ҩ尺丂丅凵ᐯ山乂ㄚ乙0123456789' },
  { id: 66, name: 'ꀤꀤꀤ Ꮆꋬꂑꋊꂑ',       chars: 'ꋬꃳꀍꂠꏂꊰꁄꑛꀤꋊꀗꂡꀫꂂꂎꁝꋒꌅꇙꋖꐇꏝꅐꇓꁹꁴꋬꃳꀍꂠꏂꊰꁄꑛꀤꋊꀗꂡꀫꂂꂎꁝꋒꌅꇙꋖꐇꏝꅐꇓꁹꁴ0123456789' },
  { id: 67, name: '𝕳𝖆𝖝𝖔𝖗',             chars: '𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟0123456789' },
  { id: 68, name: '乃ㄖ几乇丂',           chars: '卂乃匚ᗪ乇千ᘜ卄丨ﾌҜㄥ爪几ㄖ卩Ҩ尺丂丅凵ᐯ山乂ㄚ乙卂乃匚ᗪ乇千ᘜ卄丨ﾌҜㄥ爪几ㄖ卩Ҩ尺丂丅凵ᐯ山乂ㄚ乙0123456789' },
  { id: 69, name: '₱ⱧØ₦ɆⱠɆ₮Ɨ₵',       chars: '₳฿₵ĐɆ₣₲ⱧłJ₭Ⱡ₥₦Ø₱QɌ₴₮ɄV₩ӾɎⱫ₳฿₵ĐɆ₣₲ⱧłJ₭Ⱡ₥₦Ø₱QɌ₴₮ɄV₩ӾɎⱫ0123456789' },
  { id: 70, name: 'ꜱᴛʏʟɪꜱʜ Ⅱ',         chars: 'ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁᵛᵂˣʸᶻᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᑫʳˢᵗᵘᵛʷˣʸᶻ0123456789' },

  // ── BRACKET / FRAMED ──────────────────────────────────────────────────────
  { id: 71, name: '｢ Ｊａｐａｎ ｣',     chars: null, transform: (t) => `｢ ${t} ｣` },
  { id: 72, name: '⌈ Ｃｅｉｌｉｎｇ ⌉', chars: null, transform: (t) => `⌈ ${t} ⌉` },
  { id: 73, name: '⌊ Ｆｌｏｏｒ ⌋',    chars: null, transform: (t) => `⌊ ${t} ⌋` },
  { id: 74, name: '❮ Ｐｏｉｎｔ ❯',    chars: null, transform: (t) => `❮ ${t} ❯` },
  { id: 75, name: '⟦ Ｄｂｌ Ｂｒｋ ⟧', chars: null, transform: (t) => `⟦ ${t} ⟧` },
  { id: 76, name: '❪ Ｏｒｎ ❫',        chars: null, transform: (t) => `❪ ${t} ❫` },
  { id: 77, name: '⦃ Ｃｕｒｌｙ ⦄',   chars: null, transform: (t) => `⦃ ${t} ⦄` },
  { id: 78, name: '〖 Ｃｈｉｎ ｂｒｋ 〗',chars: null, transform: (t) => `〖 ${t} 〗` },
  { id: 79, name: '《 Ｄｂｌ Ａｎｇ 》', chars: null, transform: (t) => `《 ${t} 》` },
  { id: 80, name: '〔 Ｔｏｒｔ ｂｒｋ 〕',chars: null, transform: (t) => `〔 ${t} 〕` },

  // ── COMBO STYLES ──────────────────────────────────────────────────────────
  { id: 81, name: '꧁𝓓𝓪𝓻𝓴꧂',           chars: null, transform: (t) => `꧁${t}꧂` },
  { id: 82, name: '•͙●Ｄｅｃｏ●͙•',      chars: null, transform: (t) => `•͙●${t}●͙•` },
  { id: 83, name: '✿ Ｆｌｏｗｅｒ ✿',   chars: null, transform: (t) => `✿ ${t} ✿` },
  { id: 84, name: '⊱ Ｅｌｅｇａｎｔ ⊰',chars: null, transform: (t) => `⊱ ${t} ⊰` },
  { id: 85, name: '⫷ Ｔｒｉ ⫸',        chars: null, transform: (t) => `⫷ ${t} ⫸` },
  { id: 86, name: '꙰𓂀 Ｅｙｅ 𓂀꙰',     chars: null, transform: (t) => `𓂀 ${t} 𓂀` },
  { id: 87, name: '𓃒 Ｅｇｙｐｔ 𓃒',   chars: null, transform: (t) => `𓃒 ${t} 𓃒` },
  { id: 88, name: '⋆｡°✩ Ｓｔａｒｓ ✩°｡⋆',chars: null, transform: (t) => `⋆｡°✩ ${t} ✩°｡⋆` },
  { id: 89, name: '·͜·♡ Ｌｏｖｅ ♡·͜·', chars: null, transform: (t) => `·͜·♡ ${t} ♡·͜·` },
  { id: 90, name: '⚜ Ｆｌｅｕｒ ⚜',    chars: null, transform: (t) => `⚜ ${t} ⚜` },

  // ── WAVE / REVERSE / CHAOS ────────────────────────────────────────────────
  { id: 91, name: 'AlTeRnAtInG CaPs',    chars: null, transform: (t) => t.split('').map((c,i) => i%2===0 ? c.toUpperCase() : c.toLowerCase()).join('') },
  { id: 92, name: 'rEVERSE cAPS',        chars: null, transform: (t) => t.split('').map((c,i) => i%2===0 ? c.toLowerCase() : c.toUpperCase()).join('') },
  { id: 93, name: 'Ｒｅｖｅｒｓｅ',      chars: null, transform: (t) => t.split('').reverse().join('') },
  { id: 94, name: 'Ｂ Ａ Ｃ Ｋ Ｗ Ａ Ｒ Ｄ', chars: null, transform: (t) => t.split('').reverse().join(' ') },
  { id: 95, name: 'M̴i̸x̷e̷d̶ ̴G̸l̵i̸t̵c̶h̷',chars: null, transform: (t) => t.split('').map((c,i) => { const g=['\u0338','\u0335','\u0336','\u0337']; return i%2===0 ? c+g[i%4] : c; }).join('') },
  { id: 96, name: '╔═ Ｂｏｘ ═╗',       chars: null, transform: (t) => `╔${'═'.repeat(t.length+2)}╗\n║ ${t} ║\n╚${'═'.repeat(t.length+2)}╝` },
  { id: 97, name: '┌─ Ｌｉｇｈｔ ─┐',  chars: null, transform: (t) => `┌${'─'.repeat(t.length+2)}┐\n│ ${t} │\n└${'─'.repeat(t.length+2)}┘` },
  { id: 98, name: 'ＵＰＰＥＲＣＡＳＥ', chars: null, transform: (t) => t.toUpperCase() },
  { id: 99, name: 'lowercase',           chars: null, transform: (t) => t.toLowerCase() },
  { id: 100,name: '𝗦𝗮𝗻𝘀-𝗦𝗲𝗿𝗶𝗳 𝗕𝗼𝗹𝗱',  chars: '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵' },
];

// ── Core converter ─────────────────────────────────────────────────────────────
function convertFont(text, font) {
  if (font.transform) return font.transform(text);
  if (!font.chars) return text;
  const src = NORMAL;
  const dst = font.chars;
  return text.split('').map(c => {
    const i = src.indexOf(c);
    return i !== -1 && dst[i] ? dst[i] : c;
  }).join('');
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'fonts',
  aliases: ['font', 'police', 'fp', 'style', 'textstyle'],
  category: 'utility',
  description: 'Convert text to 100 Unicode font styles',
  usage: '.fonts <text> | .fonts <id> <text>',

  async execute(sock, msg, args, extra) {
    try {
      const p = require('../../config').prefix || '.';

      if (!args.length) {
        return extra.reply(
          `🔡 *FONTS — 100 STYLES*\n\n` +
          `*Usage:*\n` +
          `  ◈ \`${p}fonts <text>\` — show all 100 variants\n` +
          `  ◈ \`${p}fonts <id> <text>\` — get 1 specific style\n\n` +
          `*Example:*\n` +
          `  ◈ \`${p}fonts Nebula Bot\`\n` +
          `  ◈ \`${p}fonts 5 Dark Neon\`\n\n` +
          `_IDs go from 1 to 100_`
        );
      }

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      // Check if first arg is a font ID
      const maybeId = parseInt(args[0]);
      if (!isNaN(maybeId) && maybeId >= 1 && maybeId <= 100) {
        const text = args.slice(1).join(' ');
        if (!text) return extra.reply('❌ Please provide text after the ID!');
        const font   = FONTS[maybeId - 1];
        const result = convertFont(text, font);
        return await sock.sendMessage(extra.from, {
          text:
            `🔡 *Font #${font.id} — ${font.name}*\n\n` +
            `${result}\n\n` +
            `> _${p}fonts <id> <text> for a specific style_`
        }, { quoted: msg });
      }

      // Show all 100 variants split across multiple messages
      const text = args.join(' ');
      if (text.length > 40) return extra.reply('❌ Text too long! Max 40 characters.');

      // Split into chunks of 20 fonts per message
      const CHUNK = 20;
      const chunks = [];
      for (let i = 0; i < FONTS.length; i += CHUNK) {
        chunks.push(FONTS.slice(i, i + CHUNK));
      }

      await sock.sendMessage(extra.from, {
        text:
          `🔡 *FONTS — 100 STYLES*\n` +
          `┄`.repeat(22) + `\n` +
          `📝 Text: *${text}*\n` +
          `┄`.repeat(22) + `\n` +
          `_Use \`${p}fonts <id> <text>\` to get just one style_`
      }, { quoted: msg });

      for (const chunk of chunks) {
        await delay(400);
        const lines = chunk.map(font => {
          const result = convertFont(text, font);
          return `*${font.id}.* ${font.name}\n${result}`;
        }).join('\n\n');
        await sock.sendMessage(extra.from, { text: lines });
      }

    } catch (e) { await extra.reply(`❌ Error: ${e.message}`); }
  }
};
