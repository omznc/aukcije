/**
 * Letting a visitor put the tabs in their own order.
 *
 * The strip is the site's whole navigation and it does not fit on a phone, so
 * whichever tabs happen to be first are the ones most people ever see. Someone
 * who only ever comes for /snizenja should be able to drag it to the front and
 * have it stay there.
 *
 * Hold, then drag - not drag alone. On a narrow screen the strip is a
 * horizontal scroller, and a plain drag is how you scroll it; a press that has
 * not yet lasted `HOLD_MS`, or that moves further than `SLOP` before it does,
 * is therefore treated as a scroll and never starts a reorder. The same rule
 * keeps an ordinary click on a tab doing what it has always done.
 *
 * The order is this browser's, like the theme and the saved list: nothing about
 * it reaches the server, and a visitor who has never dragged anything gets the
 * order the build shipped. It is stored as a list of hrefs rather than indices
 * so that adding a tab later cannot silently permute someone's saved order -
 * see `applyOrder`.
 *
 * The reorder that runs *before the first paint* is not this module. It is a
 * small inline copy in `Base.astro`, for the same reason the theme has one:
 * this file is a deferred module, and by the time it runs the header has been
 * on screen for a frame in the wrong order. This module owns the interaction;
 * the inline copy owns the first frame.
 *
 * ── On the motion ──────────────────────────────────────────────────────────
 *
 * Every position here is a spring, not a transition, and that is a deliberate
 * choice rather than a fashionable one. A CSS transition interpolates from
 * where it started to where it was told to go, over a fixed duration; if the
 * target changes halfway - which is the normal case here, because a fast drag
 * displaces the same tab twice before it has finished moving once - it either
 * restarts from a stale value or has to be cancelled and re-timed, and both
 * read as a stutter. A spring has no duration and no memory of a start: it only
 * knows where it is, how fast it is going, and where it is heading. Re-aiming
 * it mid-flight is the ordinary case rather than the exception.
 *
 * The parameters are Apple's two - damping ratio and response - rather than the
 * physical triplet, because those are the two a person can actually reason
 * about: damping is how much it overshoots, response is how quickly it gets
 * there. Overshoot appears in exactly one place, when a tab is released after
 * being thrown, because that is the only motion here a hand put momentum into.
 */

export const TAB_ORDER_KEY = 'prikaz:tabovi';

/** How long a press has to last before it stops being a tap or a scroll. */
const HOLD_MS = 350;
/** How far it may wander in that time and still count as a press. */
const SLOP = 8;
/** How close to the edge a drag has to get before the strip scrolls itself. */
const EDGE = 52;
const EDGE_SPEED = 14;

/**
 * Getting out of the way is not an event the hand caused, so it does not
 * overshoot; it just needs to be prompt enough to look like a reaction.
 */
const MAKE_WAY = { damping: 1, response: 0.3 };
/**
 * Landing after a throw. The one motion a hand put momentum into, and so the
 * one that is allowed a little bounce - the same licence Apple gives a flicked
 * card and withholds from a menu that merely appeared.
 */
const LAND = { damping: 0.8, response: 0.38 };
/** Picking up and putting down. Quick, and without a wobble on a stationary tab. */
const GRAB = { damping: 1, response: 0.25 };

/** How much a tab shrinks under a press, and grows once it is being carried. */
const PRESS_SCALE = 0.03;
const LIFT_SCALE = 0.045;

/**
 * Where a flick would come to rest, by the exponential decay a scroll uses.
 *
 * Not the textbook v²/2a: that models constant braking, which is not how any
 * touch surface has ever felt. `0.99` rather than the scroll-standard `0.998`
 * because a tab travels a strip, not a page - at `0.998` an ordinary flick
 * projects half a screen and the tab shoots to the far end of the nav.
 */
const project = (velocity: number, deceleration = 0.99) =>
  ((velocity / 1000) * deceleration) / (1 - deceleration);

/**
 * How far past its last slot a tab keeps following the finger.
 *
 * A hard stop at the end of the strip reads as a seized-up interface; the hand
 * cannot tell "there is nothing more here" from "this has broken". Resistance
 * that grows with the overshoot says the first without ever saying the second.
 */
const rubberband = (overshoot: number, dimension: number, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

interface Spring {
  value: number;
  velocity: number;
  target: number;
}

/**
 * One step of a damped harmonic oscillator, semi-implicit Euler.
 *
 * `response` is the period of the undamped system, which is what makes it
 * readable as "how long until it is there" without being a duration: the spring
 * is free to be re-aimed at any point and simply keeps going.
 */
function advance(s: Spring, dt: number, { damping, response }: { damping: number; response: number }): void {
  const w = (2 * Math.PI) / response;
  const acceleration = -w * w * (s.value - s.target) - 2 * damping * w * s.velocity;
  s.velocity += acceleration * dt;
  s.value += s.velocity * dt;
}

const settled = (s: Spring, epsilon = 0.1) =>
  Math.abs(s.value - s.target) < epsilon && Math.abs(s.velocity) < epsilon * 10;

const tabsOf = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLAnchorElement>('a[href]')];

