import {NextFunction, Request, Response} from "express";

export type StringBodyRequest = Request<any> & {
    stringBody?: string
}

export function stringBody (req:StringBodyRequest, res:Response, next:NextFunction) {

    // push the data to body
    const body:Buffer[] = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        req.stringBody = Buffer.concat(body).toString();
        next();
    });
};