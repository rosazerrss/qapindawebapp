'use client';

/**
 * The two sounds, synthesised rather than downloaded.
 *
 * There are no audio files in this repository and adding two would mean two
 * more requests on a phone that is already waiting for a menu — for about a
 * second of sound each that the Web Audio API can describe in a few lines. The
 * brief asks for exactly two tones, "distinct" and recognisable from across a
 * kitchen, so:
 *
 *   chime — two soft notes rising. Something has happened and you will want to
 *           know about it eventually. A customer's order was accepted.
 *   alert — three short notes, harder edged, at a pitch that carries. Somebody
 *           has to do something now. A new order, a cancelled delivery.
 *
 * `notificationTone()` in `shared/notifications.ts` decides which; this file
 * only knows how to make them.
 *
 * There is a third noise, and it is deliberately not a "tone": the new-order
 * RING at the bottom of this file. It is not chosen by `notificationTone` and
 * never plays for a notification — it belongs to the ORDER, it repeats, and it
 * is meant to be heard across a kitchen rather than noticed on a phone.
 *
 * A BLOCKED SOUND IS NOT AN ERROR
 * -------------------------------
 * Every browser refuses to make noise until the person has interacted with the
 * page, and the refusal arrives as a rejected promise or a thrown constructor
 * depending on the browser. None of that is exceptional — it is the normal
 * state of a tab nobody has touched yet — so every path here is wrapped and
 * every failure is silence. A notification that cannot ring must still be a
 * notification that appears; a bell that throws would take the panel with it.
 *
 * `unlockNotificationSound` is wired to the first real interaction anywhere in
 * the app, which is the only moment a browser will let an AudioContext start.
 */

import type { NotificationTone } from '@/shared/notifications';
import {
  ALARM_TOP_UP_MS,
  alarmBurstsToSchedule,
  alarmSoundState,
  type AlarmSoundState,
} from '@/shared/newOrderAlarm';

let context: AudioContext | null = null;
let unlocked = false;
/** Set when the browser has no `AudioContext`, or refused to construct one. */
let unsupported = false;

/**
 * Whether the browser has actually been asked whether it will make a sound.
 *
 * False on the very first render, on the server, and in the moment between the
 * two. It is the difference between "this browser is muted" and "nobody has
 * checked yet", and the panel must never print the first when it means the
 * second — that was the whole of "SES SÖNDÜRÜLÜB YAZISI ÇIXIR".
 */
let probed = false;

/**
 * Whether somebody has activated the sound in THIS BROWSER, ever.
 *
 * Remembered in `localStorage`, because the owner asked for exactly that:
 * "BİRDEFE AKTİV ETDİKDE BES ETSİN ÇIXMASIN" — one activation is enough, and
 * it has to survive a reload as well as a navigation. It is a convenience and
 * nothing more: it grants no permission and unlocks no audio by itself, it only
 * stops the panel from asking a second time for something already given. The
 * browser still decides whether a sound is actually played.
 */
let activatedBefore = false;

const ACTIVATION_KEY = 'qapinda.sound.activated';

function readActivation(): boolean {
  try {
    return window.localStorage.getItem(ACTIVATION_KEY) === '1';
  } catch {
    // Private mode, a browser with storage switched off, a sandboxed frame.
    // A forgotten preference is a banner shown once too often, never a fault.
    return false;
  }
}

function rememberActivation(): void {
  try {
    window.localStorage.setItem(ACTIVATION_KEY, '1');
  } catch {
    // Same as above: the session still works, it is only the memory that is
    // lost, so this is never allowed to reach the caller.
  }
}

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;

  // Safari has only ever exposed the prefixed name, and the prefixed name is
  // not in the DOM typings — hence the cast rather than a wider `Window` type,
  // which the standard `AudioContext` declaration would fight with.
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function ensureContext(): AudioContext | null {
  if (context) return context;

  const Constructor = audioContextConstructor();
  if (!Constructor) {
    unsupported = true;
    return null;
  }

  try {
    context = new Constructor();
    watchVisibility();
  } catch {
    // Some browsers throw rather than return a suspended context when audio is
    // disallowed outright. There is nothing to recover — but there IS something
    // to report now: the panel says out loud that this browser will not ring.
    context = null;
    unsupported = true;
  }

  // Whatever the answer was, the browser has now been asked — so the panel is
  // allowed to say something about it.
  probed = true;
  announceSoundState();
  return context;
}

