/**
 * src/flight/species/bird-transaction.js — how the bird on the anchor is
 * replaced: STAGE, then COMMIT. The bird picker (a swap) and the per-tier LOD
 * (a re-LOD) both go through it; index.html supplies the hooks that know about
 * THREE, the anchor and the live references.
 *
 * STAGE builds the incoming bird COMPLETE and OFF the anchor: its model (and
 * the per-mesh preparation), its sky probe, and for the Pionus its authored
 * feathers. A throw anywhere in it disposes everything staged and goes back to
 * the caller; the outgoing bird was never touched. A sky that fails is the
 * one exception, as it always was: the bird keeps its lights only, with one
 * warning, and the swap goes on.
 *
 * COMMIT swaps the model on the anchor, and checks that the anchor now holds
 * exactly that model. A failure there (the mount throws, before or after it
 * attached anything, or the check fails) puts the outgoing model back and
 * checks THAT, disposes everything staged and rethrows: the old bird keeps
 * flying and the caller keeps its saved choice.
 *
 * THE DOUBLE FAILURE. If the outgoing bird cannot be put back either (the
 * restoring mount throws, or the anchor still does not hold it), a fresh
 * DEFAULT Birb is built (`fallback`: the Pionus variant this load runs, by a
 * minimal anchor path of its own that shares nothing with the mount hook) and
 * checked on the anchor; only once it is there are the staged and the
 * outgoing bird disposed (each guarded), and the live references name the
 * fresh Birb. If even that fails, the anchor is emptied and checked empty (a
 * known state: every per-frame reader looks bird parts up by name and skips
 * what is missing), the staged bird is disposed only if the anchor is
 * provably empty, the outgoing bird is left alone, and the live references
 * are untouched. Either way ONE warning, and the error the caller gets says
 * which (`err.birdFallback` 'birb' | 'none', `err.birdWarned` true), so the
 * caller does not warn a second time.
 *
 * From the swap on, the new bird
 * IS the bird: the live references are handed over (plain assignments), and
 * then three things that may throw are each guarded — warned about, and the
 * commit goes on — so none of them can leave the new bird half-mounted or
 * lose the bird altogether:
 *   dispose   the outgoing bird's teardown (its sky, then its model; each
 *             piece tried even if an earlier one threw), AFTER the mount, so
 *             the refcounted feather textures the crow and owl share never
 *             reach zero mid-swap;
 *   audio     the flight audio's switch of voice (a frame naming the new bird
 *             silences the old voice anyway);
 *   sync      what the mounted bird inherits from the running game (the
 *             shadow lever, the biome's rim tint).
 *
 * FAULT INJECTION (the harness's __BIRB.speciesFault): `fault(stage)` arms ONE
 * throw at a named stage of the next transaction — 'stage' (once everything is
 * staged), 'sky', 'feathers', 'mount', 'attached' (the mount has put the new
 * model on the anchor), 'restore' (putting the outgoing bird back),
 * 'fallback' (the fresh default Birb), 'dispose' (once the outgoing teardown
 * has run), 'audio', 'sync'. Several at once: 'attached,restore' (the double
 * failure) or an array; each throws once. Disarmed, a checkpoint is one Set
 * lookup per stage per swap; nothing runs per frame.
 *
 * Also here: the re-LOD's retry gate (createRetierGate), pure.
 *
 * PURE: no DOM, no THREE. Imported on every boot (the Pionus's swaps go
 * through it too), so it stays small.
 */

export const BIRD_FAULT_STAGES = Object.freeze(['stage', 'sky', 'feathers', 'mount', 'attached', 'restore', 'fallback', 'dispose', 'audio', 'sync']);

export const DOUBLE_FAILURE_WARNING = '[species] the swap failed and the outgoing bird could not be put back; flying a fresh birb';
export const ANCHOR_EMPTY_WARNING = '[species] the swap failed, the outgoing bird could not be put back and no fresh birb could be mounted; the bird anchor is left empty';

/**
 * hooks:
 *   build(staged)        construct staged.model (and staged.sb, staged.rim)
 *                        and prepare it; may throw
 *   sky(staged)          the sky probe or null; throws on failure, having
 *                        disposed its own half-made probe
 *   skyWarning(staged)   the warning a failed sky logs
 *   feathers(staged)     the authored-feather disposer or null; may throw
 *   settle()             after staging, thrown or not (index.html restores the
 *                        outgoing bird's rim handles)
 *   outgoing()           { sb, model, env, feathers } of the live bird
 *   mount(model)         the swap on the anchor
 *   mounted()            the ONE model on the anchor now (null when the anchor
 *                        holds none, or more than one)
 *   handover(staged)     the live references now name the incoming bird
 *   disposeModel(model)  geometry and materials of a model with no sb
 *   audio(species)       the flight audio's voice switch
 *   sync()               the mounted bird inherits shadows and rim tint
 *   fallback()           a fresh default Birb ON the anchor, by its own path
 *                        (never `mount`): { species: 'birb', model, sb: null,
 *                        env, feathers, rim }; disposes its own half-made bird
 *                        if it throws
 *   clearAnchor()        empty the anchor (the last resort)
 *   warn(message, err)
 */