const orderOf = (nav: HTMLElement) => tabsOf(nav).map((a) => a.getAttribute('href') ?? '');

function store(order: string[]): void {
  try {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Storage can be blocked outright. The drag still worked for this page; it
    // simply will not outlive it, which is better than refusing to move.
  }
}

/**
 * Put the strip in a stored order.
 *
 * Anything the stored list does not mention keeps its build-time position
 * relative to the others and lands at the end. That is what makes the stored
 * value survive a release: a tab added next month appears, rather than the
 * whole list being thrown away for not matching, and a tab that has been
 * removed is skipped rather than leaving a hole.
 */
export function applyOrder(nav: HTMLElement, order: readonly string[]): void {
  const remaining = new Map(tabsOf(nav).map((a) => [a.getAttribute('href') ?? '', a]));
  const placed: HTMLAnchorElement[] = [];

  for (const href of order) {
    const tab = remaining.get(href);
    if (tab) {
      placed.push(tab);
      remaining.delete(href);
    }
  }
  placed.push(...remaining.values());
  const reset = nav.querySelector('[data-tab-reset]');
  for (const tab of placed) nav.insertBefore(tab, reset);
}

/** The stored order, or null when this browser has never been dragged in. */
export function storedOrder(): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? 'null');
    return Array.isArray(raw) && raw.every((v) => typeof v === 'string') ? raw : null;
  } catch {
    return null;
  }
}

const gentle = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Wire the strip up.
 *
 * The whole module is one gesture and the motion it leaves behind, so the state
 * lives here in a closure rather than being threaded through arguments.
 */
