import _ from 'lodash';
import axios from 'axios';

const filterSprints = function(state, sprints) {
    if (state.sprints.closedOnly) {
        sprints = _.filter(sprints, d => d.sprint_is_closed);
    }
    return state.sprints.showOld ? sprints :
        _.take(sprints, state.sprints.current);
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

const sprintsToFeatures = function(sprints, features) {
    return _.map(Array.from(features), (feature) => {
        return {
            "feature_key": feature,
            "sprints": _.map(sprints, feature)
        };
    });
};

const getRequests = function(state, config) {
    const selectedProjects = Array.from(state.projects.selected);
    const auxiliaryKeys = _.concat("",
        _.difference(Array.from(state.features.selected),
            state.features.default
        ), state.sprints.showOld ? "old" : [], config.links ? "links" : []
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
                return {
                    "project_name": project[0],
                    "display_name": state.projects.display_names[project[0]] || "",
                    "sprints": config.sprints(requestsToSprints(
                        config.links ? _.initial(project[1]) : project[1],
                        config.links ? _.initial(auxiliaryKeys) : auxiliaryKeys
                    )),
                    "links": config.links ? _.last(project[1]).data : null,
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

export {getRequests, makeRequests, filterSprints, sprintsToFeatures, getSprintMeta};