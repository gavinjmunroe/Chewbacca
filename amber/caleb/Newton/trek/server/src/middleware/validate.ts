import { Request, Response, NextFunction } from 'express';

function maxLength(field: string, max: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.body[field] && typeof req.body[field] === 'string' && req.body[field].length > max) {
      res.status(400).json({ error: `${field} must be ${max} characters or less` });
      return;
    }
    next();
  };
}

function validateStringLengths(maxLengths: Record<string, number>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const [field, max] of Object.entries(maxLengths)) {
      const value = req.body[field];
      if (value && typeof value === 'string' && value.length > max) {
        res.status(400).json({ error: `${field} must be ${max} characters or less` });
        return;
      }
    }
    next();
  };
}

export { maxLength, validateStringLengths };
