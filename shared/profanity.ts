/**
 * QAPINDA — Profanity filter.
 *
 * The owner's instruction was not a preference: *"söyüş qetiyyen göndermek
 * olmasın avtomatik silinsin istenilen dilde qetiyyen söyüş olmaz"*. No swear
 * word reaches another person, in any language, and the offending word is
 * removed rather than the message refused.
 *
 * WHERE THIS RUNS, AND WHERE IT DOES NOT
 * --------------------------------------
 * This module is pure text, so both sides can call it, but only one side
 * enforces it. Every callable that writes text a second person will read runs
 * `filterProfanity` on that text before it is stored — support messages and
 * subjects, complaints, review comments, a restaurant's reply to a review,
 * order notes and address notes. The browser may call `containsProfanity` to
 * warn somebody before they press send, and that is all it is: a courtesy. A
 * caller who talks to the API directly is filtered exactly the same, because
 * the filter is on the write path and not on the button.
 *
 * MASKING, NOT REFUSING
 * ---------------------
 * A customer writing three paragraphs about a cold order and losing all of it
 * to one angry word would be a worse platform, not a cleaner one. The word
 * becomes `***` and the complaint arrives. The single exception is a message
 * that is *nothing but* profanity: there is nothing left to deliver, so the
 * callable refuses it and says so.
 *
 * THE HARD PART IS NOT THE SWEARING, IT IS THE INNOCENT WORDS
 * -----------------------------------------------------------
 * Azerbaijani and Turkish are agglutinative and their short roots collide with
 * each other constantly. "Şikayət" (complaint) folds to `sikayet`; "sıxıntı"
 * and Turkish "sıkıntı" (trouble) fold to `sikinti`; "Nigar" is one of the
 * commonest women's names in the country and survives letter-collapsing into
 * the neighbourhood of an English slur. A filter that mangles those is worse
 * than no filter at all, so three things guard against it:
 *
 *   1. matching is by whole word, never by naked substring — except for a
 *      short list of roots long and distinctive enough that no ordinary word
 *      contains them;
 *   2. a root may carry an explicit suffix list, used wherever the generic
 *      "root plus up to six letters" rule would swallow an ordinary word;
 *   3. `INNOCENT` is checked first and wins. It carries the near-misses in
 *      both their correct spelling and the diacritic-less spelling a phone
 *      keyboard produces — but only where that second spelling is not itself
 *      a swear word. "Sıkıntı" and "sikinti" are both ordinary; "sıkıcı" is
 *      ordinary and "sikici" is not, so only the first of that pair is here.
 *
 * The trade is deliberate and it is always the same one: when a spelling is
 * genuinely ambiguous after normalisation, the ordinary word wins and the
 * swear gets through. Tests in `tests/profanity.test.ts` pin both halves.
 *
 * NORMALISATION, AND WHY THERE ARE TWO OF THEM
 * --------------------------------------------
 * Evasion is mechanical: `s1k`, `s.i.k`, `siiik`, `S I K`, `фuck`. Everything
 * is folded to bare Latin letters before matching — `fold` from `./search` is
 * reused rather than reimplemented, because two normalisers drift.
 *
 * Cyrillic is normalised twice, on purpose. Someone writing Russian means
 * `сука` → `suka`, which is a transliteration; someone hiding an English word
 * behind Cyrillic look-alikes means `fuсk` → `fuck`, where that `с` is a
 * lowercase Latin `c` wearing a costume. The two mappings disagree about
 * nearly every letter, so both variants are produced and a word is profane if
 * either of them matches.
 */

import { fold } from './search';

/** What replaces a word that did not pass. */
export const PROFANITY_MASK = '***';

/**
 * Cyrillic read as Russian.
 *
 * Deliberately lossy — `ш` and `щ` both become `s` — because the point is to
 * land Russian obscenity on one stable spelling, not to round-trip the text.
 */
const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's', щ: 's',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a',
};

