import { PathTemplate } from '../../src/utils/pathTemplateParser';

describe('pathTemplateParser', () => {
    it('must return parameters for query parameters from parse', () => {
        const template = new PathTemplate('/names');
        const parse = template.parse('/names?name=Ib#test');
        console.log(parse);
        expect(parse).toBeTruthy();
    });

    it('must return parameters defined in url', () => {
        const template = new PathTemplate('/names/{identityId}');
        const parse = template.parse('/names/idn_xxyyzz');
        expect(parse).toBeTruthy();
        expect(parse).toMatchObject({ identityId: 'idn_xxyyzz' });
    });

    it('must return parameters defined in url regardless of query parameters', () => {
        const template = new PathTemplate('/names/{identityId}');
        const parse = template.parse('/names/idn_xxyyzz?name=Ib#test');
        expect(parse).toBeTruthy();
        expect(parse).toMatchObject({ identityId: 'idn_xxyyzz' });
    });
});
