const Path = require('path');
const _ = require('lodash');
const PLAN_KIND = 'core.blockware.com/v1/Plan';

class PlanKindHandler {

    getKind() {
        return PLAN_KIND;
    }

    isKind(kind) {
        return PLAN_KIND.toLowerCase() === kind.toLowerCase();
    }

    _resolveFileRefs(planYmlFile, planKind, resolver) {
        const relativePlan = _.cloneDeep(planKind);

        const baseDir = Path.dirname(planYmlFile);

        relativePlan.spec.blocks.forEach((block) => {
            if (block.block &&
                block.block.ref &&
                block.block.ref.toLowerCase().startsWith('file://')) {
                block.block.ref = 'file://' + resolver(baseDir, block.block.ref.substr(7));
            }
        });

        return relativePlan;
    }

    /**
     * Ensures all file refs in plan a relative to the plan.yml
     *
     * @param planYmlFile {string}
     * @param planKind {object}
     */
    resolveRelativeFileRefs(planYmlFile, planKind) {

        return this._resolveFileRefs(planYmlFile, planKind, (from, to) => {
            return Path.relative(from, to);
        });
    }


    /**
     * Ensures all file refs in plan are absolute paths.
     *
     * @param planYmlFile {string}
     * @param planKind {object}
     */
    resolveAbsoluteFileRefs(planYmlFile, planKind) {
        return this._resolveFileRefs(planYmlFile, planKind, (from, to) => {
            return Path.resolve(from, to);
        });
    }
}



module.exports = new PlanKindHandler();