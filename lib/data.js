import _ from 'lodash';
import axios from 'axios';
import moment from 'moment';
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

const filterSprints = function(state, sprints) {
    var futureSprints = [];
    var latestSprint = sprints[sprints.length - 1];
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

const sprintsToFeature = function(sprints, accumulator, feature, visible, config) {
    var previous = feature.index - 1;
    var stacked = false;
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

class FutureSprints {
    constructor(state, futureSprints, latestSprint, originalSprints) {
        this.state = state;
        this.futureSprints = futureSprints;
        this.latestSprint = latestSprint;
        this.originalSprints = originalSprints;
    }

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
                var data = Array.from(project[1]);
                var keys = Array.from(auxiliaryKeys);
                var projectData = _.reduceRight(requestKeys,
                    (accumulator, request) => {
                        combineProjectData(accumulator, request, data, keys);
                        return accumulator;
                    },
                    _.assign({},
                        _.find(state.projects.meta, p => p.name === project[0]),
                        {
                            "project_name": project[0],
                            "display_name": state.projects.display_names[project[0]] || "",
                            "meta": Array.from(state.sprint_meta.selected)
                        }
                    )
                );
                const originalSprints = requestsToSprints(data, keys);
                var {sprints, futureSprints, latestSprint} =
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
