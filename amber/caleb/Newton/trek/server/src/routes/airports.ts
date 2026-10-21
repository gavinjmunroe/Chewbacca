import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { searchAirports, findByIata } from '../services/airportService';

const router = express.Router();

router.get('/search', authenticate, (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (!q) return res.json([]);
  res.json(searchAirports(q));
});

router.get('/:iata', authenticate, (req: Request, res: Response) => {
  const airport = findByIata(req.params.iata);
  if (!airport) return res.status(404).json({ error: 'Airport not found' });
  res.json(airport);
});

export default router;
