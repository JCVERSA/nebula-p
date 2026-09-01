/**
 * Truth - Get a random truth question.
 *
 * This command is intentionally self-contained. The original implementation
 * loaded @bochilteam/scraper, whose submodules create eager network promises
 * at import time (e.g. scraper-texts → textpro.json IIFE); when the network
 * is unavailable that unhandled rejection crashed the entire panel at
 * startup. A local dataset keeps the feature offline-safe and deterministic.
 */

const TRUTH_QUESTIONS = [
  'Have you ever lied to your best friend?',
  'What is the most embarrassing thing you have done in public?',
  'Have you ever stalked someone on social media?',
  'What is the most childish thing you still do?',
  'Have you ever pretended to be sick to skip work or school?',
  'Who was your first crush, and how old were you?',
  'What is the biggest lie you have ever told your parents?',
  'Have you ever cheated in a game or exam?',
  'What is the weirdest dream you have ever had?',
  'Have you ever sent a text to the wrong person?',
  'What is a secret you have never told anyone?',
  'Have you ever eaten something you found on the floor?',
  'What is your most irrational fear?',
  'Have you ever faked a laugh to be polite?',
  'What song do you secretly love but would never admit?',
  'Have you ever broken something and blamed someone else?',
  'What is the most expensive thing you have ever dropped?',
  'Have you ever peed in a pool?',
  'What is the worst haircut you have ever had?',
  'Have you ever lied about your age?',
  'What is the most awkward date you have ever been on?',
  'Have you ever snooped through a friend’s phone?',
  'What is the pettiest reason you have ended a friendship?',
  'Have you ever stolen something, even a small item?',
  'What is the worst thing you have ever said in anger?',
  'Have you ever pretended to know something you did not?',
  'What is your guilty pleasure TV show?',
  'Have you ever farted in an elevator and blamed someone?',
  'What did you last search for on the internet that you would not share?',
  'Have you ever been fired from a job or kicked out of a group?',
  'What is the most money you have ever wasted on something useless?',
  'Have you ever ghosted someone without a reason?',
  'What is the worst habit you cannot quit?',
  'Have you ever gotten a crush on a friend’s partner?',
  'What is the most embarrassing nickname you have had?',
  'Have you ever lied about your qualifications in a job interview?',
  'What is the longest you have gone without showering?',
  'Have you ever rejoiced over someone else’s failure?',
  'What is the cringiest thing you have posted online?',
  'Have you ever kept money you found on the street?'
];

module.exports = {
    name: 'truth',
    aliases: [],
    category: 'fun',
    desc: 'Get a random truth question',
    usage: 'truth',
    execute: async (sock, msg, args, extra) => {
      try {
        const question = TRUTH_QUESTIONS[Math.floor(Math.random() * TRUTH_QUESTIONS.length)];
        await extra.reply(`🎯 *TRUTH:* ${question}`);
      } catch (error) {
        console.error('Truth Error:', error);
        await extra.reply(`❌ Error: ${error.message}`);
      }
    }
  };