// ---------------------------------------------------------------------------
// What the panel is allowed to know about the sound
// ---------------------------------------------------------------------------

/*
 * A BLOCKED SOUND HAS TO BE VISIBLE.
 *
 * Everything in this file swallows its failures, which is right — a bell that
 * throws takes the panel with it — but "the alarm is silent and nobody has been
 * told" is the single worst outcome in the whole product: the restaurant
 * believes it is being warned about new orders and it is not. So the state is
 * published, and `NewOrderAlarm` renders a prompt or a warning from it.
 *
 * `useSyncExternalStore` is what reads this, hence the subscribe/snapshot pair:
 * the answer lives on a browser global with no event behind it, and every
 * moment it can change is a moment this file already knows about.
 */
const soundStateListeners = new Set<() => void>();

/**
 * `unknown` rather than `needsGesture` is the important default.
 *
 * The old default accused every browser of being muted from the first frame,
 * which is why the strip appeared on every screen of the panel and why one
 * activation never felt like enough. Nothing is claimed until `prime` has
 * asked.
 */
let soundState: AlarmSoundState = 'unknown';

function currentSoundState(): AlarmSoundState {
  return alarmSoundState({
    supported: !unsupported,
    unlocked,
    contextState: (context?.state as 'suspended' | 'running' | 'closed' | null) ?? null,
    probed,
    activatedBefore,
  });
}

function announceSoundState(): void {
  const next = currentSoundState();
  if (next === soundState) return;
  soundState = next;
  for (const listener of soundStateListeners) listener();
}

export function subscribeToNotificationSoundState(listener: () => void): () => void {
  soundStateListeners.add(listener);
  return () => soundStateListeners.delete(listener);
}

export function notificationSoundState(): AlarmSoundState {
  return soundState;
}

/**
 * The server has no audio, so it has nothing to say about it.
 *
 * `unknown` and not `needsGesture`: a server-rendered panel that arrives with
 * "your sound is off" printed on it is a panel that has diagnosed a browser it
 * has never met.
 */
export function notificationSoundServerState(): AlarmSoundState {
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Priming — done once, above the router
// ---------------------------------------------------------------------------

/*
 * WHY THIS IS NOT DONE BY THE PANEL.
 *
 * `NewOrderAlarm` lives inside `PanelShell`, and every restaurant screen mounts
 * its own `PanelShell`, so walking from the board to the menu editor throws the
 * component away and builds a new one. Anything the audio remembered in React
 * state would be forgotten on each of those steps — which is exactly what
 * "RESTORAN PANELİNDE HEREKET EDERKEN ... ÇIXIR" describes.
 *
 * So the audio lives here, in module scope, and is started by a provider
 * mounted in the ROOT layout: one `AudioContext` for the whole session, above
 * every route change, plus one document-level gesture listener that unlocks it
 * on the first click or key anywhere in the app. Navigating cannot forget any
 * of it, because none of it is inside the part that is thrown away.
 */

let primed = false;

/** The events a browser is willing to start audio from. */
const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;

/**
 * Asks the browser, once per session, whether it will make a sound — and wires
 * up the first gesture so that it can.
 *
 * Safe to call repeatedly; only the first call does anything. Called from
 * `NotificationSoundProvider` in the root layout.
 */
export function primeNotificationSound(): void {
  if (primed || typeof window === 'undefined') return;
  primed = true;

  activatedBefore = readActivation();

  // Constructing the context IS the question: a browser that will let this tab
  // make a noise hands back a `running` context, one that will not hands back a
  // `suspended` one, and one that cannot at all throws.
  const audio = ensureContext();
  probed = true;

  if (audio) {
    // A context that came back suspended may still wake without a gesture on
    // a browser that already trusts this origin. Worth one attempt before the
    // panel says anything about it.
    void resumeContext().then(() => announceSoundState());
  }

  announceSoundState();

  /*
   * The first real interaction anywhere in the app, which is the only moment a
   * browser will start audio from. Registered once, in the capture phase so a
   * handler that stops propagation cannot take it with it, and removed the
   * moment the sound is actually running — after that it is a listener on every
   * click of a long shift, doing nothing.
   */
  const onGesture = () => {
    unlockNotificationSound();
    if (notificationSoundUnlocked()) stopListeningForGesture();
  };

  const stopListeningForGesture = () => {
    for (const event of GESTURE_EVENTS) {
      window.removeEventListener(event, onGesture, true);
    }
  };

  for (const event of GESTURE_EVENTS) {
    window.addEventListener(event, onGesture, true);
  }
}

let visibilityWatched = false;

/**
 * Resumed when the tab comes back, and re-synced with it.
 *
 * Browsers suspend an AudioContext when the tab goes into the background, and on
 * some platforms — iOS especially — it never resumes by itself. Anything already
 * scheduled onto the audio clock is then simply not played, so coming back to
 * the tab has to both wake the context and rebuild the alarm's schedule from the
 * clock as it is now.
 */
function watchVisibility(): void {
  if (visibilityWatched || typeof document === 'undefined') return;
  visibilityWatched = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void resumeContext().then(() => {
      if (alarmRunning) resyncAlarm();
    });
  });
}

