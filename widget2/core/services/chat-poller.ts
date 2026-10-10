// src/app/widget2/core/services/chat-poller.ts
//
// Owns the chat-mode poll loop end to end: scheduling, which chatId it's
// polling, backoff, and a per-request timeout — the whole "difficult beast"
// of moving parts a naive setInterval loop leaves as separate,
// easy-to-forget details, gathered into one class instead of loose
// module-level `let`s.
//
// No `since` cursor at all, deliberately — every poll asks for and gets the
// chat's entire due history back (see pollChatMessages()/getDueMessages()),
// and applyPolledEvents() on the receiving end already updates a message in
// place when it recognizes one it already has (matched by timestamp). A
// cursor here would only reintroduce the exact failure mode that used to
// exist server-side: something advancing it past a message that hasn't
// arrived yet and permanently excluding it. Re-fetching everything is
// simply the robust choice.
//
// Ground rules this class enforces (never negotiable by a caller):
//   1. Never starts without a chatId — see start()'s guard.
//   2. Self-adjusting pace: a quiet chat backs off towards MAX_INTERVAL_MS
//      rather than polling at a fixed rate forever; any chatId with events
//      resets it back to BASE_INTERVAL_MS. It never stops on its own while
//      running, though — "slow down", not "give up" — a caller (idle
//      widget, mode switch, conversation reset) is what stops it.
//   3. Can never hang: every request carries its own abort timeout, so a
//      stuck connection can't stop the loop from ever ticking again.
//   4. Can never flood: exactly one request in flight at a time — the next
//      tick is scheduled only after the previous one finishes (success,
//      empty, or failure alike), never on a fixed timer that could stack
//      requests up behind a slow one.
import { RetEvent } from '../../shared/model-query';
import { pollChatMessages } from './chat.functions';
import { Settings } from '../settings';

export interface ChatPollerOptions {
  appId?: string;
  gptId?: string;
  /** Called with each non-empty batch of events a poll returns. */
  onEvents: (events: RetEvent[]) => void;
}

export class ChatPoller {
  /** Pace while the chat is active (a poll just returned events, or the
   *  visitor just sent something). This is the floor on how stale a reply
   *  can be, so it's set for a live conversation, not a background check. */
  private static readonly BASE_INTERVAL_MS = 1_500;
  /** Ceiling a quiet chat backs off towards — still checks regularly rather
   *  than ever fully stopping, so a late reply is still noticed. Deliberately
   *  far below a minute: on the other end of this is a human typing, and the
   *  worst case here is how long their message sits unseen. */
  private static readonly MAX_INTERVAL_MS = 15_000;
  /** How fast empty polls back off towards MAX_INTERVAL_MS, once the grace
   *  period below is used up. Gentle — reaching the ceiling should take
   *  minutes of genuine silence, not one pause for thought. */
  private static readonly BACKOFF_FACTOR = 1.25;
  /**
   * Empty polls to run at full pace before backing off at all.
   *
   * An agent reading the visitor's question and typing an answer produces a
   * run of empty polls that says nothing about the chat being idle — it's
   * the most likely moment for a reply to land. Backing off immediately (as
   * this used to) meant the interval was already 16s by the ~20s mark, so a
   * reply written at 25s waited another ~12s to be noticed. Holding BASE for
   * this many polls covers the normal think-and-type window at full speed.
   */
  private static readonly FAST_POLLS_BEFORE_BACKOFF = 12;
  /**
   * Long polling: how long the server may hold a poll open, waiting for a
   * message rather than answering immediately with whatever exists.
   *
   * This is what makes delivery feel instant — the request is already open
   * when the agent hits send, so the reply comes back in tens of ms instead
   * of waiting for the next interval to come round. The intervals above stop
   * being the thing that governs latency and become a pacing floor between
   * long polls, plus the fallback path when long polling isn't available.
   *
   * Kept in step with the server's own MAX_WAIT_MS, which clamps this anyway
   * — that value is in turn bounded by the deployed function's timeoutSeconds
   * (30s), leaving room for the read-and-respond work that follows the wait.
   * Set to 0 to go back to one-shot polling.
   */
  private static readonly LONG_POLL_WAIT_MS = 20_000;
  /**
   * Gap between a long poll returning empty and opening the next one. Just
   * enough to avoid a hot loop if the server answers instantly for some
   * reason; the server-side wait is doing the actual waiting.
   */
  private static readonly LONG_POLL_GAP_MS = 250;
  /** A poll request is aborted if it hasn't answered by this point — rule 3:
   *  nothing here can hang forever and wedge the loop. Must exceed
   *  LONG_POLL_WAIT_MS, or every long poll would be aborted by its own
   *  client-side timeout just before the server answered. */
  private static readonly REQUEST_TIMEOUT_MS = ChatPoller.LONG_POLL_WAIT_MS + 10_000;
  /**
   * Hard ceiling on how long this poller may run continuously without a
   * caller (chat-core.component.ts) ever calling stop() — a backstop for a
   * missed ngOnDestroy path, not a normal session limit. Rule 2's own doc
   * comment above says this loop "never stops on its own while running...
   * a caller is what stops it" — that's still true in the ordinary case
   * (stop() is called on both conversation reset and component teardown);
   * this only catches the abnormal one. Reset by any real activity (see
   * tick()'s events branch), so a genuinely live, long-running support chat
   * is never cut off mid-conversation — only a chat that's gone silent for
   * this entire stretch without anything ever calling stop() is. Generous
   * on purpose: normal idle backoff already caps request frequency at
   * MAX_INTERVAL_MS, so the cost of not catching an abandoned poller
   * sooner is small compared to the cost of cutting off a real one early. */
  private static readonly MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

