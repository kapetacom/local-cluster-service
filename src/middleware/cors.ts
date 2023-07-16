import { NextFunction, Request, Response } from 'express';

export function corsHandler(req: Request, res: Response, next: NextFunction) {
    res.set('Access-Control-Allow-Origin', req.headers.origin);
    res.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, PATCH');
    res.set('Access-Control-Allow-Headers', '*');

    next();
}