/**
 * Whether the context is awake, asked through a call rather than read inline.
 *
 * `state` is a live property that a `resume()` changes underneath us, and
 * TypeScript narrows it at the first test and then believes the narrowing — so
 * a second read written as `audio.state === 'running'` is reported as a
 * comparison that cannot be true. Asking through a function reads it afresh.
 */
function isRunning(audio: AudioContext): boolean {
  return audio.state === 'running';
}

/** Wakes a suspended context, and reports what the state is afterwards. */
async function resumeContext(): Promise<boolean> {
  const audio = context;
  if (!audio) return false;

  if (isRunning(audio)) return true;

  try {
    await audio.resume();
  } catch {
    // A resume outside a gesture is refused on some browsers. Not an error —
    // it is the reason the panel shows "Səsi aktivləşdirin".
  }

  announceSoundState();
  return isRunning(audio);
}

/**
 * Called from the first click, tap or key anywhere in the app, and from the
 * panel's own "Səsi aktivləşdirin" button.
 *
 * Creating the context inside a gesture is what makes it `running` rather than
 * `suspended`; created later, from a Firestore snapshot, it would start
 * suspended and every sound would be dropped. Safe to call repeatedly — after
 * the first success it does nothing but confirm the context is awake.
 */
export function unlockNotificationSound(): void {
  const audio = ensureContext();
  if (!audio) return;

  unlocked = true;
  // Written down here rather than in the button's handler so that EVERY route
  // to an unlock counts — the strip's button, the settings screen's test, and
  // the ordinary first click of a shift all mean the same thing: this browser
  // has been activated and must not be asked again.
  activatedBefore = true;
  rememberActivation();
  announceSoundState();

  void resumeContext().then((running) => {
    // An alarm that was ringing silently while the context slept starts being
    // heard from the gesture onwards, without the order having to arrive twice.
    if (running && alarmRunning) resyncAlarm();
  });
}

/** Whether a sound would actually be heard if we played one right now. */
export function notificationSoundUnlocked(): boolean {
  return unlocked && context?.state === 'running';
}

/** One note. Sine for the chime, a squarer edge for the alert. */
function note(
  audio: AudioContext,
  { at, frequency, seconds, gain, shape }: {
    at: number;
    frequency: number;
    seconds: number;
    gain: number;
    shape: OscillatorType;
  },
): void {
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();

  oscillator.type = shape;
  oscillator.frequency.setValueAtTime(frequency, at);

  // A note that starts and stops at full volume clicks, and a click is the one
  // sound nobody's phone should make. The ramps are the whole difference
  // between "a notification" and "a fault".
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  oscillator.connect(envelope);
  envelope.connect(audio.destination);

  oscillator.start(at);
  oscillator.stop(at + seconds + 0.02);
}

