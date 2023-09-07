import {PathTemplate} from "../../src/utils/pathTemplateParser";

describe('pathTemplateParser', () => {
    it('should return parameters for query parameters from parse', () => {
        const template = new PathTemplate("/names")
        const parse = template.parse("/names?name=Ib");
        expect(parse).toBeTruthy();
    })

    it("should return parameters defined in url", () => {
        const template = new PathTemplate("/names/{identityId}")
        const parse = template.parse("/names/idn_xxyyzz")
        expect(parse).toBeTruthy();
        expect(parse).toMatchObject({identityId: 'idn_xxyyzz'});
    })
});

