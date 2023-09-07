import {getRestMethodId} from "../../../src/proxy/types/rest";
import {Resource, ResourceMetadata} from '@kapeta/schemas';

describe('getRestMethodId', () => {
    it('should match @Query in url', () => {
        const restResource = new TestResource();

        const restMethodId = getRestMethodId(restResource, "POST", "/names?name=Ib");
        expect(restMethodId).toBeDefined();
    })
});

class TestResource implements Resource {
    kind = "";
    metadata = new TestResourceMetaData();

    get spec(): { [p: string]: any } {
        return {
            methods: [
                {
                    responseType: {
                        ref: "Name[]"
                    },
                    method: "GET",
                    path: "/names",
                    arguments: {}
                },
                {
                    responseType: {
                        ref: "Name"
                    },
                    method: "POST",
                    path: "/names",
                    arguments: {
                        name: {
                            type: "string",
                            transport: "QUERY"
                        }
                    }
                }
            ]
        }
    };
}

class TestResourceMetaData implements ResourceMetadata {
    [property: string]: any;
    name: string = "";
}