/**
 * Cyrillic read as a disguise.
 *
 * Only the letters that are visually a Latin letter are here. A word that used
 * one of these to slip past a Latin word list reads correctly again after this
 * mapping; a word that did not simply produces a second nonsense variant that
 * matches nothing.
 */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p',
  с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j', ԛ: 'q', ԝ: 'w',
};

/** Digits and symbols standing in for letters. */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '+': 't', '€': 'e',
};

/** The letters a normalised word may still contain before `fold` runs. */
const KEEP = /[^a-zəıöüçşğ]/g;

/**
 * One word, reduced to letters.
 *
 * Combining marks go first so that `İ` — which lowercases to `i` plus a
 * combining dot — does not survive as two characters, then the Cyrillic map
 * chosen by the caller, then the leet substitutions, then everything that is
 * not a letter: spaces, dots, dashes, asterisks and any digit that was not a
 * stand-in for a letter.
 */
function normalise(word: string, cyrillic: Record<string, string>): string {
  let out = '';

  for (const character of word.toLowerCase().replace(/[̀-ͯ]/g, '')) {
    out += cyrillic[character] ?? LEET[character] ?? character;
  }

  return out.replace(KEEP, '');
}

/** Runs of one letter reduced to a single letter: `siiik` and `sik` agree. */
function collapse(value: string): string {
  return value.replace(/(.)\1+/g, '$1');
}

/**
 * The spellings one word has to be judged as.
 *
 * Two Cyrillic readings, each in its written form and in its folded form —
 * `fold` is what turns `ə`, `ı`, `ş` and the rest into bare Latin, and it is
 * the same function the menu search uses so the two can never disagree.
 */
interface WordForms {
  /** Written forms, diacritics intact. What `INNOCENT` is matched against. */
  written: string[];
  /** Folded to bare Latin, and the same again with repeats collapsed. */
  folded: string[];
}

function formsOf(word: string): WordForms {
  const written = [
    normalise(word, CYRILLIC_TRANSLITERATION),
    normalise(word, CYRILLIC_LOOKALIKES),
  ].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  const folded: string[] = [];
  for (const value of written) {
    const bare = fold(value).replace(/[^a-z]/g, '');
    if (bare && !folded.includes(bare)) folded.push(bare);
    const collapsed = collapse(bare);
    if (collapsed && !folded.includes(collapsed)) folded.push(collapsed);
  }

  return { written, folded };
}

// ---------------------------------------------------------------------------
// The word list
// ---------------------------------------------------------------------------

interface Root {
  /** The stem, written the way `formsOf` would fold it: bare Latin letters. */
  root: string;
  /**
   * Match anywhere in the word rather than only at its start.
   *
   * Reserved for roots long and odd enough that no ordinary word in any of the
   * four languages contains them — which is what makes "motherfucker" and
   * "заебал" catchable without putting every word with a common prefix at
   * risk.
   */
  anywhere?: boolean;
  /**
   * The only endings allowed after the root.
   *
   * Used where the generic rule — root plus up to six letters — would eat an
   * ordinary word. `bok` with a free suffix swallows "boks"; with this list it
   * does not.
   */
  suffixes?: readonly string[];
}

/** The generic ending: agglutinative languages stack, but not without limit. */
const GENERIC_SUFFIX = /^[a-z]{1,6}$/;

/**
 * Azerbaijani and Turkish.
 *
 * `sik`, `pic`, `got` and `bok` all carry explicit suffix lists, because each
 * of them is the opening of a perfectly ordinary word — "şikayət", "piknik",
 * English "got", "boks" — and the generic rule would take all four.
 */