export function createBirdTransaction(hooks) {
  const armed = new Set();
  // The outgoing model of a transaction that ended on an EMPTY anchor.
  let stranded = null;
  const checkpoint = (stage) => {
    if (armed.has(stage)) {
      armed.delete(stage);
      throw new Error('injected ' + stage + ' fault (__BIRB.speciesFault)');
    }
  };
  const armedList = () => (armed.size ? BIRD_FAULT_STAGES.filter((s) => armed.has(s)).join(',') : null);

  // A bird's sky, then its model: the species bird's own dispose, or the
  // Pionus's authored feather sheets and then its geometry and materials.
  // Every piece is tried even if an earlier one threw; returns the first
  // error, or null.
  const release = (bird) => {
    let first = null;
    const step = (fn) => { try { fn(); } catch (err) { if (!first) first = err; } };
    if (bird.env) step(() => bird.env.dispose());
    if (bird.sb) step(() => bird.sb.dispose());
    else if (bird.model) {
      if (bird.feathers) step(() => bird.feathers());
      step(() => hooks.disposeModel(bird.model));
    }
    return first;
  };

  function stage(id, quality) {
    const staged = { species: id, quality: id === 'birb' ? null : quality, sb: null, model: null, env: null, feathers: null, rim: null };
    try {
      hooks.build(staged);
      try {
        checkpoint('sky');
        staged.env = hooks.sky(staged);
      } catch (err) {
        staged.env = null;
        hooks.warn(hooks.skyWarning(staged), err);
      }
      checkpoint('feathers');
      staged.feathers = hooks.feathers(staged);
      checkpoint('stage');
    } catch (err) {
      release(staged);
      // The transaction ends here: a fault armed for a later stage of it
      // (or for a branch it never reached) is not carried into the next one.
      armed.clear();
      throw err;
    } finally {
      hooks.settle();
    }
    return staged;
  }

  // The mount failed: nothing has changed hands. Put the outgoing bird back
  // and CHECK it is the one bird on the anchor; failing that, a fresh default
  // Birb; failing that, an empty anchor. Nothing that might still be on the
  // anchor is disposed. Returns how it ended, for the error the caller gets.
  const recover = (out, staged, err) => {
    let restoreErr = null;
    if (out.model) {
      try {
        if (hooks.mounted() !== out.model) {
          checkpoint('restore');
          hooks.mount(out.model);
        }
        if (hooks.mounted() !== out.model) throw new Error('the outgoing bird is not on the anchor after restoring it');
        release(staged);
        return null;
      } catch (e) { restoreErr = e; }
    }
    // The double failure: neither the incoming nor the outgoing bird is
    // known to be on the anchor.
    let fresh = null;
    try {
      checkpoint('fallback');
      fresh = hooks.fallback();
      if (!fresh || !fresh.model || hooks.mounted() !== fresh.model) throw new Error('the fresh birb is not on the anchor');
    } catch (fallbackErr) {
      // Last resort: a known, empty anchor. A fresh bird that never made it
      // on is disposed with the staged one, only once the anchor is provably
      // empty; the outgoing bird is left as it is (it may be what a later
      // swap's outgoing() finds).
      let empty = false;
      try { hooks.clearAnchor(); empty = hooks.mounted() === null; } catch (_) { empty = false; }
      if (empty) {
        release(staged);
        if (fresh && fresh.model) release(fresh);
      }
      // The live references still name the outgoing bird; its model is off
      // the anchor now, so the next commit's outgoing() cannot see it.
      // Remembered here (only when the anchor is provably empty: otherwise
      // nothing is known about what is on it), it is that commit's to put
      // back or to tear down.
      stranded = empty ? (out.model || null) : null;
      hooks.warn(ANCHOR_EMPTY_WARNING, chain(err, restoreErr, fallbackErr, empty ? null : new Error('the anchor did not empty')));
      return 'none';
    }
    // The fresh Birb flies. Now, and only now, the staged and outgoing birds
    // go (each piece tried), and the fresh one becomes the live bird.
    hooks.handover(fresh);
    const lostStaged = release(staged);
    const lostOut = release(out);
    const lost = lostStaged || lostOut;
    attempt(() => hooks.audio('birb'));
    attempt(() => hooks.sync());
    // A sky that did not bake leaves the fresh Birb on its lights: said in
    // the same, single warning.
    const skyLost = fresh.skyError ? new Error('the fresh birb flies on its lights only: ' + (fresh.skyError.message || fresh.skyError)) : null;
    hooks.warn(DOUBLE_FAILURE_WARNING, chain(err, restoreErr, lost || skyLost));
    return 'birb';
  };

  function commit(staged) {
    try {
      commitArmed(staged);
    } finally {
      // One transaction per arming: a fault for a branch this commit never
      // reached (a 'restore' when the mount threw before attaching, a
      // 'fallback' when the restore held) is not left for a later swap.
      armed.clear();
    }
  }

  function commitArmed(staged) {
    const live = hooks.outgoing();
    const strandedModel = stranded;
    stranded = null;
    const out = strandedModel && !live.model ? Object.assign({}, live, { model: strandedModel }) : live;
    try {
      checkpoint('mount');
      hooks.mount(staged.model);
      checkpoint('attached');
      if (hooks.mounted() !== staged.model) throw new Error('the incoming bird is not on the anchor after mounting it');
    } catch (thrown) {
      // A hook may throw anything; the flags below need an object.
      const err = thrown instanceof Error ? thrown : new Error(String(thrown), { cause: thrown });
      const fallback = recover(out, staged, err);
      if (fallback) {
        err.birdFallback = fallback;
        err.birdWarned = true;
      }
      throw err;
    }
    hooks.handover(staged);
    const released = release(out);
    // A stranded Pionus model that something else replaced on the anchor in
    // the meantime (never through here) is still the live references' bird:
    // its geometry goes with them. (A crow/owl's goes with its sb.)
    const strandedLost = strandedModel && out.model !== strandedModel && !out.sb
      ? attempt(() => hooks.disposeModel(strandedModel)) : null;
    const torn = attempt(() => checkpoint('dispose')) || released || strandedLost;
    if (torn) hooks.warn('[species] the outgoing bird did not tear down cleanly; the ' + staged.species + ' flies on', torn);
    const voiced = attempt(() => { checkpoint('audio'); hooks.audio(staged.species); });
    if (voiced) hooks.warn('[species] the flight audio did not switch to the ' + staged.species + '; a frame will silence the old voice', voiced);
    const synced = attempt(() => { checkpoint('sync'); hooks.sync(); });
    if (synced) hooks.warn('[species] the ' + staged.species + ' did not inherit the shadow lever or rim tint', synced);
  }

  return {
    stage,
    commit,
    /**
     * Arm one throw at each named stage (BIRD_FAULT_STAGES): a name, a comma
     * list ('attached,restore') or an array; null disarms. Replaces whatever
     * was armed. Returns what is armed now (a comma list), or null.
     */
    fault(stageNames) {
      armed.clear();
      const list = Array.isArray(stageNames) ? stageNames : (typeof stageNames === 'string' ? stageNames.split(',') : []);
      for (const s of list) if (BIRD_FAULT_STAGES.indexOf(s.trim()) >= 0) armed.add(s.trim());
      return armedList();
    },
    armed: armedList,
  };
}