  private timerHandle?: ReturnType<typeof setTimeout>;
  private chatId?: string;
  private currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
  /** Set on every start()/resume() and bumped again on any real activity
   *  (see tick()) — MAX_LIFETIME_MS above is measured from here, not from
   *  the original start(), so it's "no activity for this long", not "been
   *  polling for this long". */
  private lastActiveAt = 0;
  /**
   * The in-flight request's abort controller, so stop() can actually cancel
   * it rather than only cancelling the *next* tick.
   *
   * This barely mattered with short polls — an orphaned request settled
   * within a second or two and its result was discarded by the generation
   * check. With long polling it matters a lot: a poll left in flight holds an
   * open HTTP connection for up to LONG_POLL_WAIT_MS, and on the far end of
   * it a live Firestore listener (waitForDeliverableMessage()). Ending the
   * conversation has to tear that down now, not 25 seconds from now.
   */
  private inFlight?: AbortController;
  /** Set while stop()/pause() is aborting deliberately, so tick()'s catch can
   *  tell an intentional cancel from a real network failure and stay quiet. */
  private aborting = false;
  /**
   * The options start() was last called with, kept so resume() can restart
   * the loop on its own without the caller having to re-supply them.
   */
  private lastOpts?: ChatPollerOptions;
  /**
   * Paused by pause() — hidden tab, or the widget panel collapsed. Distinct
   * from stopped: the chatId is retained, so resume() picks the same chat
   * back up rather than needing a fresh start().
   */
  private paused = false;
  /** Consecutive empty polls since the last activity — drives the grace
   *  period above. Reset by anything that means "a reply is likely now". */
  private emptyPolls = 0;

  /**
   * Bumped on every start()/stop(). Captured by each tick/scheduled timeout
   * as its own "generation" — a tick whose generation no longer matches is
   * from a chat this poller isn't polling anymore (a mode switch or reset
   * that happened while it was scheduled or in flight) and does nothing,
   * rather than applying a stale response or double-scheduling.
   */
  private generation = 0;

  get isPolling(): boolean {
    return this.timerHandle !== undefined;
  }

  get activeChatId(): string | undefined {
    return this.chatId;
  }

  /**
   * Start (or restart, if chatId changed) polling GET /api/chat/poll for
   * messages the external chat system delivered via the webhook — the
   * counterpart to the model-mode path, which gets its reply inline
   * instead. No-op if already polling this exact chatId.
   *
   * Rule 1: an empty/undefined chatId never starts anything — there is
   * nothing to check history against and nothing to poll for.
   */
  start(chatId: string | undefined, opts: ChatPollerOptions): void {
    if (!chatId) return;
    if (this.chatId === chatId && this.timerHandle !== undefined) return;

    this.stop();
    this.chatId = chatId;
    this.lastOpts = opts;
    this.paused = false;
    this.currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
    this.emptyPolls = 0;
    this.lastActiveAt = Date.now();

    const generation = this.generation;
    this.scheduleNext(generation, opts, this.currentIntervalMs);
  }