const AZ_TR_ROOTS: readonly Root[] = [
  {
    root: 'sik',
    suffixes: [
      '', 'i', 'im', 'in', 'ib', 'ir', 'irem', 'irik', 'im', 'ime', 'ini',
      'eyim', 'ecem', 'esen', 'tir', 'tirin', 'tirir', 'tirsin', 'ik', 'iyim',
      'isen', 'sin', 'sinler', 'mis', 'di', 'dim', 'din', 'diyim', 'en',
      'er', 'erem', 'is', 'isi', 'ise', 'iser', 'ismek', 'ismis', 'ilmis',
      'mek', 'meye', 'meyi',
    ],
  },
  { root: 'siktir' },
  { root: 'amcik' },
  { root: 'amciq' },
  { root: 'amk', suffixes: [''] },
  { root: 'qehbe' }, { root: 'kehbe' }, { root: 'kahbe' }, { root: 'kahpe' },
  { root: 'gehbe' }, { root: 'gahba' },
  { root: 'orospu', anywhere: true }, { root: 'oruspu', anywhere: true },
  {
    root: 'pic',
    suffixes: ['', 'i', 'e', 'in', 'im', 'is', 'ler', 'lere', 'leri', 'dir'],
  },
  {
    root: 'got',
    suffixes: [
      '', 'u', 'un', 'una', 'unu', 'une', 'uve', 'uvu', 'umu', 'lek', 'leyi',
      'veren', 'verenler', 'verdi',
    ],
  },
  { root: 'yarak' }, { root: 'yaraq' }, { root: 'yarrak' }, { root: 'yarraq' },
  { root: 'dalyarak', anywhere: true },
  { root: 'gotveren', anywhere: true },
  { root: 'ibne' },
  { root: 'gavat' }, { root: 'kavat' },
  { root: 'pezevenk', anywhere: true },
  { root: 'serefsiz', anywhere: true },
  { root: 'namussuz', anywhere: true },
  { root: 'yavsak' }, { root: 'yavsaq' },
  { root: 'surtuk' },
  { root: 'bok', suffixes: ['', 'u', 'un', 'a', 'da', 'dan', 'lu', 'luq'] },
];

/**
 * Russian.
 *
 * Written as the transliteration produces them. Most are prefix roots rather
 * than free-floating: `ebat` inside a word is Turkish "ebat" and English
 * "debate", and neither of those is anybody's swearing.
 */
const RU_ROOTS: readonly Root[] = [
  { root: 'hui', anywhere: true },
  { root: 'pizd', anywhere: true },
  { root: 'blyat' }, { root: 'blyad' }, { root: 'blat', suffixes: ['', 'i'] },
  { root: 'blad', suffixes: ['', 'i', 'ii', 'yu', 'ya', 'skii', 'stvo'] },
  { root: 'ebat' }, { root: 'ebal' }, { root: 'eban' }, { root: 'ebas' },
  { root: 'ebuc' }, { root: 'ebi', suffixes: ['s', 'te', 'sya'] },
  { root: 'zaebal' }, { root: 'nahui' }, { root: 'pohui' },
  { root: 'ohuel' }, { root: 'ahuel' }, { root: 'ohuen' },
  { root: 'suka' }, { root: 'sucka' }, { root: 'cyka' },
  { root: 'mudak' }, { root: 'mudil' },
  { root: 'pidor', anywhere: true }, { root: 'pidar', anywhere: true },
  { root: 'gandon' }, { root: 'zalup' }, { root: 'droc' }, { root: 'govno' },
];

/**
 * English.
 *
 * Mostly free-floating, because English compounds by gluing: the insult is
 * very often in the middle of the word rather than at its front.
 */
const EN_ROOTS: readonly Root[] = [
  { root: 'fuck', anywhere: true },
  { root: 'shit', anywhere: true },
  { root: 'bitch', anywhere: true },
  { root: 'asshole', anywhere: true },
  { root: 'arsehole', anywhere: true },
  { root: 'cunt', anywhere: true },
  { root: 'bastard', anywhere: true },
  { root: 'whore', anywhere: true },
  { root: 'wanker', anywhere: true },
  { root: 'twat', anywhere: true },
  { root: 'nigger', anywhere: true },
  { root: 'nigga', anywhere: true },
  { root: 'faggot', anywhere: true },
  { root: 'slut' },
  { root: 'prick' },
  { root: 'pussy' },
  { root: 'dick', suffixes: ['', 's', 'head', 'heads', 'ish'] },
];

