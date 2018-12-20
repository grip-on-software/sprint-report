import _ from 'lodash';
import axios from 'axios';
import {OrderedSet} from 'immutable';

const unwrapFeature = function(sprints) {
    return _.map(sprints, g => {
        if (_.isObject(g)) {
            g = g.max;
        }
        if (g === "NA") {
            return null;
        }
        return g;
    });
};

const filterSprints = function(state, sprints) {
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    if (!state.sprints.showOld) {
        sprints = _.take(sprints, state.sprints.current);
    }
    return sprints;
};

const requestsToSprints = function(requests, auxiliaryKeys) {
    return _.reduce(_.zipObject(auxiliaryKeys, requests),
        (result, request, key) => key === "old" ?
            _.concat(request.data, result) :
            _.zipWith(result, request.data,
                (target, auxiliary) => _.assign({}, target,
                    key === "" ? auxiliary : _.fromPairs([[key, auxiliary]])
                )
            ),
        []
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

const getRequests = function(state, config) {
    const selectedProjects = Array.from(state.projects.selected);
    const selectedFeatures = config.expressions ? state.features.selected.union(
        _.flatten(_.map(state.features.expressions,
            (assignment, key) => state.features.selected.includes(key) ?
                assignment.attributes : []
        ))
    ) : state.features.selected;
    const hasMetrics = config.metrics &&
        !state.features.selected.intersect(state.features.metrics).isEmpty();
    const auxiliaryKeys = _.concat("",
        _.difference(Array.from(selectedFeatures), state.features.default),
        state.sprints.showOld ? "old" : [],
        state.sprints.showOld && config.details ? "details.old" : [],
        config.details ? ["details", "source_ids"] : [],
        hasMetrics ? "metric_targets" : [],
        config.links ? "links" : [], config.sources ? "sources" : []
    );
    const requests = axios.all(_.flatten(_.map(selectedProjects, project => {
        return _.map(auxiliaryKeys, feature => {
            return axios.get(`data/${project}/${feature === "" ? "default" : feature}.json`);
        });
    })));
    return {auxiliaryKeys, requests};
};

const makeRequests = function(state, config) {
    const {auxiliaryKeys, requests} = getRequests(state, config);
    return new Promise((resolve, reject) => {
        requests.then((responses) => {
            const projectRequests = _.zip(Array.from(state.projects.selected),
                _.chunk(responses, auxiliaryKeys.length)
            );

            const projects = _.map(projectRequests, (project) => {
                var data = Array.from(project[1]);
                var keys = Array.from(auxiliaryKeys);
                var links = null;
                var source_ids = null;
                var metric_targets = null;
                if (config.sources) {
                    data.pop();
                    keys.pop();
                }
                if (config.links) {
                    links = data.pop().data;
                    keys.pop();
                }
                if (config.metrics && !state.features.selected
                    .intersect(state.features.metrics).isEmpty()) {
                    metric_targets = data.pop().data;
                    keys.pop();
                }
                var details = {};
                if (config.details) {
                    source_ids = data.pop().data;
                    keys.pop();

                    details = data.pop().data;
                    keys.pop();
                    if (state.sprints.showOld) {
                        const oldDetails = data.pop().data;
                        details = _.mapValues(details,
                            (value, key) => _.assign({}, value, oldDetails[key])
                        );
                        keys.pop();
                    }
                }
                return {
                    "project_name": project[0],
                    "display_name": state.projects.display_names[project[0]] || "",
                    "sprints": config.sprints(requestsToSprints(data, keys)),
                    "links": links,
                    "source_ids": source_ids,
                    "details": details,
                    "metric_targets": metric_targets,
                    "meta": Array.from(state.sprint_meta.selected)
                };
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

export {getRequests, makeRequests, unwrapFeature, filterSprints, sprintsToFeatures, getSprintMeta};
