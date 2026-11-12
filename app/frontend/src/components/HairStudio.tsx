/**
 * Hair Studio (PRD F15): a grooming workspace in the viewport. Guide-curve
 * brushes (Add, Delete, Comb, Snake Hook, Grow/Shrink, Pinch, Puff, Smooth,
 * Slide, Density, Selection) with radius, strength, falloff, X symmetry and
 * front-facing only; a parting tool; a lock tool; and a layer view.
 *
 * A stroke works on the curves in world space and is committed to the
 * document when the pointer is released, so each stroke is one undo step.
 *
 * Two ways to groom:
 * - Guides (style.groom.curves): the brushes comb a few guide curves and the
 *   locks and cards are generated around them. The first stroke turns the
 *   slider-made guides into an authored groom.
 * - Cards (style.groom.cards, D-114): every lock and card is its own curve,
 *   placed by hand, one curve = one card, as in the "Hair cards from curves"
 *   workflow. "Edit cards directly" turns the hair on screen into hand-placed
 *   cards; the same brushes then work on them, Draw adds a card along the
 *   pointer, and the card settings change the selected cards.
 */
import { useEffect, useRef, useState } from 'react';
import {
  applyDab,
  ATLAS_TAGS,
  DEFAULT_BRUSH,
  drawnCurve,
  GROOM_TOOLS,
  nearestCard,
  type AtlasTag,
  type AuthoredCard,
  type BrushSettings,
  type GroomCard,
  type GroomContext,
  type GroomCurve,
  type GroomTool,
  type HairStyleParams,
} from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi } from '../state/ui';

type Vec3 = [number, number, number];

const TOOL_LABELS: Record<GroomTool, string> = {
  comb: 'Comb',
  snakeHook: 'Snake hook',
  grow: 'Grow',
  shrink: 'Shrink',
  pinch: 'Pinch',
  puff: 'Puff',
  smooth: 'Smooth',
  slide: 'Slide',
  add: 'Add',
  delete: 'Delete',
  density: 'Density',
  select: 'Select',
};

const TAG_LABELS: Record<AtlasTag, string> = { clump: 'Clump', strand: 'Strand', fringe: 'Fringe', flyaway: 'Flyaway', base: 'Base', lock: 'Lock' };

type Mode = GroomTool | 'parting' | 'draw';

/** How far a drawn card floats off the skin it is drawn over, metres. */
const DRAW_LIFT = 0.005;

