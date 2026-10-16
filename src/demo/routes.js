import { Router } from 'express';
import snapshot from './snapshot.json' with { type: 'json' };

// This router has no dependency on personal storage, application config, network,
// model services or generation code. All lessons and progress are fictional.
// Authentication and the all-method write guard belong to the parent app.
function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}
freezeSnapshot(snapshot);

const router = Router({ caseSensitive: true, strict: true });
const notFound = (res) => res.status(404).json({ error: '演示内容不存在', code: 'DEMO_NOT_FOUND' });

function fixed(value) {
  return (_req, res) => res.json(value);
}

function byId(collection) {
  return (req, res) => {
    // Exact own-key lookup only: never coerce IDs or allow inherited properties.
    if (!Object.hasOwn(collection, req.params.id)) return notFound(res);
    return res.json(collection[req.params.id]);
  };
}

// Explicit read allowlist. Express also serves HEAD for these same GET routes.
router.get('/videos', fixed(snapshot.videos));
router.get('/videos/:id', byId(snapshot.videoDetails));
router.get('/videos/:id/status', byId(snapshot.videoStatus));
router.get('/videos/:id/deepen', byId(snapshot.deepen));
router.get('/videos/:id/internalize/flashcards', byId(snapshot.flashcards));
router.get('/videos/:id/internalize/freeform', byId(snapshot.freeform));
router.get('/videos/:id/migration', byId(snapshot.migration));
router.get('/tree', fixed(snapshot.tree));
router.get('/tree/galaxy', fixed(snapshot.galaxy));
router.get('/tree/stats', fixed(snapshot.treeStats));
router.get('/user/stats', fixed(snapshot.userStats));
router.get('/ores', fixed(snapshot.ores));
router.get('/ores/:id', byId(snapshot.knowledgeCards));
router.get('/ores/:id/knowledge-card', byId(snapshot.knowledgeCards));
router.get('/cards', (req, res) => {
  const review = req.query.review === '1' || req.query.review === 'true';
  if (!review) return res.json({ type: 'all', cards: snapshot.cards, synthetic: true });
  const rawCount = req.query.count;
  const requested = typeof rawCount === 'string' && /^\d{1,3}$/.test(rawCount) ? Number(rawCount) : 5;
  const count = Math.min(requested, 20);
  return res.json({ type: 'review', cards: snapshot.reviewCards.slice(0, count), synthetic: true });
});
router.get('/cards/:id', byId(snapshot.cardDetails));
router.get('/cards/:id/backlinks', byId(snapshot.cardBacklinks));

// Do not fall through to personal routes or the SPA for unlisted API paths.
router.use((_req, res) => notFound(res));

export default router;