const ROOTS: readonly Root[] = [...AZ_TR_ROOTS, ...RU_ROOTS, ...EN_ROOTS];

/**
 * The words that must never be touched.
 *
 * Every entry here is a real word that one of the roots above comes within a
 * letter or two of. They are matched on the *written* form, so the diacritics
 * a person actually typed still count for something after everything else has
 * folded them away: "sıkıntı" is exempt because it is spelled as the ordinary
 * word, and "sikici" is not here at all because that spelling is the swear.
 */
const INNOCENT_WORDS: readonly string[] = [
  // Azerbaijani and Turkish near-misses on `sik`.
  'şikayət', 'sikayet', 'şikayətçi', 'sikayetci', 'şikayətlər', 'sikayetler',
  'sıkıntı', 'sikinti', 'sıkıntılı', 'sikintili', 'sıkıntısı', 'sikintisi',
  'sıxıntı', 'sıxmaq', 'sıxıcı', 'sıkı', 'sıkışıq', 'sıkışık', 'sikisik',
  'sıkmaq', 'sıkmak', 'sıkıcı', 'sikkə', 'sikke', 'siqaret', 'sifariş',
  // …on `pic`, `got` and `bok`.
  'picnic', 'piknik', 'piccolo',
  'got', 'gotta', 'gotten', 'gothic', 'gotham', 'goto',
  'boks', 'boksçu', 'bokal',
  // A name, not a slur. Collapsing repeats brings `nigga` uncomfortably close.
  'nigar', 'niggard', 'niggardly',
  // Russian near-misses.
  'blade', 'blades', 'bladder', 'bladders', 'debate', 'debates',
  'hue', 'hues', 'sukhoi', 'mudir', 'müdir',
  // English near-misses.
  'shiitake', 'shitake', 'scunthorpe', 'prickle', 'prickly', 'prickles',
  'pussycat', 'pussycats', 'dickens', 'lebanon', 'lebanese', 'analysis',
];

/**
 * Built once: the written forms only, plus each with its repeats collapsed.
 *
 * Written forms and not folded ones, and that distinction is the whole reason
 * the exemption is safe. "Got" is here and exempts the English word; "göt" is
 * a different written form and is not exempted by it, even though the two are
 * the same string once folded. Adding the folded spellings would quietly
 * pardon half the Azerbaijani list.
 */
const INNOCENT = (() => {
  const set = new Set<string>();
  for (const word of INNOCENT_WORDS) {
    for (const form of formsOf(word).written) {
      set.add(form);
      set.add(collapse(form));
    }
  }
  return set;
})();

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesRoot(forms: string[], entry: Root): boolean {
  const collapsedRoot = collapse(entry.root);

  return forms.some((form) => {
    // Both spellings of the root are tried, because a folded word that had its
    // repeats collapsed can only ever match a root collapsed the same way —
    // otherwise "niiiggggaaa" would walk straight through.
    for (const root of [entry.root, collapsedRoot]) {
      if (entry.anywhere) {
        if (form.includes(root)) return true;
        continue;
      }

      if (!form.startsWith(root)) continue;
      const rest = form.slice(root.length);
      if (entry.suffixes) {
        if (entry.suffixes.includes(rest)) return true;
      } else if (rest.length === 0 || GENERIC_SUFFIX.test(rest)) {
        return true;
      }
    }

    return false;
  });
}

/** Whether this single word, in any of its spellings, is a swear word. */
function isProfaneWord(word: string): boolean {
  const forms = formsOf(word);
  if (forms.folded.length === 0) return false;

  // The exemption is checked first and wins outright. See the header: an
  // ordinary word mangled is a worse failure than a swear word delivered. It
  // is asked of the written spelling, so a person who typed their diacritics
  // gets the benefit of having typed them.
  for (const form of forms.written) {
    if (INNOCENT.has(form) || INNOCENT.has(collapse(form))) return false;
  }

  return ROOTS.some((entry) => matchesRoot(forms.folded, entry));
}

