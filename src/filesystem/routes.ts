import { NextFunction, Request, Response } from 'express';
import Router from 'express-promise-router';
import { stringBody, StringBodyRequest } from '../middleware/stringBody.js';
import { filesystemManager } from '../filesystemManager.js';
import { corsHandler } from '../middleware/cors.js';

let router = Router();

router.use('/', corsHandler);

router.get('/root', (req: Request, res: Response) => {
    res.send(filesystemManager.getRootFolder());
});

router.get('/project/root', (req: Request, res: Response) => {
    res.send(filesystemManager.getProjectRootFolder());
});

router.use('/project/root', stringBody);

router.post('/project/root', (req: StringBodyRequest, res: Response) => {
    filesystemManager.setProjectRootFolder(req.stringBody ?? '');
    res.sendStatus(204);
});

router.use('/', (req: Request, res: Response, next: NextFunction) => {
    if (!req.query.path) {
        res.status(400).send({ error: 'Missing required query parameter "path"' });
        return;
    }
    next();
});

router.get('/list', async (req: Request, res: Response) => {
    let pathArg = req.query.path as string;

    try {
        res.send(await filesystemManager.readDirectory(pathArg));
    } catch (err) {
        res.status(400).send({ error: '' + err });
    }
});

router.get('/readfile', async (req: Request, res: Response) => {
    let pathArg = req.query.path as string;
    try {
        res.send(await filesystemManager.readFile(pathArg));
    } catch (err) {
        res.status(400).send({ error: '' + err });
    }
});

router.put('/mkdir', async (req: Request, res: Response) => {
    let pathArg = req.query.path as string;
    try {
        await filesystemManager.createFolder(pathArg);
        res.sendStatus(204);
    } catch (err) {
        res.status(400).send({ error: '' + err });
    }
});

router.use('/writefile', stringBody);
router.post('/writefile', async (req: StringBodyRequest, res: Response) => {
    let pathArg = req.query.path as string;
    try {
        await filesystemManager.writeFile(pathArg, req.stringBody ?? '');
        res.sendStatus(204);
    } catch (err) {
        res.status(400).send({ error: '' + err });
    }
});

export default router;
