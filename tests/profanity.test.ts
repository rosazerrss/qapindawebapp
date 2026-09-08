import { describe, expect, it } from 'vitest';

import {
  PROFANITY_MASK,
  containsProfanity,
  filterProfanity,
} from '../shared/profanity';

/**
 * The filter has two failure modes and only one of them is visible.
 *
 * A swear word that gets through is embarrassing. An ordinary word that gets
 * mangled is worse: the person cannot say what they meant, cannot see why, and
 * has no way around it. So the innocent-word block below is the longest one
 * here on purpose, and it is the half to extend first when this is touched.
 */

const clean = (value: string) => filterProfanity(value);

describe('profanity filter — the languages', () => {
  it.each([
    ['sik'],
    ['sikim'],
    ['siktir'],
    ['siktirin'],
    ['qəhbə'],
    ['orospu'],
    ['piç'],
    ['göt'],
    ['götün'],
    ['yarraq'],
    ['ibnə'],
    ['pezevenk'],
    ['şərəfsiz'],
    ['amcıq'],
  ])('masks the Azerbaijani/Turkish word %s', (word) => {
    expect(containsProfanity(word)).toBe(true);
  });

  it.each([
    ['хуй'],
    ['пизда'],
    ['блядь'],
    ['сука'],
    ['ебать'],
    ['мудак'],
    ['пидор'],
    ['гандон'],
    ['говно'],
    ['нахуй'],
    ['заебал'],
  ])('masks the Russian word %s', (word) => {
    expect(containsProfanity(word)).toBe(true);
  });

  it.each([
    ['fuck'],
    ['fucking'],
    ['motherfucker'],
    ['bullshit'],
    ['bitch'],
    ['asshole'],
    ['cunt'],
    ['bastard'],
    ['slut'],
    ['dickhead'],
  ])('masks the English word %s', (word) => {
    expect(containsProfanity(word)).toBe(true);
  });
});

describe('profanity filter — evasion', () => {
  it('defeats digit substitution', () => {
    expect(containsProfanity('s1k')).toBe(true);
    expect(containsProfanity('fu@k')).toBe(false); // @ is a, not c — still nonsense
    expect(containsProfanity('a$$hole')).toBe(true);
    expect(containsProfanity('sh1t')).toBe(true);
    expect(containsProfanity('$hit')).toBe(true);
  });

  it('defeats repeated letters', () => {
    expect(containsProfanity('siiiik')).toBe(true);
    expect(containsProfanity('fuuuuck')).toBe(true);
    expect(containsProfanity('shiiiit')).toBe(true);
  });

  it('defeats dots and dashes between letters', () => {
    expect(containsProfanity('s.i.k')).toBe(true);
    expect(containsProfanity('f-u-c-k')).toBe(true);
    expect(containsProfanity('s*i*k*t*i*r')).toBe(true);
  });

  it('defeats spaces between letters', () => {
    expect(clean('s i k t i r').text).toBe(PROFANITY_MASK);
    expect(clean('f u c k').text).toBe(PROFANITY_MASK);
    expect(clean('sifariş f u c k gecikdi').text).toBe(`sifariş ${PROFANITY_MASK} gecikdi`);
  });

  it('defeats mixed case', () => {
    expect(containsProfanity('SiKtİr')).toBe(true);
    expect(containsProfanity('FUCK')).toBe(true);
  });

  it('defeats Cyrillic look-alikes hiding a Latin word', () => {
    // The `с` and the `о` here are Cyrillic.
    expect(containsProfanity('fuсk')).toBe(true);
    expect(containsProfanity('cyka')).toBe(true);
  });

  it('reads real Cyrillic as Russian rather than as a disguise', () => {
    expect(containsProfanity('сука')).toBe(true);
    expect(containsProfanity('спасибо')).toBe(false);
    expect(containsProfanity('заказ опоздал')).toBe(false);
  });
});