  /**
   * Suspend polling without ending the chat — for when the widget is still
   * alive but nobody can see it: a backgrounded browser tab, or the panel
   * collapsed to its launcher button.
   *
   * Unlike stop() this keeps the chatId, so resume() carries on with the same
   * conversation. Nothing is lost while paused: the poll endpoint has no
   * cursor and returns every unread message on the next request, so whatever
   * the agent sent meanwhile arrives in one batch the moment we resume.
   *
   * Worth doing specifically because of long polling — a hidden widget would
   * otherwise sit holding an open request and a live Firestore listener on
   * the server indefinitely, which is real cost for something no one is
   * looking at. Browsers also throttle timers in background tabs, so a paused
   * loop is more predictable than one left to be starved.
   */
  pause(): void {
    if (this.paused || !this.chatId) return;
    this.paused = true;

    // Invalidate anything scheduled or in flight, but keep chatId/lastOpts.
    this.generation++;

    if (this.timerHandle !== undefined) {
      clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }
    this.abortInFlight();
  }

  /**
   * Resume after pause(). Restarts at full pace rather than wherever the
   * backoff had got to: the widget just became visible, so the visitor is
   * looking at it now and anything waiting should land immediately.
   *
   * No-op if not paused, or if there is nothing to poll.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;

    if (!this.chatId || !this.lastOpts) return;

    this.currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
    this.emptyPolls = 0;
    this.lastActiveAt = Date.now();
    // Fire straight away — a pending reply shouldn't wait out an interval
    // just because the visitor happened to be looking elsewhere.
    this.scheduleNext(this.generation, this.lastOpts, 0);
  }

  /** True while suspended by pause() — still holding a chat, just not polling. */
  get isPaused(): boolean {
    return this.paused;
  }

  private abortInFlight(): void {
    if (!this.inFlight) return;
    this.aborting = true;
    try {
      this.inFlight.abort();
    } catch {
      // Already settled — nothing to cancel.
    }
    this.inFlight = undefined;
    this.aborting = false;
  }

  /**
   * "Something just happened that makes a reply likely — poll like it."
   * Drops back to BASE_INTERVAL_MS, clears the backoff grace counter, and
   * re-arms the next tick immediately rather than letting a long timer that
   * is already ticking run out first.
   *
   * Call this whenever the visitor sends a message, or the widget regains
   * focus after being in a background tab. Neither can go through start():
   * it deliberately no-ops when already polling the same chatId, so without
   * this, sending a message while the poller sat at a 15s interval left it
   * there — the visitor waits longest at exactly the moment they're most
   * likely to get an answer.
   *
   * Safe to call when not polling (no-op).
   */
  resetPace(opts: ChatPollerOptions): void {
    if (!this.chatId || this.timerHandle === undefined) return;

    this.currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
    this.emptyPolls = 0;
    // The visitor just did something — evidence this poller is still
    // genuinely in use, so MAX_LIFETIME_MS's clock restarts from here too.
    this.lastActiveAt = Date.now();

    // Re-arm under the *current* generation: this is the same chat, not a
    // new one, so an in-flight request stays valid and is left alone.
    clearTimeout(this.timerHandle);
    this.scheduleNext(this.generation, opts, this.currentIntervalMs);
  }

  /**
   * Stop polling — call on conversation reset (new conversation, loading a
   * different stored one, switching chat modes) alongside clearing chatInfo.
   * Safe to call when not polling. Also invalidates any tick already
   * scheduled or in flight for whatever this was polling before.
   */
  stop(): void {
    this.generation++;

    if (this.timerHandle !== undefined) {
      clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }

    // Cancel the request itself, not just the schedule. Closing the socket is
    // what lets the server's res.on("close") handler fire and release its
    // Firestore listener — without this, ending a conversation leaves both
    // ends hanging until the long poll's own timeout expires.
    this.abortInFlight();

    this.chatId = undefined;
    this.lastOpts = undefined;
    this.paused = false;
    this.currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
    this.emptyPolls = 0;
    this.lastActiveAt = 0;
  }

  /**
   * Interval for the next tick after an unproductive poll (empty or failed).
   * Stays at BASE for the first FAST_POLLS_BEFORE_BACKOFF, then eases towards
   * MAX_INTERVAL_MS.
   */
  private backedOffInterval(): number {
    this.emptyPolls++;
    if (this.emptyPolls <= ChatPoller.FAST_POLLS_BEFORE_BACKOFF) {
      return ChatPoller.BASE_INTERVAL_MS;
    }
    return Math.min(
      this.currentIntervalMs * ChatPoller.BACKOFF_FACTOR,
      ChatPoller.MAX_INTERVAL_MS
    );
  }