export function wireTabReorder(nav: HTMLElement): void {
  /**
   * Every tab's visual offset from where the layout has put it.
   *
   * This is the trick the rest of the file leans on. A reorder moves a tab
   * instantly, so the moment after a swap each tab is already at its new place;
   * adding the distance it just jumped to its spring - and letting the spring
   * pull that back to zero - turns an instantaneous move into a continuous one.
   * A second swap arriving mid-flight adds to a spring that is already moving,
   * rather than interrupting anything, which is why a fast drag past three tabs
   * looks like three tabs getting out of the way instead of three restarts.
   */
  const offsets = new Map<HTMLAnchorElement, Spring>();
  const offsetOf = (el: HTMLAnchorElement): Spring =>
    offsets.get(el) ?? (offsets.set(el, { value: 0, velocity: 0, target: 0 }), offsets.get(el)!);

  /** -1 pressed, 0 at rest, +1 carried. One value, so it can pass through. */
  const grab: Spring = { value: 0, velocity: 0, target: 0 };

  let tab: HTMLAnchorElement | null = null;
  let pointerId = 0;
  let hold = 0;
  let dragging = false;
  /** Where in the tab the finger landed, so it stays under the same spot. */
  let grabOffset = 0;
  let pointerX = 0;
  let startX = 0;
  let frame = 0;
  let last = 0;
  /** Recent pointer samples, for the velocity the release hands to the spring. */
  let trail: Array<{ x: number; t: number }> = [];
  /** Set by a drag, read and cleared by the click it would otherwise become. */
  let suppressClick = false;

  /** The tab's slot, ignoring whatever the springs are currently doing to it. */
  const layoutLeft = (el: HTMLAnchorElement) =>
    el.getBoundingClientRect().left - offsetOf(el).value;

  const paint = (el: HTMLAnchorElement) => {
    const offset = offsetOf(el).value;
    const scale =
      el === tab
        ? 1 + (grab.value < 0 ? grab.value * PRESS_SCALE : grab.value * LIFT_SCALE)
        : 1;
    el.style.transform = `translateX(${offset.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    if (el === tab) el.style.setProperty('--lift', Math.max(0, grab.value).toFixed(3));
  };

  /**
   * Velocity at the moment of release, in px/s.
   *
   * Measured over a window rather than from the last two events: pointer
   * samples are noisy and irregular, and one unlucky final pair can report a
   * throw where the hand had already stopped.
   */
  const releaseVelocity = (): number => {
    const now = performance.now();
    const recent = trail.filter((s) => now - s.t < 90);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const lastSample = recent[recent.length - 1];
    const dt = (lastSample.t - first.t) / 1000;
    return dt > 0 ? (lastSample.x - first.x) / dt : 0;
  };

  /**
   * Move the held tab to wherever `centre` now belongs, and hand every tab that
   * had to shift the distance it shifted, so its spring can carry it there.
   *
   * Called both live during the drag and once more at release against the
   * projected resting point, which is what lets a flick throw a tab further
   * than the finger actually travelled.
   */
  const reorderTo = (centre: number): boolean => {
    if (!tab) return false;
    const others = tabsOf(nav).filter((el) => el !== tab);
    const target = others.find((other) => {
      const middle = layoutLeft(other) + other.offsetWidth / 2;
      const isAfter = !!(tab!.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
      return isAfter ? centre > middle : centre < middle;
    });
    if (!target) return false;

    const before = new Map(tabsOf(nav).map((el) => [el, layoutLeft(el)]));
    const isAfter = !!(tab.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (isAfter) target.after(tab);
    else target.before(tab);

    for (const [el, was] of before) {
      const moved = was - layoutLeft(el);
      if (moved) offsetOf(el).value += moved;
    }
    // The causal moment - a tab has changed places. Lighter than the pickup,
    // because it happens repeatedly and a full knock would turn into a rattle.
    navigator.vibrate?.(3);
    return true;
  };

  /** Follow the finger, resisting past the ends rather than stopping dead. */
  const track = () => {
    if (!tab) return;
    const slots = tabsOf(nav);
    const first = layoutLeft(slots[0]);
    const lastSlot = slots[slots.length - 1];
    const limit = layoutLeft(lastSlot) + lastSlot.offsetWidth - tab.offsetWidth;

    const wanted = pointerX - grabOffset;
    const home = layoutLeft(tab);
    let left = wanted;
    if (wanted < first) left = first + rubberband(wanted - first, nav.clientWidth);
    else if (wanted > limit) left = limit + rubberband(wanted - limit, nav.clientWidth);

    const spring = offsetOf(tab);
    spring.value = left - home;
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    // Clamped: a backgrounded tab returns with a gap of seconds, and a spring
    // integrated over that in one step explodes rather than catching up.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    if (dragging && tab) {
      const bounds = nav.getBoundingClientRect();
      if (pointerX < bounds.left + EDGE) nav.scrollLeft -= EDGE_SPEED;
      else if (pointerX > bounds.right - EDGE) nav.scrollLeft += EDGE_SPEED;
      track();
      reorderTo(layoutLeft(tab) + offsetOf(tab).value + tab.offsetWidth / 2);
    }

    advance(grab, dt, GRAB);

    let busy = dragging || !settled(grab, 0.005);
    for (const [el, spring] of offsets) {
      // The held tab is the hand's, not the spring's, until it is let go.
      if (el === tab && dragging) {
        paint(el);
        continue;
      }
      advance(spring, dt, el === tab ? LAND : MAKE_WAY);
      if (settled(spring)) {
        spring.value = spring.target;
        spring.velocity = 0;
        paint(el);
        if (el !== tab) {
          el.style.transform = '';
          el.style.removeProperty('will-change');
          offsets.delete(el);
        }
      } else {
        paint(el);
        busy = true;
      }
    }

    if (!busy) {
      cancelAnimationFrame(frame);
      frame = 0;
      finish();
    }
  };

  const run = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  /** Everything that can only happen once the tab has actually come to rest. */
  const finish = () => {
    if (!tab) return;
    tab.style.transform = '';
    tab.style.removeProperty('will-change');
    tab.style.removeProperty('--lift');
    delete tab.dataset.dragging;
    offsets.delete(tab);
    delete nav.dataset.reordering;
    tab = null;
  };

  const release = () => {
    clearTimeout(hold);
    if (!tab) return;

    if (tab.hasPointerCapture?.(pointerId)) tab.releasePointerCapture(pointerId);

    if (!dragging) {
      // Never picked up; only the press needs undoing.
      grab.target = 0;
      const pressed = tab;
      tab = null;
      offsetOf(pressed).target = 0;
      run();
      return;
    }

    const velocity = releaseVelocity();
    const spring = offsetOf(tab);
    // Where the throw was going, not where the finger stopped. A short flick
    // should be able to move a tab further than it was actually dragged.
    const centre = layoutLeft(tab) + spring.value + tab.offsetWidth / 2;
    if (!gentle()) {
      let moved = true;
      // A projection can cross more than one tab; keep going until it does not.
      while (moved) moved = reorderTo(centre + project(velocity));
    }

    spring.target = 0;
    // The seam between dragging and animating: the spring leaves at exactly the
    // speed the hand let go at, so there is no moment where one stops and the
    // other starts.
    spring.velocity = velocity;
    grab.target = 0;
    dragging = false;
    delete nav.dataset.reordering;
    store(orderOf(nav));
    run();
  };

  const begin = () => {
    if (!tab) return;
    dragging = true;
    suppressClick = true;
    nav.dataset.reordering = '';
    tab.dataset.dragging = '';
    tab.style.willChange = 'transform';
    tab.setPointerCapture?.(pointerId);
    grab.target = 1;
    // The one moment on this site where something is picked up rather than
    // pressed, and on a touch screen nothing else says so.
    navigator.vibrate?.(8);
    run();
  };

  // The markup already carries `draggable="false"`, which is what actually
  // stops this. Kept as a second line because it costs nothing and the failure
  // it guards against is silent: the native drag simply swallows the gesture
  // and the tab sits still.
  nav.addEventListener('dragstart', (event) => event.preventDefault());

  nav.addEventListener('pointerdown', (event) => {
    // Secondary buttons open menus; they are not a grip.
    if (event.button !== 0) return;
    const target = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!target) return;

    // Whatever was still settling is now this gesture's problem.
    if (tab && tab !== target) finish();

    tab = target;
    pointerId = event.pointerId;
    pointerX = event.clientX;
    startX = event.clientX;
    grabOffset = event.clientX - (target.getBoundingClientRect().left - offsetOf(target).value);
    trail = [{ x: event.clientX, t: performance.now() }];
    // Answering on the press rather than on the release, and answering before
    // the hold has decided anything: the tab gives under the finger the instant
    // it is touched, which is the whole of the feedback a tap ever gets.
    grab.target = -1;
    target.style.willChange = 'transform';
    run();
    hold = window.setTimeout(begin, HOLD_MS);
  });

  nav.addEventListener(
    'pointermove',
    (event) => {
      if (!tab || event.pointerId !== pointerId) return;
      pointerX = event.clientX;
      trail.push({ x: event.clientX, t: performance.now() });
      if (trail.length > 8) trail.shift();

      if (!dragging) {
        // Still deciding. Moving this far this early is a scroll, not a grip.
        if (Math.abs(event.clientX - startX) > SLOP) {
          clearTimeout(hold);
          grab.target = 0;
          tab = null;
        }
        return;
      }
      // Now that the tab is held, the same movement must not also scroll the
      // strip out from under it.
      event.preventDefault();
    },
    { passive: false },
  );

  for (const type of ['pointerup', 'pointercancel'] as const) {
    nav.addEventListener(type, (event) => {
      if (event.pointerId === pointerId) release();
    });
  }

  // A drag ends over a link, and letting go of a link is a click. Captured so
  // it is cancelled before the anchor's own default ever runs.
  nav.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  /**
   * Reordering from the keyboard.
   *
   * Shift rather than Alt or Control: both of those are already a browser or an
   * operating-system shortcut on some platform, and Alt+Left in particular is
   * Back. Shift+Arrow does nothing on a link.
   */
  nav.addEventListener('keydown', (event) => {
    if (!event.shiftKey) return;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const focused = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!step || !focused) return;
    event.preventDefault();

    const slots = tabsOf(nav);
    const neighbour = slots[slots.indexOf(focused) + step];
    if (!neighbour) return;

    const before = new Map(slots.map((el) => [el, layoutLeft(el)]));
    if (step === 1) neighbour.after(focused);
    else neighbour.before(focused);
    for (const [el, was] of before) {
      const moved = was - layoutLeft(el);
      if (moved) offsetOf(el).value += moved;
    }
    store(orderOf(nav));
    focused.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    run();
  });
}

/**
 * The way back. It only exists once there is something to undo, because a
 * control that resets an order nobody has changed is a control that has to be
 * explained.
 */
export function wireTabReset(nav: HTMLElement, button: HTMLElement): void {
  const shipped: string[] = JSON.parse(nav.dataset.defaultOrder ?? '[]');

  const reflect = () => {
    button.hidden = storedOrder() === null;
  };

  button.addEventListener('click', () => {
    try {
      localStorage.removeItem(TAB_ORDER_KEY);
    } catch {
      // Nothing was stored either, so there is nothing to fail at.
    }

    // Same trick as a drag: note where every tab was, move them, then let them
    // travel the distance rather than appear at the far end of it.
    const tabs = tabsOf(nav);
    const before = new Map(tabs.map((el) => [el, el.getBoundingClientRect().left]));
    applyOrder(nav, shipped);

    if (!gentle()) {
      for (const el of tabs) {
        const moved = (before.get(el) ?? 0) - el.getBoundingClientRect().left;
        if (!moved) continue;
        el.style.transition = 'none';
        el.style.transform = `translateX(${moved}px)`;
        requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = '';
        });
      }
    }
    reflect();
  });

  nav.addEventListener('pointerup', () => queueMicrotask(reflect));
  nav.addEventListener('keyup', () => queueMicrotask(reflect));
  reflect();
}
