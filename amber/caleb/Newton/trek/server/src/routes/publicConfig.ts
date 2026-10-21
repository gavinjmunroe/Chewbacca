import express, { Request, Response } from 'express';
import { DEFAULT_LANGUAGE } from '../config';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ defaultLanguage: DEFAULT_LANGUAGE });
});

export default router;