/**
 * Plays one of the two tones, or does nothing at all.
 *
 * Never throws and never returns a rejected promise: the caller is a Firestore
 * listener, and a listener that can be taken down by a muted phone is a panel
 * that stops updating.
 */
export function playNotificationTone(tone: NotificationTone): void {
  if (!unlocked) return;

  const audio = ensureContext();
  if (!audio) return;

  try {
    // A tone is a moment, not a schedule: played onto a suspended clock it is
    // simply never heard, so a sleeping context is woken and this one is
    // dropped rather than silently queued behind it.
    if (!isRunning(audio)) {
      void resumeContext();
      return;
    }

    const start = audio.currentTime + 0.01;

    if (tone === 'alert') {
      // Three short notes on one pitch and then above it. Insistent without
      // being a siren — this plays in a kitchen and on a moped, not in a ward.
      note(audio, { at: start, frequency: 880, seconds: 0.1, gain: 0.16, shape: 'triangle' });
      note(audio, { at: start + 0.14, frequency: 880, seconds: 0.1, gain: 0.16, shape: 'triangle' });
      note(audio, { at: start + 0.28, frequency: 1175, seconds: 0.22, gain: 0.18, shape: 'triangle' });
      return;
    }

    // Two soft notes rising a fourth. Pleasant enough to hear twenty times in
    // an evening, which is what a customer's order actually does.
    note(audio, { at: start, frequency: 659, seconds: 0.14, gain: 0.1, shape: 'sine' });
    note(audio, { at: start + 0.13, frequency: 880, seconds: 0.26, gain: 0.11, shape: 'sine' });
  } catch {
    // Autoplay policy, a closed context, an audio device that went away. All of
    // them mean the same thing here: no sound, and nothing else changes.
  }
}

// ---------------------------------------------------------------------------
// The kitchen alarm
// ---------------------------------------------------------------------------

/**
 * THE KITCHEN DOES NOT GET A CHIME. IT GETS A RING.
 * ------------------------------------------------
 * The owner's instruction, in capitals and twice: "RESTORANA SİFARİŞ GELDİKDE
 * ZİL SESİ KİMİ ÇIXSIN BİLDİRİŞ SESİ KİMİ ÇIXMASIN". A notification chime is a
 * polite noise designed to be ignorable; a kitchen at 8pm has extractor fans,
 * a fryer and three people talking, and an ignorable noise there is an order
 * that expires. So the new-order alarm is a telephone/doorbell RING: two tones
 * alternating fast enough to warble, loud in the band that carries over
 * machinery, and nothing like either of the two notification tones above.
 *
 * WHY A WARBLE RATHER THAN A LONG NOTE
 * ------------------------------------
 * A steady tone disappears into a room's own hum within about a second — the
 * ear stops reporting a sound that does not change. Alternating two pitches
 * every 45 ms is what an actual bell does and what makes a ring audible across
 * a room at a volume a steady tone could not achieve without being painful.
 *
 * AND WHY IT IS NOT UNBEARABLE
 * ---------------------------
 * Two rings, a short gap between them, then several seconds of silence — the
 * cadence of a telephone, which people have spent a century learning to answer
 * rather than to unplug. A continuous ring would be muted within a week, and a
 * muted alarm is the same as no alarm.
 */

/** The two pitches the ring alternates between, in hertz. */
const RING_HIGH_HZ = 1046;
const RING_LOW_HZ = 784;

/** How long the ring stays on each pitch. Faster than this buzzes; slower warbles. */
const RING_WARBLE_SECONDS = 0.045;

/** One ring of the pair, and the breath between them. */
const RING_SECONDS = 0.9;
const RING_GAP_SECONDS = 0.28;

/*
 * How often the burst repeats — `ALARM_INTERVAL_SECONDS`, in `/shared`.
 *
 * Five seconds from the start of one burst to the start of the next, so a
 * ~2.1-second burst leaves nearly three seconds of quiet. Long enough that a
 * kitchen can hear itself think and answer the phone; short enough that nobody
 * walks past a ringing panel and forgets it.
 */

