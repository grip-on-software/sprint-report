import _ from 'lodash';
import axios from 'axios';
import {OrderedSet} from 'immutable';

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

const unwrapFeature = function(featureSprints) {
    return _.map(featureSprints, g => unwrap(g));
};

const zipFeature = function(featureSprints) {
    const numValues = _.transform(featureSprints, (accumulator, g) => {
        if (_.isObject(g)) {
            accumulator.num = _.keys(g).length;
            return false;
        }
    }, {num: 1}).num;
    if (numValues == 1) {
        return featureSprints;
    }
    return _.zip(..._.map(featureSprints, g => _.isObject(g) ? _.values(g) :
        _.fill(Array(numValues), g)
    ));
};

const filterSprints = function(state, sprints) {
    if (state.sprints.first < 0) {
        const futureSprints = _.filter(sprints, d => d.future);
        sprints = _.concat(_.slice(sprints,
            sprints.length - futureSprints.length - state.sprints.current,
            sprints.length - futureSprints.length
        ), _.slice(futureSprints, 0, -state.sprints.first));
    }
    else {
        sprints = _.slice(sprints, sprints.length - state.sprints.current,
            sprints.length - state.sprints.first
        );
    }
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    return sprints;
};

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

const sprintsToFeature = function(sprints, accumulator, feature, index, visible, config, metric) {
    var previous = index - 1;
    var stacked = false;
    if (_.isArray(feature)) {
        previous = feature[1];
        stacked = true;
        feature = feature[0];
    }
    const featureSprints = _.map(sprints, feature);
    return {
        "feature_key": feature,
        "visible_index":
            (previous >= 0 ? accumulator[previous].visible_index : -1) +
            (!stacked && visible.includes(feature) ? 1 : 0),
        "visible_key": stacked ? accumulator[previous].feature_key : feature,
        "stack": stacked ? _.map(accumulator[index - 1].sprints,
            (s, i) => (previous === index - 1 ? 0 : s) +
                (accumulator[index - 1].stack !== null ?
                    accumulator[index - 1].stack[i] : 0)
            ) : null,
        "metric_targets": metric,
        "start_date": _.map(sprints, "start_date"),
        "sprints": config.unwrap ? unwrapFeature(featureSprints) :
            featureSprints
    };
};

const sprintsToFeatures = function(sprints, features, visible=null, config={}, metric_targets={}) {
    config = _.assign({}, {
        unwrap: false
    }, config);
    if (visible === null) {
        visible = OrderedSet(features);
    }
    return _.reduce(Array.from(features), (accumulator, feature, index) => {
        accumulator.push(sprintsToFeature(sprints, accumulator, feature, index,
            visible, config, metric_targets ? metric_targets[feature] : []
        ));
        return accumulator;
    }, []);
};

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
        condition: (state) => state.sprints.current > state.sprints.limit
    },
    {
        key: "details.old",
        combine: (data, oldDetails) => {
            data.details = _.mapValues(data.details,
                (value, key) => _.assign({}, value, oldDetails[key])
            );
        },
        condition: (state, config) => config.details &&
            state.sprints.current > state.sprints.limit
    },
    {
        key: "details",
        condition: (state, config) => config.details
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
const getRequests = function(state, config) {
    const selectedProjects = Array.from(state.projects.selected);
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
    return {auxiliaryKeys, requests};
};

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

    const {auxiliaryKeys, requests} = getRequests(state, config);
    return new Promise((resolve, reject) => {
        requests.then((responses) => {
            const projectRequests = _.zip(Array.from(state.projects.selected),
                _.chunk(responses, auxiliaryKeys.length)
            );

            const projects = _.map(projectRequests, (project) => {
                var data = Array.from(project[1]);
                var keys = Array.from(auxiliaryKeys);
                var projectData = _.reduceRight(requestKeys,
                    (accumulator, request) => {
                        combineProjectData(accumulator, request, data, keys);
                        return accumulator;
                    },
                    {
                        "project_name": project[0],
                        "display_name": state.projects.display_names[project[0]] || "",
                        "meta": Array.from(state.sprint_meta.selected)
                    }
                );
                projectData.sprints = config.sprints(filterSprints(state,
                    requestsToSprints(data, keys)
                ));
                return projectData;
            });

            resolve(projects);
        }).catch((error) => {
            reject(error);
        });
    });
};

const getSprintMeta = (sprint_meta, meta) => {
    if (meta === "main") {
        return sprint_meta.selected.isEmpty() ?
            sprint_meta.known[0] : sprint_meta.selected.first();
    }
    return meta;
};

export {getRequests, makeRequests, unwrap, unwrapFeature, zipFeature,
    filterSprints, sprintsToFeatures, getSprintMeta
};
