/**
 * JSON data request handler.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
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
import axios from 'axios';
import moment from 'moment';
import {OrderedSet} from 'immutable';

/* Take the most descriptive value from a compound feature. */
const unwrap = function(value) {
    if (_.isObject(value)) {
        value = typeof value.max !== "undefined" ? value.max :
            _.first(_.values(value));
    }
    if (value === "NA") {
        return null;
    }
    return value;
};

/* Take the most descriptive values for each sprint from a compound feature. */
const unwrapFeature = function(featureSprints) {
    return _.map(featureSprints, g => unwrap(g));
};

/* Include compound features if there are multiple and ensure each subitem has
 * proper lengths and unwrapped sub-items. This is mostly helpful for making
 * data valid for display of multiple prediction features, for example.
 */
const zipFeature = function(featureSprints) {
    const keyFilter = k => !k.endsWith("_error");
    const numValues = _.transform(featureSprints, (accumulator, g) => {
        if (_.isObject(g) && typeof g.max === "undefined") {
            accumulator.num = _.filter(_.keys(g), keyFilter).length;
            return false;
        }
        return null;
    }, {num: 1}).num;
    if (numValues === 1) {
        return [unwrapFeature(featureSprints)];
    }
    return _.zip(..._.map(featureSprints, g => _.isObject(g) ?
        _.filter(g, (v, k) => keyFilter(k)) :
        _.fill(Array(numValues), unwrap(g))
    ));
};

/* Adjust an array of sprints to only contain the ones selected by the current
 * sprint selection state. If the state determines so, obtain a disjoint array
 * of the future sprints. Also, determine which most recent non-future sprint
 * is selected.
 */
const filterSprints = function(state, sprints) {
    let futureSprints = [];
    let latestSprint = sprints[sprints.length - 1];
    if (state.sprints.first < 0) {
        futureSprints = _.takeRightWhile(sprints, d => d.future);
        latestSprint = sprints.length === futureSprints.length ? null :
            sprints[sprints.length - futureSprints.length - 1];
        sprints = _.concat(_.slice(sprints,
            Math.max(0,
                sprints.length - futureSprints.length - state.sprints.last
            ),
            sprints.length - futureSprints.length - state.sprints.current
        ), _.slice(futureSprints, 0, -state.sprints.first));
    }
    else {
        sprints = _.slice(sprints,
            Math.max(0, sprints.length - state.sprints.last),
            sprints.length - state.sprints.current
        );
    }
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    return {sprints, futureSprints, latestSprint};
};

/* Concatenate various requests for old, future, recent sprints as well as
 * auxiliary data to a single array of sprint data.
 */
const requestsToSprints = function(requests, auxiliaryKeys) {
    return _.reduce(_.zipObject(auxiliaryKeys, requests),
        (result, request, key) => {
            if (key === "old") {
                return _.concat(request.data, result);
            }
            if (key === "future") {
                return _.concat(result, request.data);
            }
            return _.zipWith(result, request.data,
                (target, auxiliary) => _.assign({}, target,
                    key === "default" ? auxiliary : _.fromPairs([[key, auxiliary]])
                )
            );
        }, []
    );
};

/* Adjust an array of sprints to select a feature from it and extract more data
 * regarding how this feature should be displayed (indexes compared to other
 * features selected in order, stack sizes if multiple features are shown as
 * a stacked chart, the dates of sprints to show the value at and the values
 * of the sprints themselves), along with other pre-existing details.
 */
const sprintsToFeature = function(sprints, accumulator, feature, visible, config) {
    let previous = feature.index - 1;
    let stacked = false;
    if (_.isArray(feature.feature_key)) {
        previous = feature.feature_key[1];
        stacked = true;
        feature.feature_key = feature.feature_key[0];
    }
    const featureSprints = _.map(sprints, feature.feature_key);
    return _.assign({}, feature, {
        "visible_index":
            (previous >= 0 ? accumulator[previous].visible_index : -1) +
            (!stacked && visible.includes(feature.feature_key) ? 1 : 0),
        "visible_key": stacked ? accumulator[previous].feature_key :
            feature.feature_key,
        "stack": stacked ? _.map(accumulator[feature.index - 1].sprints,
            (s, i) => (previous === feature.index - 1 ? 0 : s) +
                (accumulator[feature.index - 1].stack !== null ?
                    accumulator[feature.index - 1].stack[i] : 0)
            ) : null,
        "start_date": _.map(sprints, "start_date"),
        "sprints": config.unwrap ? unwrapFeature(featureSprints) :
            featureSprints
    });
};

/* Adjust an array of sprints to select multiple feature from it and extract
 * more data regarding how each feature should be displayed (indexes of the
 * features selected in order, stack sizes if multiple features are shown as
 * a stacked chart, the dates of sprints to show the value at, the values
 * of the sprints themselves, target threshold and the feature key itself).
 */
