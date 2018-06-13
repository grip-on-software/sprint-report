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
    return _.map(Array.from(features), (feature) => {
        return {
            "feature_key": feature,
            "sprints": _.map(sprints, feature)
        };
    });
};

const setToggle = function(set, value) {
    if (set.has(value)) {
        return set.delete(value);
    }
    return set.add(value);
};

class builder {
    constructor(projects, features, locales, moment, localization) {
        this.projects = {
            known: projects.sort(naturalSort),
            selected: new OrderedSet()
        };

        this.features = features;
        this.features.known = _.difference(this.features.all,
            this.features.meta
        );
        this.features.selected = OrderedSet(_.difference(this.features.default,
            this.features.meta
        ));

        this.locales = locales;
        this.moment = moment;
        this.localization = localization;

        this.sprint_meta = {
            main: 'sprint_name',
            extra: ['sprint_num', 'start_date'],
            format: {
                sprint_name: d => d,
                sprint_num: d => this.locales.message('sprint-number', [d]),
                start_date: d => this.moment(d, "YYYY-MM-DD HH:mm:ss", true).format('ll'),
                end_date: d => this.moment(d, "YYYY-MM-DD HH:mm:ss", true).format('ll')
            }
        };

        const updateSelection = (features) => {
            console.log(features);
            console.log(this.features);
            this.features.selected = OrderedSet(_.intersection(features,
                this.features.known
            ));
            this.makeSelection();
        };

        this.navigationHooks = {
            feature: updateSelection
        };
    }

    getUrl(selections) {
        const parts = _.assign({}, {
            project: this.projects.selected,
            feature: this.features.selected
        }, selections);
        return `#project_${parts.project.join(',')}|feature_${parts.feature.join(',')}`;
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
            element.text(d => d === "" ? this.locales.message("projects-deselect") : d)
                .attr('href', d => {
                    return this.getUrl({project: (d === "" ? OrderedSet() :
                        setToggle(OrderedSet(this.projects.selected), d)
                    )});
                });
        };
        const projectNavigation = new navigation({
            container: '#navigation',
            prefix: 'project_',
            setCurrentItem: (project, hasProject) => {
                const parts = project.split('|');

                _.forEach(parts, (value, index) => {
                    if (index === 0) {
                        this.projects.selected = OrderedSet(value.split(','))
                            .intersect(knownProjects);
                        d3.select('#navigation ul')
                            .selectAll('li a')
                            .call(updateProjects);
                    }
                    else {
                        const sep = value.indexOf('_');
                        const name = value.substr(0, sep);
                        const values = value.substr(sep + 1).split(',');
                        if (this.navigationHooks[name]) {
                            this.navigationHooks[name](values);
                        }
                    }
                });
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
        const features = d3.select('#features ul').selectAll('li')
            .data(this.features.known);
        const newFeatures = features.enter()
            .append('li');
        const label = newFeatures.append('a');
        label.append('input')
            .attr('type', 'checkbox');
        label.append('span')
            .text(d => this.locales.retrieve(this.localization.descriptions, d));

        const updateFeatures = newFeatures.merge(features);
        updateFeatures.selectAll('a').attr('href', d => this.getUrl({
            feature: setToggle(this.features.selected, d)
        }));
        updateFeatures.selectAll('input')
            .property('checked', d => this.features.selected.has(d));
    }

    makeTable() {
        const selectedProjects = Array.from(this.projects.selected);
        const auxiliaryKeys = _.concat("",
            _.difference(Array.from(this.features.selected),
                this.features.default
            )
        );
        axios.all(_.flatten(_.map(selectedProjects, project => {
            return _.map(auxiliaryKeys, feature => {
                return axios.get(`data/${project}/${feature === "" ? "default" : feature}.json`);
            });
        }))).then((requests) => {
            const projectRequests = _.zip(selectedProjects,
                _.chunk(requests, auxiliaryKeys.length)
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

            const sprintHeader = projectRow.selectAll('th.sprint')
                .data(d => d.sprints, d => d.sprint_id)
                .enter()
                .append('th')
                .classed('sprint', true);

            sprintHeader.append('a');
            const sprintTags = sprintHeader.append('span')
                .classed('tags', true)
                .classed('has-addons', true);

            const updateProjects = newProjects.merge(projects);
            updateProjects.selectAll('tr.project th.name')
                .text(d => d.project_name);
            updateProjects.selectAll('tr.project th.sprint a')
                .attr('href', d => `${config.jira_url}/secure/` + (d.board_id ?
                    `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
                    `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
                ))
                .attr('title', d => this.locales.message('sprint-title'))
                .text(d => this.sprint_meta.format[this.sprint_meta.main](d[this.sprint_meta.main]));

            const meta = sprintTags.selectAll('.tag')
                .merge(updateProjects.selectAll('tr.project th.sprint .tags .tag'))
                .data(d => _.toPairs(_.pick(d, this.sprint_meta.extra)));
            meta.exit().remove();
            meta.enter().append('span').classed('tag', true).merge(meta)
                .text(d => this.sprint_meta.format[d[0]](d[1]));

            const features = updateProjects.selectAll('tr.feature')
                .data(d => sprintsToFeatures(d.sprints, this.features.selected),
                    d => d.feature_key
                );

            features.exit().remove();
            const newFeatures = features.enter().append('tr')
                .classed('feature', true);
            newFeatures.append('td')
                .classed('name', true)
                .text(d => this.locales.retrieve(this.localization.descriptions, d.feature_key));

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
