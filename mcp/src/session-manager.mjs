/**
 * Single-session lifecycle + a per-session FIFO queue over EVERY session-touching
 * call. The guardrail lock protects write dispatch but not page-state coherence,
 * so navigate/snapshot/click/type/scroll/screenshot/provider/teardown all run
 * one-at-a-time in arrival order. Calls that would queue past the depth bound get
 * a structured `busy` result (P0-d: the bound is kept below client tool-call
 * timeouts so back-pressure surfaces as `busy`, never a client timeout).
 */

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_QUEUE_DEPTH = 16;

/**
 * Creates a single-session manager.
 *
 * @param {{ idleTimeoutMs?: number, maxQueueDepth?: number }} [options] Manager options.
 * @returns {object} Session manager API.
 */
export function createSessionManager(options = {}) {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;

  let session = null;
  let chain = Promise.resolve();
  let pending = 0;
  let idleTimer = null;

  /**
   * Runs a function exclusively behind the FIFO queue.
   *
   * @param {() => Promise<any>} fn Work to serialize.
   * @param {{ bypassBusyBound?: boolean }} [opts] Options.
   * @returns {Promise<any>} Work result, or a busy signal.
   */
  function runExclusive(fn, opts = {}) {
    if (!opts.bypassBusyBound && pending >= maxQueueDepth) {
      return Promise.resolve({ status: 'busy', queueDepth: pending });
    }
    pending += 1;
    const result = chain.then(fn);
    chain = result.then(
      () => {},
      () => {}
    );
    return result.finally(() => {
      pending -= 1;
    });
  }

  /** Clears any pending idle timer. */
  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /** (Re)arms the idle timer; on expiry, tears down through the queue with claim-gating. */
  function armIdle() {
    clearIdle();
    if (!session || idleTimeoutMs <= 0) return;
    idleTimer = setTimeout(() => {
      // Idle teardown goes THROUGH the queue (A4) and respects claim-gating; a
      // session with pending claims is left alive rather than force-closed.
      void teardown({ force: false, reason: 'idle' });
    }, idleTimeoutMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  /** Marks the session as recently used and re-arms idle expiry. */
  function touch() {
    if (session) session.lastUsedAt = Date.now();
    armIdle();
  }

  /**
   * Launches the single session via a caller-provided factory.
   *
   * @param {() => Promise<{ browser?: any, context?: any, page: any, account?: string }>} factory Launch factory.
   * @returns {Promise<object>} Structured result.
   */
  function launch(factory) {
    return runExclusive(async () => {
      if (session) {
        return { status: 'already-active', account: session.account, createdAt: session.createdAt };
      }
      const launched = await factory();
      session = {
        browser: launched.browser ?? null,
        context: launched.context ?? null,
        page: launched.page,
        providerSession: null,
        account: launched.account ?? null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        pendingClaims: new Set()
      };
      armIdle();
      return { status: 'launched', account: session.account, createdAt: session.createdAt };
    });
  }

  /**
   * Tears the session down, refusing while pending claims exist unless forced.
   *
   * @param {{ force?: boolean, reason?: string }} [opts] Teardown options.
   * @returns {Promise<object>} Structured result.
   */
  function teardown(opts = {}) {
    return runExclusive(async () => {
      if (!session) return { status: 'no-session' };
      if (session.pendingClaims.size > 0 && !opts.force) {
        return {
          status: 'needs-confirmation',
          code: 'pending-claims',
          pendingClaims: [...session.pendingClaims],
          message: 'Session has pending guarded claims; pass force:true to tear down anyway.'
        };
      }
      // Prefer closing the browser (which closes its contexts+pages); fall back
      // to the context for a persistent-context launch that has no browser handle.
      const closable = session.browser || session.context;
      clearIdle();
      const closed = session;
      session = null;
      try {
        if (closable && typeof closable.close === 'function') await closable.close();
      } catch (error) {
        return { status: 'error', code: 'teardown-close-failed', message: String(error?.message || error) };
      }
      return { status: 'torn-down', account: closed.account, reason: opts.reason ?? 'requested' };
    }, { bypassBusyBound: true });
  }

  /**
   * Runs work against the live session page, serialized behind the queue.
   *
   * @param {(session: object) => Promise<object>} fn Work needing the live page.
   * @returns {Promise<object>} Work result, or a needs-preflight/busy signal.
   */
  function withSession(fn) {
    return runExclusive(async () => {
      if (!session) {
        return { status: 'needs-preflight', code: 'no-session', message: 'No active session; call cloak_launch first.' };
      }
      const result = await fn(session);
      touch();
      return result;
    });
  }

  return {
    launch,
    teardown,
    withSession,
    isActive: () => Boolean(session),
    snapshot: () =>
      session
        ? {
            active: true,
            account: session.account,
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt,
            pendingClaims: session.pendingClaims.size,
            queueDepth: pending
          }
        : { active: false, queueDepth: pending },
    _addClaim: (id) => session?.pendingClaims.add(id),
    _resolveClaim: (id) => session?.pendingClaims.delete(id)
  };
}