/**
 * The letters of a word, written apart.
 *
 * `s i k t i r` and `f u c k` are one word typed with spaces in it, and no
 * amount of per-word cleverness sees them. Runs of very short words are
 * therefore glued back together and the joins tested as well. Only words of at
 * most three letters take part, and only joins of at least four letters are
 * judged, which keeps ordinary Azerbaijani — full of two-letter words — out of
 * it.
 */
const SPACED_MAX_WORD = 3;
const SPACED_MIN_LENGTH = 4;
const SPACED_MAX_RUN = 12;

export interface ProfanityResult {
  /** The message as it may be stored: offending words replaced by `***`. */
  text: string;
  /** True when anything was replaced. Worth recording beside the message. */
  filtered: boolean;
  /** True when nothing survived — there is no message left to deliver. */
  onlyProfanity: boolean;
}

/**
 * Masks every swear word in a piece of text.
 *
 * Whitespace is preserved exactly, because a support message's line breaks
 * carry an address or a list of order codes and re-flowing somebody's text
 * while moderating it would be a second, unasked-for edit.
 */
export function filterProfanity(input: string): ProfanityResult {
  const parts = input.split(/(\s+)/);

  const words: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] && !/^\s+$/.test(parts[index])) words.push(index);
  }

  const masked = new Set<number>();
  const letters = new Map<number, string>();

  for (const index of words) {
    const forms = formsOf(parts[index]);
    letters.set(index, forms.folded[0] ?? '');
    if (isProfaneWord(parts[index])) masked.add(index);
  }

  // The spaced-out spelling, hunted in runs of short words. Every contiguous
  // stretch inside a run is tried, so a swear word buried between two ordinary
  // short words is still found.
  for (let start = 0; start < words.length; start += 1) {
    if ((letters.get(words[start]) ?? '').length > SPACED_MAX_WORD) continue;

    let joined = '';
    for (let end = start; end < words.length && end - start < SPACED_MAX_RUN; end += 1) {
      const piece = letters.get(words[end]) ?? '';
      if (piece.length === 0 || piece.length > SPACED_MAX_WORD) break;

      joined += piece;
      if (end === start || joined.length < SPACED_MIN_LENGTH) continue;

      if (isProfaneWord(joined)) {
        for (let cursor = start; cursor <= end; cursor += 1) masked.add(words[cursor]);
      }
    }
  }

  if (masked.size === 0) {
    return { text: input, filtered: false, onlyProfanity: false };
  }

  // A run of masked words becomes one `***` rather than a row of them. Six
  // asterisk groups in a line is the filter shouting about how much it caught,
  // which is neither useful to the reader nor kind to the person moderated.
  const pieces: string[] = [];
  let spacing = '';
  let previousWasMask = false;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;

    if (/^\s+$/.test(part)) {
      spacing += part;
      continue;
    }

    const isMask = masked.has(index);
    if (isMask && previousWasMask) {
      spacing = '';
      continue;
    }

    pieces.push(spacing, isMask ? PROFANITY_MASK : part);
    spacing = '';
    previousWasMask = isMask;
  }

  const text = pieces.join('') + spacing;

  // "Nothing but profanity" is counted over the words that carry letters at
  // all: a message of one swear word and an exclamation mark has nothing left
  // in it either.
  const meaningful = words.filter((index) => (letters.get(index) ?? '').length > 0);
  const onlyProfanity = meaningful.length > 0 && meaningful.every((index) => masked.has(index));

  return { text, filtered: true, onlyProfanity };
}

/**
 * A yes-or-no answer, for the browser to warn with.
 *
 * Never the enforcement. The callable filters the text again on arrival, and
 * that second pass is the one that counts.
 */
export function containsProfanity(input: string): boolean {
  return filterProfanity(input).filtered;
}
