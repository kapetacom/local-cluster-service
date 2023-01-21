interface Request {
    method: string
    stringBody: string
    headers: {[key:string]:string}
    params: {[key:string]:string}
}

interface Response {
    headers: {[key:string]:string}
    status: (status:number) => void
    send: (body:any) => void
    end: () => void
    set: (headers:{[key:string]:string}) => void
}

interface ResourceRef {
    blockId:string
    resourceName:string
}

declare function ProxyRequestHandler(req:Request, res:Response, info:ProxyRequestInfo);


interface Connection {
    mapping: any
    from: ResourceRef
    to: ResourceRef
}

interface ResourceInfo {
    spec:any
    metadata:any
    kind:string
}

interface ProxyRequestInfo {
    address: string
    connection:Connection
    fromResource:ResourceInfo
    toResource:ResourceInfo
    consumerPath:string
}