export function HairStudio({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const [mode, setMode] = useState<Mode>('comb');
  const [brush, setBrush] = useState<BrushSettings>({ ...DEFAULT_BRUSH });
  const [layers, setLayers] = useState({ scalp: true, locks: true, cards: true, shell: true });
  const [lock, setLock] = useState({ width: 1, curl: 0 });
  const [cardEdit, setCardEdit] = useState({ widthScale: 1.25, twist: 0.25 });
  /** Selection weights by curve index (not saved with the style). */
  const selection = useRef<number[]>([]);
  const stroke = useRef<{ curves: GroomCurve[]; hidden: GroomCurve[]; last: [number, number]; path: Vec3[]; drawRoot: GroomCurve['root'] | null } | null>(null);
  const [, redraw] = useState(0);
  const vp = studio.viewport;
  const scene = studio.scene;
  const gen = scene.hairGenerator();
  const style = studio.engine.doc.hair.style;
  const cardMode = Boolean(style?.groom.cards?.length);
  const lastMode = useRef(cardMode);
  if (lastMode.current !== cardMode) {
    // Guides and cards are different curves: a selection of one means nothing to the other.
    lastMode.current = cardMode;
    selection.current = [];
  }

  /** Whether a curve can be brushed: in card mode only the kinds shown (hide the cards to work on the locks alone). */
  const editable = (c: GroomCurve) => !c.card || (c.card.kind === 'lock' ? layers.locks : layers.cards);

  /** Every curve Hair Studio edits, on the current body, with its selection. */
  const allCurves = (): GroomCurve[] => {
    const hair = scene.cardHair;
    if (!hair) return [];
    if (cardMode) {
      return hair.cardCurves.map((c, i) => {
        const { root, points, culled: _culled, ...card } = c;
        return { root, points: points.map((p) => [p[0], p[1], p[2]] as Vec3), card, selected: selection.current[i] ?? 0 };
      });
    }
    const authored = style?.groom.curves;
    return hair.guideCurves.map((points, i) => ({
      root: hair.guideRoots[i]!,
      points: points.map((p) => [p[0], p[1], p[2]] as Vec3),
      ...(authored?.[i]?.lockWidth !== undefined ? { lockWidth: authored[i]!.lockWidth } : {}),
      ...(authored?.[i]?.lockCurl !== undefined ? { lockCurl: authored[i]!.lockCurl } : {}),
      selected: selection.current[i] ?? 0,
    }));
  };

  // Brush mode, the curve overlay and the layer view while the studio is open.
  useEffect(() => {
    if (!vp) return;
    vp.setBrushMode(true);
    return () => {
      vp.setBrushMode(false);
      vp.setGroomOverlay(null);
      vp.setHairLayers({ shell: true, locks: true, cards: true });
      scene.setScalpLayerVisible(true);
    };
  }, [vp, scene]);
  useEffect(() => {
    if (!stroke.current) vp?.setGroomOverlay(allCurves().filter(editable));
  });
  useEffect(() => {
    vp?.setHairLayers({ shell: layers.shell, locks: layers.locks, cards: layers.cards });
    scene.setScalpLayerVisible(layers.scalp);
    vp?.refresh();
  }, [layers, vp, scene]);
  useEffect(() => {
    if (mode === 'draw' && !cardMode) setMode('comb');
  }, [mode, cardMode]);

  const context = (): GroomContext | null => {
    if (!vp) return null;
    const view = vp.groomView();
    const positions = studio.engine.positions;
    const mid = gen.headMiddle(positions);
    const onScalp = (p: Vec3) => gen.attachToScalp(p, positions);
    return {
      project: view.project,
      unproject: view.unproject,
      eye: view.eye,
      rootNormal: (root) => gen.rootNormal(root, positions),
      pick: (x, y) => {
        const hit = view.pick(x, y);
        if (!hit) return null;
        const s = onScalp(hit.point);
        // Only on the scalp itself (the body tier is coarser than hm08's scalp, so within a centimetre).
        return s && Math.hypot(s.point[0] - hit.point[0], s.point[1] - hit.point[1], s.point[2] - hit.point[2]) < 0.01 ? s : null;
      },
      attach: onScalp,
      mirror: (p) => [2 * mid - p[0], p[1], p[2]],
    };
  };

  const commit = (label: string, update: (s: HairStyleParams) => void) => {
    studio.engine.update(label, (d) => {
      const s = structuredClone(d.hair.style!);
      update(s);
      d.hair.style = s;
    });
  };

  /** Undo the Creator's length and fringe on an authored curve's offsets (they are applied on top of the style). */
  const unadjust = (points: number[]) => {
    const adjust = studio.engine.doc.hair.adjust;
    if (!adjust || (adjust.length === 1 && adjust.fringe === 1)) return points;
    const forward = points[points.length - 1]! > 0.02;
    const k = adjust.length * (forward ? adjust.fringe : 1);
    return points.map((v) => v / k);
  };

  /** Back from this body to the authored groom. */
  const toAuthored = (curves: GroomCurve[]) => {
    const positions = studio.engine.positions;
    return curves.map((c) => {
      const g = gen.authoredGuide(c.root, c.points, positions, { width: c.lockWidth, curl: c.lockCurl });
      g.points = unadjust(g.points);
      return g;
    });
  };

  /** A new card's settings when there is no card near it to copy. */
  const defaultCard = (kind: 'lock' | 'card'): GroomCard => {
    const s = studio.engine.doc.hair.style;
    return kind === 'lock'
      ? { kind, width: s?.locks.width ?? 0.07, tag: 'lock', region: 0, flip: false, twist: 0, layer: 0.2, random: 0.5 }
      : { kind, width: s?.cards.width ?? 0.03, tag: 'clump', region: 0, flip: false, twist: 0, layer: 1, random: 0.5 };
  };

  /** Back from this body to hand-placed cards. */
  const toAuthoredCards = (curves: GroomCurve[]): AuthoredCard[] => {
    const positions = studio.engine.positions;
    return curves.map((c) => {
      const card = gen.authoredCard({ root: c.root, points: c.points, ...(c.card ?? defaultCard('card')) }, positions);
      card.points = unadjust(card.points);
      return card;
    });
  };

  const commitCurves = (label: string, curves: GroomCurve[]) => {
    selection.current = curves.map((c) => c.selected ?? 0);
    if (cardMode) {
      const cards = toAuthoredCards(curves);
      commit(label, (st) => void (st.groom = { ...st.groom, cards }));
    } else {
      const authored = toAuthored(curves);
      commit(label, (st) => void (st.groom = { ...st.groom, curves: authored }));
    }
  };

  // Pointer strokes on the canvas.
  useEffect(() => {
    if (!canvas) return;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const ctx = context();
      if (!ctx) return;
      const p = at(e);
      const all = allCurves();
      let drawRoot: GroomCurve['root'] | null = null;
      const path: Vec3[] = [];
      if (mode === 'draw') {
        // A card starts on the scalp.
        const hit = ctx.pick(p[0], p[1]);
        if (!hit) return;
        drawRoot = hit.root;
        path.push(hit.point);
      }
      canvas.setPointerCapture(e.pointerId);
      stroke.current = { curves: all.filter(editable), hidden: all.filter((c) => !editable(c)), last: p, path, drawRoot };
      if (mode !== 'draw') move(e);
    };
    const move = (e: PointerEvent) => {
      const s = stroke.current;
      if (!s) return;
      const ctx = context();
      if (!ctx || !vp) return;
      const p = at(e);
      if (mode === 'parting') {
        const hit = ctx.pick(p[0], p[1]);
        if (hit && (s.path.length === 0 || dist(hit.point, s.path[s.path.length - 1]!) > 0.006)) s.path.push(hit.point);
        vp.setGroomOverlay([...s.curves, { points: s.path, selected: 1 }].filter((c) => c.points.length >= 2));
      } else if (mode === 'draw') {
        // Over the body: just off its skin. Past it: at the depth the hair has reached.
        const last = s.path[s.path.length - 1]!;
        const hit = vp.groomView().pick(p[0], p[1]);
        const q: Vec3 = hit
          ? [hit.point[0] + hit.normal[0] * DRAW_LIFT, hit.point[1] + hit.normal[1] * DRAW_LIFT, hit.point[2] + hit.normal[2] * DRAW_LIFT]
          : ctx.unproject(p[0], p[1], ctx.project(last).depth);
        if (dist(q, last) > 0.003) s.path.push(q);
        vp.setGroomOverlay([...s.curves, { points: s.path, selected: 1 }].filter((c) => c.points.length >= 2));
      } else {
        s.curves = applyDab(s.curves, mode, brush, ctx, { from: s.last, to: p });
        vp.setGroomOverlay(s.curves);
      }
      s.last = p;
    };
    const up = (e: PointerEvent) => {
      const s = stroke.current;
      if (!s) return;
      stroke.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (mode === 'parting') {
        if (s.path.length < 2) return;
        const positions = studio.engine.positions;
        const line = s.path.flatMap((q) => gen.toNeutral(q, positions).map((v) => Math.round(v * 1e6) / 1e6));
        commit('Draw parting', (st) => void (st.part = { ...st.part, side: st.part.side === 'none' ? 'center' : st.part.side, line }));
        return;
      }
      if (mode === 'draw') {
        const ctx = context();
        const points = drawnCurve(s.path);
        if (!ctx || !points || !s.drawRoot) {
          vp?.setGroomOverlay(s.curves);
          return;
        }
        const card = nearestCard(s.curves, points[0]!) ?? defaultCard(layers.cards ? 'card' : 'lock');
        const added: GroomCurve[] = [{ root: s.drawRoot, points, card: { ...card, random: 0.5 } }];
        if (brush.symmetry) {
          // The same card across the head's middle, rooted on the scalp there.
          const m = ctx.attach(ctx.mirror(points[0]!));
          if (m && dist(m.point, points[0]!) > 0.004) {
            const mp = points.map((q) => ctx.mirror(q));
            mp[0] = m.point;
            added.push({ root: m.root, points: mp, card: { ...card, random: 0.5, flip: !card.flip } });
          }
        }
        commitCurves('Draw card', [...s.hidden, ...s.curves, ...added]);
        return;
      }
      if (mode === 'select') {
        // Selecting adds and removes nothing: the brushed curves are the editable ones, in order.
        let j = 0;
        selection.current = allCurves().map((c, i) => (editable(c) ? (s.curves[j++]?.selected ?? 0) : (selection.current[i] ?? 0)));
        vp?.setGroomOverlay(s.curves);
        redraw((n) => n + 1);
        return;
      }
      commitCurves(`Groom: ${TOOL_LABELS[mode]}`, [...s.hidden, ...s.curves]);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  });

  const selectedCount = selection.current.filter((w) => w > 0.5).length;
  const applyLock = () => {
    const curves = allCurves().map((c, i) => ((selection.current[i] ?? 0) > 0.5 ? { ...c, lockWidth: lock.width, lockCurl: lock.curl } : c));
    commit('Lock width and curl', (st) => void (st.groom = { ...st.groom, curves: toAuthored(curves) }));
  };
  /** Change the selected cards' settings (one undo step). */
  const editSelected = (label: string, change: (card: GroomCard) => GroomCard) => {
    const curves = allCurves().map((c, i) => ((selection.current[i] ?? 0) > 0.5 && c.card ? { ...c, card: change(c.card) } : c));
    commitCurves(label, curves);
  };
  const toCards = () => {
    const hair = scene.cardHair;
    if (!hair) return;
    const curves: GroomCurve[] = hair.cardCurves.map(({ root, points, culled: _culled, ...card }) => ({ root, points, card }));
    selection.current = [];
    const cards = toAuthoredCards(curves);
    commit('Edit cards directly', (st) => void (st.groom = { ...st.groom, cards }));
  };
  const authored = Boolean(style?.groom.curves);
  const placedCards = style?.groom.cards ?? [];
  const culled = scene.cardHair?.cardCurves.filter((c) => c.culled).length ?? 0;
  const tools: Mode[] = cardMode ? ['draw', ...GROOM_TOOLS] : [...GROOM_TOOLS];

  return (
    <div className="hair-studio" data-testid="hair-studio">
      <div className="hs-row">
        <strong>Hair Studio</strong>
        <span className="hint" data-testid="hair-studio-hint">
          {cardMode
            ? `${placedCards.length} hand-placed cards: one curve is one card${culled ? ` (${culled} left out by this quality profile's budget)` : ''}`
            : authored
              ? `${style!.groom.curves!.length} combed guides`
              : 'Guides from the sliders: the first stroke starts a groom'}
        </span>
        <span className="spacer" />
        {cardMode ? (
          <button
            onClick={() => commit('Back to guides', (st) => void delete st.groom.cards)}
            data-testid="groom-cards-off"
            title="Drop the hand-placed cards and generate the hair from the guides again"
          >
            Back to guides
          </button>
        ) : (
          <>
            <button onClick={toCards} data-testid="groom-to-cards" title="Turn the hair on screen into hand-placed cards: every lock and card becomes its own curve to comb">
              Edit cards directly
            </button>
            {authored && (
              <button onClick={() => commit('Reset groom', (st) => void delete st.groom.curves)} data-testid="groom-reset" title="Back to the guides made from the sliders">
                Reset groom
              </button>
            )}
          </>
        )}
        <button onClick={() => ui.setView({ hairStudio: false })} data-testid="hair-studio-done">
          Done
        </button>
      </div>
      <div className="hs-row tools" role="toolbar" aria-label="Groom tools">
        {tools.map((t) => (
          <button key={t} className={mode === t ? 'active' : ''} onClick={() => setMode(t)} data-testid={`groom-tool-${t}`} title={t === 'draw' ? 'Draw a new card from the scalp along the pointer' : undefined}>
            {t === 'draw' ? 'Draw' : t === 'parting' ? 'Parting' : TOOL_LABELS[t]}
          </button>
        ))}
        <button className={mode === 'parting' ? 'active' : ''} onClick={() => setMode('parting')} data-testid="groom-parting" title="Draw the parting on the scalp">
          Parting
        </button>
      </div>
      <div className="hs-row">
        <label>
          Radius <input type="range" min={10} max={200} value={brush.radius} onChange={(e) => setBrush({ ...brush, radius: Number(e.target.value) })} data-testid="groom-radius" />
        </label>
        <label>
          Strength <input type="range" min={0.05} max={1} step={0.05} value={brush.strength} onChange={(e) => setBrush({ ...brush, strength: Number(e.target.value) })} data-testid="groom-strength" />
        </label>
        <label>
          Falloff{' '}
          <select value={brush.falloff} onChange={(e) => setBrush({ ...brush, falloff: e.target.value as BrushSettings['falloff'] })}>
            <option value="smooth">Smooth</option>
            <option value="linear">Linear</option>
            <option value="constant">Constant</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={brush.symmetry} onChange={(e) => setBrush({ ...brush, symmetry: e.target.checked })} data-testid="groom-symmetry" /> X symmetry
        </label>
        <label className="check">
          <input type="checkbox" checked={brush.frontOnly} onChange={(e) => setBrush({ ...brush, frontOnly: e.target.checked })} /> Front faces only
        </label>
        {(mode === 'grow' || mode === 'shrink' || mode === 'select') && (
          <label className="check">
            <input type="checkbox" checked={Boolean(brush.invert)} onChange={(e) => setBrush({ ...brush, invert: e.target.checked })} /> Invert
          </label>
        )}
      </div>
      <div className="hs-row">
        {cardMode ? (
          <>
            <span data-testid="card-selected">Cards ({selectedCount} selected):</span>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Make locks', (c) => ({ ...c, kind: 'lock', tag: 'lock', layer: 0.2 }))} data-testid="card-make-lock" title="Wide, bowed ribbons: the hair's mass">
              Lock
            </button>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Make cards', (c) => ({ ...c, kind: 'card', tag: c.tag === 'lock' ? 'clump' : c.tag, layer: 1 }))} data-testid="card-make-card" title="Flat detail cards, drawn over the locks">
              Card
            </button>
            <label>
              Width ×{' '}
              <input type="range" min={0.5} max={2} step={0.05} value={cardEdit.widthScale} onChange={(e) => setCardEdit({ ...cardEdit, widthScale: Number(e.target.value) })} />
            </label>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Card width', (c) => ({ ...c, width: c.width * cardEdit.widthScale }))} data-testid="card-width-apply">
              Scale width
            </button>
            <label>
              Twist <input type="range" min={-1} max={1} step={0.05} value={cardEdit.twist} onChange={(e) => setCardEdit({ ...cardEdit, twist: Number(e.target.value) })} />
            </label>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Card twist', (c) => ({ ...c, twist: cardEdit.twist }))} data-testid="card-twist-apply">
              Set twist
            </button>
            <label>
              Texture{' '}
              <select
                value=""
                disabled={selectedCount === 0}
                onChange={(e) => e.target.value && editSelected('Card texture', (c) => ({ ...c, tag: e.target.value as AtlasTag }))}
                data-testid="card-texture"
              >
                <option value="">Set…</option>
                {ATLAS_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {TAG_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Next texture strip', (c) => ({ ...c, region: c.region + 1 }))} data-testid="card-next-strip" title="The next strip of the atlas with the same texture tag">
              Next strip
            </button>
            <button disabled={selectedCount === 0} onClick={() => editSelected('Flip texture', (c) => ({ ...c, flip: !c.flip }))} data-testid="card-flip">
              Flip
            </button>
            <button
              disabled={selectedCount === 0}
              onClick={() => {
                selection.current = [];
                redraw((n) => n + 1);
              }}
            >
              Clear selection
            </button>
          </>
        ) : (
          <>
            <span>Locks ({selectedCount} selected):</span>
            <label>
              Width <input type="range" min={0.3} max={2.5} step={0.05} value={lock.width} onChange={(e) => setLock({ ...lock, width: Number(e.target.value) })} data-testid="lock-width" />
            </label>
            <label>
              Curl <input type="range" min={0} max={1} step={0.05} value={lock.curl} onChange={(e) => setLock({ ...lock, curl: Number(e.target.value) })} />
            </label>
            <button disabled={selectedCount === 0} onClick={applyLock} data-testid="lock-apply">
              Apply to selected
            </button>
          </>
        )}
        <span className="spacer" />
        <span>Show:</span>
        {(['scalp', 'shell', 'locks', 'cards'] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} data-testid={`hair-layer-${k}`} />{' '}
            {{ scalp: 'Scalp', shell: 'Cap', locks: 'Locks', cards: 'Cards' }[k]}
          </label>
        ))}
      </div>
      {cardMode && <div className="hs-row hint">Hide Locks or Cards under Show to brush only the other kind.</div>}
    </div>
  );
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