const sprintsToFeatures = function(sprints, features, visible=null, config={}, metricTargets={}) {
    config = _.assign({}, {
        unwrap: false
    }, config);
    if (visible === null) {
        visible = OrderedSet(features);
    }
    return _.reduce(Array.from(features), (accumulator, feature, index) => {
        accumulator.push(sprintsToFeature(sprints, accumulator, {
            index,
            feature_key: feature,
            metric_targets: metricTargets ? metricTargets[feature] : []
        }, visible, config));
        return accumulator;
    }, []);
};

/* Retrieve a set of features to retrieve, where any feature based on an
 * expression is augmented with the attributes in the expression, in case the
 * report format configuration wishes to include these in the expansion.
 */
const getAssignmentFeatures = function(state, config) {
    if (!config.expressions) {
        return state.features.selected;
    }
    return state.features.selected.union(
        _.flatten(_.map(state.features.expressions,
            (assignment, key) => state.features.selected.includes(key) ?
                assignment.attributes : []
        ))
    );
};

// Auxiliary data files for each project aside from the "default" file and
// separate feature files.
// The files marked with "sprint" provide more sprint data which is combined
// with the default/separated sprint features.
// A request key with a "combine" can combine its data into another field.
// The "condition" determines under what conditions the file is requested, which
// is based on the output format or export type (requestConfig) and/or the state
// of the selections for sprints and/or features.
const requestKeys = [
    {
        key: "future",
        sprint: true,
        condition: (state, config) =>
            config.future && state.sprints.first < 0 &&
            !state.features.selected.intersect(state.features.future).isEmpty()
    },
    {
        key: "old",
        sprint: true,
        condition: (state) => state.sprints.last > state.sprints.limit
    },
    {
        key: "details.old",
        combine: (data, oldDetails) => {
            data.details = _.mapValues(data.details,
                (value, key) => _.assign({}, value, oldDetails[key])
            );
        },
        condition: (state, config) => config.details &&
            !state.features.details.isEmpty() &&
            state.sprints.last > state.sprints.limit
    },
    {
        key: "details",
        condition: (state, config) => config.details &&
            !state.features.details.isEmpty()
    },
    {
        key: "errors",
        condition: (state, config) =>
            config.future && state.sprints.first < 0 &&
            !state.features.selected.intersect(state.features.future).isEmpty()
    },
    {
        key: "source_ids",
        condition: (state, config) => config.details
    },
    {
        key: "metric_targets",
        condition: (state, config) => config.metrics &&
            !state.features.selected.intersect(state.features.metrics).isEmpty()
    },
    {
        key: "links",
        condition: (state, config) => config.links
    },
    {
        key: "sources",
        condition: (state, config) => config.sources
    }
];

/* Retrieve a list of request promises to resolve in order to complete such that
 * the data for the report. Returns an object with selected projects as an
 * array, the data files that are being requested and the request promises.
 */
const getRequests = function(state, config) {
    const selectedProjects = Array.from(state.projects.visible);
    const selectedFeatures = getAssignmentFeatures(state, config);
    const auxiliaryKeys = _.concat("default",
        Array.from(selectedFeatures.subtract(state.features.default)),
        _.map(_.filter(requestKeys,
            request => request.condition(state, config)
        ), request => request.key)
    );
    const requests = axios.all(_.flatten(_.map(selectedProjects, project => {
        return _.map(auxiliaryKeys, feature => {
            return axios.get(`data/${project}/${feature}.json`);
        });
    })));
    return {selectedProjects, auxiliaryKeys, requests};
};

/**
 * Future sprints that need to be adjusted to be properly usable as sprints.
 */
class FutureSprints {
    constructor(state, futureSprints, latestSprint, originalSprints) {
        this.state = state;
        this.futureSprints = futureSprints;
        this.latestSprint = latestSprint;
        this.originalSprints = originalSprints;
    }

    /**
     * Expand a feature with one or more predictions so that likelihoods and
     * density functions can be properly displayed in the report.
     */
    updateFeature(feature, previous, sprintNum, key, sprint) {
        return _.transform(feature, (res, predict, subkey) => {
            const step = this.latestSprint[key] -
                this.futureSprints[0][key][subkey];
            res[subkey] = Math.max(0, _.isObject(previous) ?
                previous[subkey] - step : previous - step
            );
            // Find the actual sprint after the cutoff that is below the value
            const end = _.find(this.originalSprints,
                d => d.sprint_num >= this.latestSprint.sprint_num &&
                    d.sprint_num < this.futureSprints[0].sprint_num &&
                    d[key] <= res[subkey]
            );
            const cur = _.find(this.originalSprints,
                d => d.sprint_num < this.futureSprints[0].sprint_num &&
                    d.sprint_num === sprintNum
            );
            if (cur) {
                res[`${subkey}-points_error`] = res[subkey] - cur[key];
            }

            if (end) {
                this.state.sprint_meta.selected.forEach(meta => {
                    const errorKey = `${subkey}-${meta}_error`;
                    if (meta === "sprint_num") {
                        res[errorKey] = end[meta] - sprint[meta];
                    }
                    else if (meta !== "sprint_name") {
                        res[errorKey] = moment.duration(moment(end[meta])
                            .diff(moment(sprint[meta]))).days();
                    }
                });
            }
        }, {});
    }

