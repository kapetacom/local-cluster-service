import Router from 'express-promise-router';
import { Request, Response } from 'express';
import { networkManager } from '../networkManager.js';

const router = Router();
router.get('/:systemId/target/:connectionId/', (req: Request, res: Response) => {
    res.send(networkManager.getTrafficForConnection(req.params.systemId, req.params.connectionId));
});

router.get('/:systemId/source/:blockInstanceId/', (req: Request, res: Response) => {
    res.send(networkManager.getTrafficForSource(req.params.systemId, req.params.blockInstanceId));
});

router.get('/:systemId/target/:blockInstanceId/', (req: Request, res: Response) => {
    res.send(networkManager.getTrafficForTarget(req.params.systemId, req.params.blockInstanceId));
});

export default router;
