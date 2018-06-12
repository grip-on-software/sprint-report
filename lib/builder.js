import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import naturalSort from 'javascript-natural-sort';
import {OrderedSet} from 'immutable';
import {navigation} from '@gros/visualization-ui';
import config from 'config.json';

const requestsToSprints = function(requests, auxiliaryKeys) {
    return _.reduce(_.zipObject(auxiliaryKeys, requests),
        (result, request, key) => _.zipWith(result, request.data,
            (target, auxiliary) => _.assign({}, target, key === "" ?
                    auxiliary : _.fromPairs([[key, auxiliary]])
            )
        ), []
    );
};

const sprintsToFeatures = function(sprints, features) {
    return _.map(features, (feature) => {
        return {
            "feature_key": feature,
            "sprints": _.map(sprints, feature)
        };
    });
};

class builder {
    constructor(projects, features, locale, localization) {
        this.projects = {
            known: projects.sort(naturalSort),
            selected: new OrderedSet()
        };

        this.features = features;
        this.features.selected = _.difference(this.features.default,
            this.features.meta
        );
        this.features.auxiliary = [];

        this.locale = locale;
        this.localization = localization;
    }

    makeNavigation() {
        // Create project navigation
        var knownProjects = new Set(this.projects.known);
        const updateProjects = (element) => {
            const _this = this;
            element.each(function() {
                d3.select(this.parentNode)
                    .classed('is-active', d => _this.projects.selected.has(d));
            });
            element.text(d => d === "" ? this.locale.message("projects-deselect") : d)
                .attr('href', d => {
                    if (d === "") {
                        return `#project_`;
                    }
                    var linkProjects = OrderedSet(this.projects.selected);
                    if (linkProjects.has(d)) {
                        linkProjects = linkProjects.delete(d);
                    }
                    else {
                        linkProjects = linkProjects.add(d);
                    }
                    return `#project_${linkProjects.join(',')}`;
                });
        };
        const projectNavigation = new navigation({
            container: '#navigation',
            prefix: 'project_',
            setCurrentItem: (project, hasProject) => {
                this.projects.selected = OrderedSet(project.split(','))
                    .intersect(knownProjects);
                updateProjects(d3.select('#navigation ul').selectAll('li a'));
                this.makeTable();
                return true;
            },
            addElement: (element) => {
                updateProjects(element);
            }
        });
        projectNavigation.start(_.concat("", this.projects.known));
    }

    makeSelection() {
    }

    makeTable() {
        const selectedProjects = Array.from(this.projects.selected);
        const auxiliaryKeys = _.concat("", this.features.auxiliary);
        axios.all(_.flatten(_.map(selectedProjects, project => {
            return _.concat(axios.get(`data/${project}/default.json`),
                _.map(this.features.auxiliary, feature => {
                    return axios.get(`data/${project}/${feature}.json`);
                })
            );
        }))).then((requests) => {
            const projectRequests = _.zip(selectedProjects,
                _.chunk(requests, 1 + this.features.auxiliary.length)
            );

            const data = _.map(projectRequests, (project) => {
                return {
                    "project_name": project[0],
                    "sprints": _.reverse(requestsToSprints(project[1], auxiliaryKeys))
                };
            });

            const table = d3.select('#content table');
            const projects = table.selectAll('tbody')
                .data(data, d => d.project_name);
            projects.exit().remove();
            var newProjects = projects.enter()
                .append('tbody');
            const projectRow = newProjects.append('tr')
                .classed('project', true);

            projectRow.append('th')
                .classed('name', true);

            projectRow.selectAll('th.sprint')
                .data(d => d.sprints, d => d.sprint_id)
                .enter()
                .append('th')
                .classed('sprint', true)
                .append('a');

            const updateProjects = newProjects.merge(projects);
            updateProjects.selectAll('tr.project th.name')
                .text(d => d.project_name);
            updateProjects.selectAll('tr.project th.sprint a')
                .attr('href', d => `${config.jira_url}/secure/` + (d.board_id ?
                    `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
                    `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
                ))
                .attr('title', d => d.sprint_num ?
                    this.locale.message('sprint-title') : d.sprint_name
                )
                .text(d => d.sprint_num ?
                    this.locale.message('sprint-header', [d.sprint_num]) :
                    d.sprint_name
                );

            const features = updateProjects.selectAll('tr.feature')
                .data(d => sprintsToFeatures(d.sprints, this.features.selected),
                    d => d.feature_key
                );

            features.exit().remove();
            const newFeatures = features.enter().append('tr')
                .classed('feature', true);
            newFeatures.append('td')
                .classed('name', true)
                .text(d => this.locale.retrieve(this.localization.descriptions, d.feature_key));

            newFeatures.selectAll('td.sprint')
                .data(d => d.sprints)
                .enter()
                .append('td')
                .classed('sprint', true);
            newFeatures.merge(features).selectAll('td.sprint')
                .text(d => d);
        });
    }
}

export default builder;
