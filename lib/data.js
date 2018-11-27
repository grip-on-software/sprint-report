import _ from 'lodash';
import axios from 'axios';

const unwrapFeature = function(sprints) {
    return _.map(sprints, g => _.isObject(g) ? g.max : g);
};

const filterSprints = function(state, sprints) {
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    if (state.sprints.showOld) {
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

const sprintsToFeatures = function(sprints, features, visible=null, unwrap=false) {
    return _.reduce(Array.from(features), (accumulator, feature, index) => {
        const featureSprints = _.map(sprints, feature);
        accumulator.push({
            "feature_key": feature,
            "visible_index":
                (index > 0 ? accumulator[index - 1].visible_index : -1) +
                (visible === null || visible.includes(feature) ? 1 : 0),
            "sprints": unwrap ? unwrapFeature(featureSprints) : featureSprints
        });
        return accumulator;
    }, []);
};

const getRequests = function(state, config) {
    const selectedProjects = Array.from(state.projects.selected);
    const auxiliaryKeys = _.concat("",
        _.difference(Array.from(state.features.selected),
            state.features.default
        ), state.sprints.showOld ? "old" : [],
        "details", config.links ? "links" : [],
        config.sources ? "sources" : []
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

            const data = _.map(projectRequests, (project) => {
                const data = config.links ? _.initial(project[1]) : project[1];
                const keys = config.links ? _.initial(auxiliaryKeys) : auxiliaryKeys;
                return {
                    "project_name": project[0],
                    "display_name": state.projects.display_names[project[0]] || "",
                    "sprints": config.sprints(requestsToSprints(
                        _.initial(data), _.initial(keys)
                    )),
                    "links": config.links ? _.last(project[1]).data : null,
                    "details": _.last(data).data,
                    "meta": Array.from(state.sprint_meta.selected)
                };
            });

            resolve(data);
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