    /**
     * Adjust the future sprints to have start and end dates that have proper
     * downtimes between them and features with one or more predictions are
     * expanded so that likelihoods and density functions can be properly
     * displayed in the report.
     */
    update(sprints) {
        const startDate = moment(this.latestSprint.start_date);
        const closeDate = moment(this.latestSprint.close_date);
        const length = closeDate.diff(startDate);
        const downtime = length + (this.futureSprints.length < 2 ? 0 :
            moment(this.futureSprints[1].start_date)
                .diff(this.futureSprints[0].close_date));

        return _.transform(sprints, (res, sprint, index) => {
            if (sprint.future && index > 0) {
                sprint = _.mapValues(sprint, (feature, key) => {
                    if (key === "start_date" || key === "close_date") {
                        return moment(res[index-1][key]).add(downtime, 'ms')
                            .format('YYYY-MM-DD HH:mm:ss');
                    }
                    else if (_.isObject(feature) &&
                        typeof feature.max === "undefined"
                    ) {
                        return this.updateFeature(feature, res[index-1][key],
                            index + sprints[0].sprint_num, key, sprint
                        );
                    }
                    return feature;
                });
            }
            res.push(sprint);
        }, []);
    }
}

/* Perform requests for sprint feature data and auxiliary data asynchronously.
 * Returns a promise which resolves with an array of data for each project,
 * where each array item is an object with the retrieved data as well as
 * metadata concerning the project, including at least the following:
 * - project_name: The project key.
 * - display_name: The best display name of the project, or an empty string
 *   if this would be superfluous compared to the project_name (for example
 *   in table format)
 * - meta: An array of sprint metadata fields to display.
 * - recent: Whether the project is recent.
 * - core: Whether the project is not worked on by a support team.
 * - team: A number indicating a team's board ID. This is 0 is the project is
 *   not a team, -1 if the team is not visible in the report, 1 if it is a team,
 *   or the board ID (>1) of the team otherwise.
 * - component: An indication of how the component is selected from a parent
 *   project. This is false if the project is not a component, or an object
 *   with include/exlude keys with strings or arrays of strings as values
 *   indicating issue component names.
 * - sprints: An array of sprint data, based on configuration and state of
 *   sprint selection this may include older and future sprints, but it is
 *   limited to the sprint selection range. Each sprint item in the array
 *   contains sprint metadata as well as selected features.
 * Additional items of the project data is retrieved from the files, which are
 * selected based on the state and/or configuration, namely details, errors,
 * source_ids, metric_targets, links and sources. Of these, only the details
 * item may differ from its data file in that it could be combined with the
 * details.old data file, if the sprint selection state would need old details.
 */
const makeRequests = function(state, config) {
    const combineProjectData = function(projectData, request, data, keys) {
        if (request.sprint) {
            return;
        }
        if (request.condition(state, config)) {
            const value = data.pop().data;
            keys.pop();
            if (request.combine) {
                request.combine(projectData, value);
            }
            else {
                projectData[request.key] = value;
            }
        }
        else if (!request.combine) {
            projectData[request.key] = {};
        }
    };

    const {selectedProjects, auxiliaryKeys, requests} = getRequests(state, config);
    return new Promise((resolve, reject) => {
        requests.then((responses) => {
            const projectRequests = _.zip(selectedProjects,
                _.chunk(responses, auxiliaryKeys.length)
            );

            const projects = _.map(projectRequests, (project) => {
                const data = Array.from(project[1]);
                const keys = Array.from(auxiliaryKeys);
                let projectData = _.reduceRight(requestKeys,
                    (accumulator, request) => {
                        combineProjectData(accumulator, request, data, keys);
                        return accumulator;
                    },
                    _.assign({}, state.projects.meta[project[0]], {
                        "project_name": project[0],
                        "display_name": state.projects.display_names[project[0]] || "",
                        "meta": Array.from(state.sprint_meta.selected)
                    })
                );
                const originalSprints = requestsToSprints(data, keys);
                let {sprints, futureSprints, latestSprint} =
                    filterSprints(state, originalSprints);
                if (state.sprints.current > 0 && latestSprint !== null) {
                    const future = new FutureSprints(state, futureSprints,
                        latestSprint, originalSprints
                    );
                    sprints = future.update(sprints);
                }
                projectData.sprints = config.sprints(sprints);
                return projectData;
            });

            resolve(projects);
        }).catch((error) => {
            reject(error);
        });
    });
};

/* Retrieve the field name of a sprint metadata field to use.
 * If `meta` is set to "main", then the first selected (or first known if none
 * is selected) is returned. Otherwise, `meta` is considered to be a sprint
 * metadata field and that field is returned.
 */
const getSprintMeta = (sprintMeta, meta) => {
    if (meta === "main") {
        return sprintMeta.selected.isEmpty() ?
            sprintMeta.known[0] : sprintMeta.selected.first();
    }
    return meta;
};

export {getRequests, makeRequests, unwrap, unwrapFeature, zipFeature,
    filterSprints, sprintsToFeatures, getSprintMeta
};
