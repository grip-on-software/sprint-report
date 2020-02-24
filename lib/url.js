import _ from 'lodash';

const transformFeature = (values) => {
    return _.map(Array.from(values.selected), feature => {
        const option = _.find([
            ['team', 'project'], ['project', 'team']
        ], options => values[options[0]].includes(feature) &&
            !values[options[1]].includes(feature)
        );
        return option ? `${option[0]}~${feature}` : feature;
    });
};

const getUrl = (state, selections) => {
    const defaults = {
        feature: Array.from(state.features.default),
        meta: state.sprint_meta.changed,
        format: [state.formatter.known[0].name],
        count: [0, 0, state.sprints.limit],
        closed: ['0']
    };
    const parts = _.assign({}, {
        project: state.projects.selected,
        feature: state.features,
        meta: state.sprint_meta.selected,
        format: [state.formatter.selected],
        count: [state.sprints.first, state.sprints.current, state.sprints.last],
        closed: [state.sprints.closedOnly ? '1' : '0']
    }, selections);

    const formatPart = (key, values) => `${key}_${values.join('&')}`;
    var accumulator = [formatPart("project", parts.project)];
    return `#${_.transform(parts, (accumulator, values, key) => {
        if (key === "feature" && values.selected) {
            values = transformFeature(values);
        }
        if (key !== "project") {
            const changed = _.isBoolean(defaults[key]) ? defaults[key] :
                !_.isEqual(values, defaults[key]);
            if (changed || _.has(selections, key)) {
                accumulator.push(formatPart(key, values));
            }
        }
    }, accumulator).join('!')}`;
};

const setToggle = (set, value, extra=null) => {
    if (set.has(value)) {
        if (extra !== null && set.isSuperset(extra)) {
            set = set.subtract(extra);
        }
        return set.delete(value);
    }
    set = set.add(value);
    if (extra !== null) {
        set = set.subtract(extra).union(extra);
    }
    return set;
};

export {getUrl, setToggle};
export default getUrl;
