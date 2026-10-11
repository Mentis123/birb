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
 * COMMIT swaps the model on the anchor. A failure BEFORE that swap (the mount
 * itself, if it throws) puts the outgoing model back if it got as far as
 * taking it off, disposes everything staged and rethrows: the old bird keeps
 * flying and the caller keeps its saved choice. From the swap on, the new bird
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
 * staged), 'sky', 'feathers', 'mount', 'dispose' (once the outgoing teardown
 * has run), 'audio', 'sync'. Disarmed, a checkpoint is one string compare per
 * stage per swap; nothing runs per frame.
 *
 * Also here: the re-LOD's retry gate (createRetierGate), pure.
 *
 * PURE: no DOM, no THREE. Imported on every boot (the Pionus's swaps go
 * through it too), so it stays small.
 */

export const BIRD_FAULT_STAGES = Object.freeze(['stage', 'sky', 'feathers', 'mount', 'dispose', 'audio', 'sync']);

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
 *   mounted()            the model on the anchor now
 *   handover(staged)     the live references now name the incoming bird
 *   disposeModel(model)  geometry and materials of a model with no sb
 *   audio(species)       the flight audio's voice switch
 *   sync()               the mounted bird inherits shadows and rim tint
 *   warn(message, err)
 */
export function createBirdTransaction(hooks) {
  let armed = null;
  const checkpoint = (stage) => {
    if (armed === stage) {
      armed = null;
      throw new Error('injected ' + stage + ' fault (__BIRB.speciesFault)');
    }
  };

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
      throw err;
    } finally {
      hooks.settle();
    }
    return staged;
  }

  function commit(staged) {
    const out = hooks.outgoing();
    try {
      checkpoint('mount');
      hooks.mount(staged.model);
    } catch (err) {
      // Nothing has changed hands. A mount that took the old model off the
      // anchor before it threw gets it put back.
      if (out.model && hooks.mounted() !== out.model) {
        try { hooks.mount(out.model); } catch (_) { /* nothing better to do */ }
      }
      release(staged);
      throw err;
    }
    hooks.handover(staged);
    const released = release(out);
    const torn = attempt(() => checkpoint('dispose')) || released;
    if (torn) hooks.warn('[species] the outgoing bird did not tear down cleanly; the ' + staged.species + ' flies on', torn);
    const voiced = attempt(() => { checkpoint('audio'); hooks.audio(staged.species); });
    if (voiced) hooks.warn('[species] the flight audio did not switch to the ' + staged.species + '; a frame will silence the old voice', voiced);
    const synced = attempt(() => { checkpoint('sync'); hooks.sync(); });
    if (synced) hooks.warn('[species] the ' + staged.species + ' did not inherit the shadow lever or rim tint', synced);
  }

  return {
    stage,
    commit,
    /** Arm one throw at `stage` (BIRD_FAULT_STAGES), or disarm with null. */
    fault(stageName) {
      armed = BIRD_FAULT_STAGES.indexOf(stageName) >= 0 ? stageName : null;
      return armed;
    },
    armed: () => armed,
  };
}

function attempt(fn) {
  try { fn(); return null; } catch (err) { return err; }
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