/** True between `startNotificationAlarm` and `stopNotificationAlarm`. */
let alarmRunning = false;

/** The timer that tops the schedule up. Never the thing that makes a sound. */
let alarmTimer: ReturnType<typeof setTimeout> | null = null;

/** How far along the audio clock the alarm has already been booked. */
let alarmScheduledUntil = 0;

/**
 * Every oscillator booked and not yet finished.
 *
 * Kept because a burst scheduled onto the audio clock will play whatever
 * happens next — including after the order has been accepted. "Stops the
 * instant it is accepted from any device" means cancelling these, not merely
 * declining to book more.
 */
let alarmVoices: OscillatorNode[] = [];

/** One ring: a single oscillator told to alternate between the two pitches. */
function ring(audio: AudioContext, at: number): OscillatorNode {
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();

  // Square would carry further still and is what a cheap buzzer sounds like.
  // Triangle keeps the harmonics that cut through a fan without the edge that
  // makes people reach for the mute button in the first hour.
  oscillator.type = 'triangle';

  // The warble, written out as scheduled steps rather than an LFO: an
  // oscillator modulating another oscillator is one more node to leak, and the
  // schedule is exact and finished the moment it is set.
  for (let step = 0; step * RING_WARBLE_SECONDS < RING_SECONDS; step += 1) {
    oscillator.frequency.setValueAtTime(
      step % 2 === 0 ? RING_HIGH_HZ : RING_LOW_HZ,
      at + step * RING_WARBLE_SECONDS,
    );
  }

  // A bell has a body: it arrives fast, holds, and dies away. The hold is what
  // separates a ring from the two short blips of the alert tone.
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
  envelope.gain.setValueAtTime(0.3, at + RING_SECONDS - 0.12);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + RING_SECONDS);

  oscillator.connect(envelope);
  envelope.connect(audio.destination);

  oscillator.start(at);
  oscillator.stop(at + RING_SECONDS + 0.02);

  // Released as soon as it has finished, so a night's ringing does not leave a
  // few thousand dead nodes in the list the stop below walks.
  oscillator.onended = () => {
    envelope.disconnect();
    alarmVoices = alarmVoices.filter((voice) => voice !== oscillator);
  };

  return oscillator;
}

/**
 * One burst: ring, gap, ring, at a given moment on the audio clock.
 *
 * Never throws, like everything else here.
 */
function burst(audio: AudioContext, at: number): void {
  try {
    alarmVoices.push(ring(audio, at), ring(audio, at + RING_SECONDS + RING_GAP_SECONDS));
  } catch {
    // A closed context, an audio device that went away. No sound, nothing else
    // changes, and the schedule simply has a hole in it.
  }
}

/**
 * One burst, now.
 *
 * Exported so the settings screen's "test" and any future preview can make the
 * exact noise the kitchen will hear, rather than an approximation of it.
 */
export function playNewOrderRing(): void {
  if (!unlocked) return;

  const audio = ensureContext();
  if (!audio) return;

  if (!isRunning(audio)) {
    // Asked for, and the answer is reported: `notificationSoundState` is what
    // the panel renders its warning from. A ring scheduled onto a suspended
    // clock is a ring nobody hears.
    void resumeContext();
    if (!isRunning(audio)) return;
  }

  burst(audio, audio.currentTime + 0.01);
}

/**
 * Books every burst the schedule is still missing.
 *
 * Called when the alarm starts, from the top-up timer, and whenever the tab
 * comes back to the front. It is deliberately safe to call at any moment: the
 * cadence is remembered in `alarmScheduledUntil`, so an extra call books
 * nothing and a late one books whatever the delay cost.
 */
function scheduleAhead(): void {
  const audio = context;
  if (!alarmRunning || !audio || !isRunning(audio)) return;

  const { times, scheduledUntil } = alarmBurstsToSchedule(audio.currentTime, alarmScheduledUntil);
  for (const at of times) burst(audio, at);
  alarmScheduledUntil = scheduledUntil;
}

