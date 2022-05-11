/**
 * URL generation based on selection toggles.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import _ from 'lodash';

/* Adjust an array of selected features to indicate if they are only to be shown
 * for teams or for projects, by prefixing them with "team~" or "project~".
 */
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

/* Generate a URL anchor based on the current state of selected items.
 * Each type of item is prefixed with the field name, separated with '_', and
 * the values of that field are delimited by '&'. The items are concatenated
 * with a '!' delimiter.
 */
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
    let accumulator = [formatPart("project", parts.project)];
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

/* Add or remove a value (and optionally do the same for an ordered set of extra
 * values) from an ordered set. If the value is added, then the extra values are
 * added to the end of the ordered set, regardless of whether they were in there
 * before.
 */
const setToggle = (set, value, extra=null) => {
    if (set.has(value)) {
        if (extra !== null) {
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