  private scheduleNext(generation: number, opts: ChatPollerOptions, delay: number): void {
    this.timerHandle = setTimeout(() => this.tick(generation, opts), delay);
  }

  private async tick(generation: number, opts: ChatPollerOptions): Promise<void> {
    // Superseded by a stop()/start() while this was waiting to fire.
    if (generation !== this.generation) return;

    const chatId = this.chatId;
    if (!chatId) return;

    // Backstop for a missed stop() call — see MAX_LIFETIME_MS's doc comment.
    // Measured from lastActiveAt (real activity), not from the original
    // start(), so this only ever fires on a poller that's had nothing
    // happen — not a genuinely long, live conversation.
    if (Date.now() - this.lastActiveAt > ChatPoller.MAX_LIFETIME_MS) {
      console.warn(
        `[chat poll] chatId=${chatId} hit MAX_LIFETIME_MS (${ChatPoller.MAX_LIFETIME_MS}ms) with no activity ` +
        `and no stop() call — stopping automatically so it can't poll forever.`,
      );
      this.stop();
      return;
    }

    const controller = new AbortController();
    this.inFlight = controller;
    const timeoutId = setTimeout(() => controller.abort(), ChatPoller.REQUEST_TIMEOUT_MS);

    try {
      const result = await pollChatMessages(Settings.queryBase(), {
        chatId,
        appId: opts.appId,
        gptId: opts.gptId,
        waitMs: ChatPoller.LONG_POLL_WAIT_MS,
      }, controller.signal);

      // Superseded while the request was in flight — discard rather than
      // apply a response that no longer belongs to the active chat, and
      // don't schedule a further tick under this (dead) generation.
      if (generation !== this.generation) return;

      // The server says there is nothing here: no session for this chatId, or
      // one already closed. That is an answer, not a failure — stop rather
      // than keep asking. Returning without scheduling is deliberate: stop()
      // bumps the generation, so nothing else under this one runs either.
      if (result.chatClosed) {
        this.stop();
        return;
      }

      if (result.events?.length) {
        // Activity — rule 2's "reset on a new message": back to full pace,
        // and the grace period starts over. A live exchange therefore never
        // backs off at all: each reply re-arms the fast window.
        this.currentIntervalMs = ChatPoller.BASE_INTERVAL_MS;
        this.emptyPolls = 0;
        this.lastActiveAt = Date.now();
        opts.onEvents(result.events);
      } else if (ChatPoller.LONG_POLL_WAIT_MS > 0) {
        // An empty long poll means the server genuinely waited and nothing
        // came — not that the chat is idle and we should check less often.
        // Backing off here would be doubly wrong: it adds latency on top of a
        // mechanism whose whole point is to remove it, and it leaves gaps
        // where no request is open, which is the only time a message can be
        // missed and have to wait. So: reopen promptly and keep the loop
        // effectively always-connected.
        this.currentIntervalMs = ChatPoller.LONG_POLL_GAP_MS;
      } else {
        // Quiet — rule 2's "slow down", but only once the grace period is
        // used up. See FAST_POLLS_BEFORE_BACKOFF.
        this.currentIntervalMs = this.backedOffInterval();
      }
    } catch (err) {
      // A deliberate stop() cancels the request; that's an expected part of
      // ending a conversation, not a failure worth reporting. Also covers the
      // generation having already moved on.
      if (!this.aborting && generation === this.generation) {
        console.warn('[chat poll] failed:', err);
      }

      // A flaky or down endpoint backs off exactly like a quiet chat does —
      // rule 4: never hammer a struggling backend at a fixed rate. No grace
      // period here: errors back off from the first one, since retrying a
      // failing endpoint 12 times at full pace helps nobody.
      if (generation === this.generation) {
        this.emptyPolls = ChatPoller.FAST_POLLS_BEFORE_BACKOFF;
        this.currentIntervalMs = this.backedOffInterval();
      }
    } finally {
      clearTimeout(timeoutId);
      // Only clear if it's still ours — a stop()/start() during the request
      // may already have replaced it with a newer generation's controller.
      if (this.inFlight === controller) this.inFlight = undefined;

      // Rule 4's other half: the next tick is scheduled only now, after
      // this one fully settled — never on a fixed timer that could stack a
      // new request on top of one still in flight.
      if (generation === this.generation) {
        this.scheduleNext(generation, opts, this.currentIntervalMs);
      }
    }
  }
}