/**
 * Throws the schedule away and builds it again from the clock as it is now.
 *
 * Used after the tab has been in the background: `currentTime` does not advance
 * while a context is suspended on some platforms and does on others, so the
 * bookings made before the tab was hidden may be minutes in the past or minutes
 * in the future. Rebuilding is the only answer that is right on both.
 */
function resyncAlarm(): void {
  if (!alarmRunning) return;
  silenceVoices();
  alarmScheduledUntil = 0;
  scheduleAhead();
}

/** Cancels every booked burst, including the ones already sounding. */
function silenceVoices(): void {
  for (const voice of alarmVoices) {
    try {
      voice.onended = null;
      // Before its start time this cancels the burst outright; during it, it
      // cuts it off. Both are what "stop now" has to mean.
      voice.stop();
      voice.disconnect();
    } catch {
      // Already finished, or a context that has gone away underneath it.
    }
  }
  alarmVoices = [];
}

/**
 * Starts the repeating alarm, if it is not already running.
 *
 * WHY THIS IS A LOOP AND NOT A NOTIFICATION SOUND
 * ----------------------------------------------
 * `playNotificationTone` says "something happened" once and is finished. That
 * is right for a customer's phone and wrong for a kitchen: an order that rings
 * once at the moment nobody is looking at the screen is an order that expires.
 * So this keeps ringing until something stops it, and what stops it is the
 * ORDER leaving the pending state — see `NewOrderAlarm`, which is bound to the
 * live query rather than to any button.
 *
 * WHY IT KEEPS RUNNING WHEN THE SOUND IS BLOCKED
 * ----------------------------------------------
 * It records that the kitchen SHOULD be hearing an alarm, which is a fact about
 * the orders and not about the audio hardware. So a panel that has not been
 * touched yet still comes on with the schedule live; the first tap on "Səsi
 * aktivləşdirin" resumes the context and `resyncAlarm` starts the ringing from
 * that moment, rather than waiting for another order to arrive.
 *
 * Idempotent on purpose. Two orders arriving together, two snapshots for one
 * order, or a re-render all call this, and the alarm is one alarm: the
 * restaurant hears a kitchen that needs attention, not a count of how many
 * events fired.
 */
export function startNotificationAlarm(): void {
  if (alarmRunning) return;

  alarmRunning = true;
  alarmScheduledUntil = 0;

  ensureContext();
  watchVisibility();
  void resumeContext().then(() => scheduleAhead());
  scheduleAhead();

  /*
   * The timer only tops the schedule up; it never makes a sound.
   *
   * That is the whole fix for "arxa planda zəng gecikir". A hidden tab clamps
   * timers to roughly one call a minute, so a timer that RANG would ring a
   * minute late; a timer that BOOKS is two minutes ahead of itself and can
   * afford to be late. `setTimeout` re-armed each time rather than
   * `setInterval`, so a throttled tab cannot queue up a backlog of top-ups and
   * run them in a burst when it wakes.
   */
  const topUp = () => {
    if (!alarmRunning) return;
    scheduleAhead();
    alarmTimer = setTimeout(topUp, ALARM_TOP_UP_MS);
  };
  alarmTimer = setTimeout(topUp, ALARM_TOP_UP_MS);
}

/**
 * Stops it, immediately and from anywhere.
 *
 * Called when the last pending order leaves PLACED, when the sound preference
 * goes off, and when the panel unmounts. Safe to call when nothing is ringing,
 * which is what lets the caller be a plain effect that always tidies up.
 *
 * Everything booked ahead is cancelled here, not merely left to run out: an
 * order accepted on the till has to silence the kitchen's screen within the
 * second, and two minutes of already-scheduled bursts would otherwise carry on
 * ringing at a screen with nothing waiting on it.
 */
export function stopNotificationAlarm(): void {
  if (alarmTimer !== null) {
    clearTimeout(alarmTimer);
    alarmTimer = null;
  }

  alarmRunning = false;
  alarmScheduledUntil = 0;
  silenceVoices();
}

/** Whether the alarm is ringing right now. For tests and for the panel's badge. */
export function notificationAlarmRinging(): boolean {
  return alarmRunning;
}