describe('profanity filter — whole words and suffixes', () => {
  it('matches the root with an agglutinative ending', () => {
    expect(containsProfanity('sikim')).toBe(true);
    expect(containsProfanity('siktirin')).toBe(true);
    expect(containsProfanity('götünü')).toBe(true);
  });

  it('does not match a root that merely opens a longer, ordinary word', () => {
    expect(containsProfanity('şikayət')).toBe(false);
    expect(containsProfanity('şikayətçi')).toBe(false);
    expect(containsProfanity('sikayet')).toBe(false);
  });

  it('does not treat a short root as a substring of any word', () => {
    expect(containsProfanity('pişik')).toBe(false);
    expect(containsProfanity('boks')).toBe(false);
    expect(containsProfanity('assistant')).toBe(false);
    expect(containsProfanity('classic')).toBe(false);
  });
});

describe('profanity filter — the innocent words', () => {
  const innocent = [
    // Everyday Azerbaijani a support message is actually made of.
    'salam', 'sifariş', 'sifarişim', 'çatdırılma', 'gecikdi', 'soyuq', 'isti',
    'restoran', 'kuryer', 'ünvan', 'ödəniş', 'geri', 'qaytarma', 'şikayət',
    'şikayətim', 'zəhmət', 'xahiş', 'təşəkkür', 'sağolun', 'yemək', 'çatdı',
    'pişik', 'piti', 'siqaret', 'sikkə', 'dəqiqə', 'saat', 'nömrə', 'kod',
    // The name, which letter-collapsing brings near an English slur.
    'Nigar',
    // Turkish, where the collisions are worst.
    'sıkıntı', 'sıkıntılı', 'sıkı', 'sıkışık', 'sıkmak', 'sıkıcı', 'sikinti',
    'piknik', 'boks', 'namuslu', 'şerefli', 'müdir', 'sürtmək',
    // Russian.
    'спасибо', 'заказ', 'курьер', 'ресторан', 'адрес', 'опоздание', 'суп',
    // English.
    'got', 'gotten', 'shiitake', 'prickle', 'pussycat', 'dickens', 'blade',
    'bladder', 'debate', 'Lebanon', 'analysis', 'assessment', 'classic',
    'cockpit', 'hue',
  ];

  it.each(innocent)('leaves %s untouched', (word) => {
    expect(clean(word)).toEqual({ text: word, filtered: false, onlyProfanity: false });
  });

  it('leaves an ordinary sentence exactly as written', () => {
    const sentence = 'Sifarişim 40 dəqiqə gecikdi və yemək soyuq gəldi.\nZəhmət olmasa baxın.';
    expect(clean(sentence)).toEqual({
      text: sentence,
      filtered: false,
      onlyProfanity: false,
    });
  });
});

describe('profanity filter — masking', () => {
  it('replaces the word and keeps the rest of the message', () => {
    const result = clean('Sifarişim gecikdi, bu nə siktir işdir, pulumu qaytarın');
    expect(result.filtered).toBe(true);
    expect(result.onlyProfanity).toBe(false);
    expect(result.text).toContain('Sifarişim gecikdi');
    expect(result.text).toContain('pulumu qaytarın');
    expect(result.text).toContain(PROFANITY_MASK);
    expect(result.text).not.toContain('siktir');
  });

  it('preserves the line breaks it found', () => {
    const result = clean('birinci sətir\nfuck\nüçüncü sətir');
    expect(result.text).toBe(`birinci sətir\n${PROFANITY_MASK}\nüçüncü sətir`);
  });

  it('reports a message that is nothing but profanity', () => {
    expect(clean('siktir').onlyProfanity).toBe(true);
    expect(clean('fuck fuck fuck').onlyProfanity).toBe(true);
    expect(clean('siktir!!!').onlyProfanity).toBe(true);
  });

  it('does not report one as such when a single ordinary word survives', () => {
    expect(clean('fuck sifariş').onlyProfanity).toBe(false);
  });

  it('says nothing was filtered when nothing was', () => {
    expect(clean('').filtered).toBe(false);
    expect(clean('Salam').filtered).toBe(false);
  });
});
