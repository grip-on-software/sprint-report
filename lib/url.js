import _ from 'lodash';

const getUrl = (state, selections) => {
    const parts = _.assign({}, {
        project: state.projects.selected,
        feature: state.features.selected,
        meta: state.sprint_meta.selected,
        format: [state.formatter.selected],
        count: [state.sprints.first, state.sprints.current, state.sprints.last],
        closed: [state.sprints.closedOnly ? '1' : '0']
    }, selections);

    const formatPart = (key, values) => `${key}_${values.join(',')}`;
    var accumulator = [formatPart("project", parts.project)];
    return `#${_.transform(parts, (accumulator, values, key) => {
        if (key === "feature" && values.selected) {
            values = _.map(Array.from(values.selected), feature => {
                const option = _.find([
                    ['team', 'project'], ['project', 'team']
                ], options => values[options[0]].includes(feature) &&
                    !values[options[1]].includes(feature)
                );
                return option ? `${option[0]}~${feature}` : feature;
            });
        }
        if (key !== "project") {
            accumulator.push(formatPart(key, values));
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
        set = set.union(extra);
    }
    return set;
};

export {getUrl, setToggle};
export default getUrl;