function attempt(fn) {
  try { fn(); return null; } catch (err) { return err; }
}

// The one warning of a double failure carries every error that led to it:
// the mount's, then the restore's, then whatever came after (in order).
function chain(mountErr, ...later) {
  const parts = ['mount: ' + (mountErr && mountErr.message)];
  const names = ['restore', 'then'];
  later.forEach((e, i) => { if (e) parts.push((names[i] || 'then') + ': ' + (e.message || String(e))); });
  return new Error(parts.join('; '), { cause: mountErr });
}

/**
 * The re-LOD's retry gate. A re-LOD that fails is not retried for the SAME
 * request — the same species at the same tier would fail the same way on
 * every frame-rate wobble — but one failure must not freeze the LOD for the
 * rest of the session either: a different tier asked for, or a user action
 * (a picker click, setSpecies, a quality-preset change) lifts it.
 *
 *   allows(species, tier)  may this re-LOD run? A different request than the
 *                          one that failed lifts the block.
 *   failed(species, tier)  record a failure
 *   reset()                a user action; true if a block was lifted
 */
export function createRetierGate() {
  let blocked = null;
  return {
    allows(species, tier) {
      if (!blocked) return true;
      if (blocked.species === species && blocked.tier === tier) return false;
      blocked = null;
      return true;
    },
    failed(species, tier) { blocked = { species, tier }; },
    reset() {
      const was = !!blocked;
      blocked = null;
      return was;
    },
    blocked: () => (blocked ? { ...blocked } : null),
  };
}
